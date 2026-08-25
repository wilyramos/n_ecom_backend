import { IPaymentStrategy } from './payment.strategy.interface';
import Pedido, { EstadoPago, EstadoPedido } from '../../pedidos/pedido.model';
import { payment as mpPayment } from '../../../utils/mercadopago';
import { PedidoService } from '../../pedidos/pedido.service';

export class MercadoPagoStrategy implements IPaymentStrategy {
    private pedidoService: PedidoService;

    constructor() {
        this.pedidoService = new PedidoService();
    }

    async processWebhook(payload: Record<string, unknown>): Promise<boolean> {
        try {
            const dataObj = payload?.data as Record<string, unknown> | undefined;
            const paymentId = (dataObj?.id || payload?.id) as string | number | undefined;

            if (!paymentId) return false;

            // 1. Consultar el pago en la API oficial de Mercado Pago para evitar spoofing
            const paymentInfo = await mpPayment.get({ id: String(paymentId) });
            if (!paymentInfo || !paymentInfo.external_reference) return false;

            const externalReference = paymentInfo.external_reference;
            const mpStatus = paymentInfo.status;

            // 2. Buscar el pedido por el número de orden
            const pedido = await Pedido.findOne({ orderNumber: externalReference });
            if (!pedido) return false;

            // Idempotencia: Si ya estaba aprobado, no procesar nuevamente
            if (pedido.payment.status === EstadoPago.APPROVED) {
                return true;
            }

            let estadoModificado = false;

            // 3. Mapeo directo de estados según Mercado Pago
            if (mpStatus === 'approved') {
                pedido.payment.status = EstadoPago.APPROVED;
                pedido.status = EstadoPedido.PROCESSING;
                pedido.payment.paidAt = new Date();
                estadoModificado = true;
            } else if (mpStatus === 'rejected' || mpStatus === 'cancelled') {
                if (pedido.payment.status !== EstadoPago.REJECTED) {
                    pedido.payment.status = EstadoPago.REJECTED;
                    pedido.status = EstadoPedido.CANCELED;
                    estadoModificado = true;
                }
            } else if (mpStatus === 'refunded') {
                if (pedido.payment.status !== EstadoPago.REFUNDED) {
                    pedido.payment.status = EstadoPago.REFUNDED;
                    pedido.status = EstadoPedido.CANCELED;
                    estadoModificado = true;
                }
            }

            // 4. Persistir cambios y disparar notificaciones
            if (estadoModificado) {
                pedido.payment.transactionId = String(paymentId);
                pedido.payment.gatewayData = paymentInfo as unknown as Record<string, unknown>;
                pedido.statusHistory.push({
                    status: pedido.status,
                    changedAt: new Date(),
                });

                await pedido.save();
                console.log(`🚀 [MP Webhook] Pedido ${externalReference} actualizado a ${pedido.payment.status}.`);

                if (pedido.payment.status === EstadoPago.APPROVED) {
                    this.pedidoService.dispararCorreosConfirmacion(pedido).catch((err) =>
                        console.error('Error background correo MP Webhook:', err)
                    );
                }
            }

            return true;
        } catch (error) {
            console.error('💥 [Mercado Pago Webhook Error]:', error);
            return false;
        }
    }
}