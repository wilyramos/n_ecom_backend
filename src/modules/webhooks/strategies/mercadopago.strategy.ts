// File: backend/src/modules/webhooks/strategies/mercadopago.strategy.ts

import { IPaymentStrategy } from './payment.strategy.interface';
import Pedido from '../../pedidos/pedido.model';
import { EstadoPago, EstadoPedido } from '../../pedidos/pedido.model';
import { payment as mpPayment } from '../../../utils/mercadopago'; 

export class MercadoPagoStrategy implements IPaymentStrategy {
    async processWebhook(payload: Record<string, unknown>, signature?: string): Promise<boolean> {
        try {
            // Extraer el ID dependiendo del tipo de notificación (IPN vs Webhook)
            const dataObj = payload?.data as Record<string, unknown> | undefined;
            const paymentId = (dataObj?.id || payload?.id) as string | number | undefined;

            if (!paymentId) return false;

            // 1. Consultar el pago en la API oficial para evitar spoofing
            const paymentInfo = await mpPayment.get({ id: String(paymentId) });

            if (!paymentInfo) return false;

            const externalReference = paymentInfo.external_reference;
            const mpStatus = paymentInfo.status; 

            if (!externalReference) return false;

            // 2. Buscar el pedido correspondiente
            const pedido = await Pedido.findOne({ orderNumber: externalReference });
            if (!pedido) return false;

            let newPaymentStatus = EstadoPago.PENDING;
            let newOrderStatus = pedido.status;

            // 3. Mapear estado de Mercado Pago a nuestro sistema
            if (mpStatus === 'approved') {
                newPaymentStatus = EstadoPago.APPROVED;
                newOrderStatus = EstadoPedido.PROCESSING;
            } else if (mpStatus === 'rejected' || mpStatus === 'cancelled') {
                newPaymentStatus = EstadoPago.REJECTED;
            } else if (mpStatus === 'refunded') {
                newPaymentStatus = EstadoPago.REFUNDED;
                newOrderStatus = EstadoPedido.CANCELED;
            }

            // 4. Actualizar en Base de Datos solo si hubo cambios reales
            if (pedido.payment.status !== newPaymentStatus) {
                pedido.payment.status = newPaymentStatus;
                pedido.payment.transactionId = String(paymentId);
                pedido.payment.gatewayData = paymentInfo as unknown as Record<string, unknown>;
                
                if (newPaymentStatus === EstadoPago.APPROVED) {
                    pedido.payment.paidAt = new Date();
                }

                if (pedido.status !== newOrderStatus) {
                    pedido.status = newOrderStatus;
                    pedido.statusHistory.push({
                        status: newOrderStatus,
                        changedAt: new Date()
                    });
                }

                await pedido.save();
                console.log(`🚀 [MP Webhook] Pedido ${externalReference} actualizado a ${newPaymentStatus}.`);
            }

            return true;
        } catch (error) {
            console.error('💥 [Mercado Pago Webhook Error]:', error);
            return false;
        }
    }
}