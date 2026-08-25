import { IPaymentGatewayService, PaymentGatewayResult } from './payment-gateway.interface';
import { IPedido } from '../pedido.model';
import { CrearPedidoInput } from '../pedido.schema';
import { preference } from '../../../utils/mercadopago';

export class MercadoPagoGatewayService implements IPaymentGatewayService {
    readonly providerName = 'mercadopago';

    async crearPreferencia(pedido: IPedido, data: CrearPedidoInput): Promise<PaymentGatewayResult> {
        const itemsMP = data.items.map((item) => ({
            id: item.productId.toString(),
            title: item.nombre,
            quantity: item.quantity,
            unit_price: item.price,
            currency_id: 'PEN',
        }));

        if (pedido.shippingCost > 0) {
            itemsMP.push({
                id: 'ENVIO',
                title: 'Envío',
                quantity: 1,
                unit_price: pedido.shippingCost,
                currency_id: 'PEN',
            });
        }

        const prefResponse = await preference.create({
            body: {
                items: itemsMP,
                payer: {
                    name: data.customerProfile.nombre,
                    surname: data.customerProfile.apellidos,
                    email: data.customerProfile.email,
                },
                back_urls: {
                    success: `${process.env.FRONTEND_URL}/checkout-result/success/${pedido.orderNumber}`,
                    failure: `${process.env.FRONTEND_URL}/checkout-result/failure?order=${pedido.orderNumber}`,
                    pending: `${process.env.FRONTEND_URL}/checkout-result/pending`,
                },
                auto_return: 'approved',
                external_reference: pedido.orderNumber,
            },
        });

        return {
            initPoint: prefResponse.init_point || null,
            gatewayOrderId: prefResponse.id,
        };
    }
}