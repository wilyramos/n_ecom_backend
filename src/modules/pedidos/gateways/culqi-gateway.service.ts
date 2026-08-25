//File: backend/src/modules/pedidos/gateways/culqi-gateway.service.ts

import { IPaymentGatewayService, PaymentGatewayResult } from './payment-gateway.interface';
import { IPedido } from '../pedido.model';
import { CrearPedidoInput } from '../pedido.schema';

interface CulqiOrderResponse {
    id: string;
    object: string;
    amount: number;
    currency_code: string;
}

export class CulqiGatewayService implements IPaymentGatewayService {
    readonly providerName = 'culqi';

    async crearPreferencia(pedido: IPedido, data: CrearPedidoInput): Promise<PaymentGatewayResult> {
        const culqiOrderPayload = {
            amount: Math.round(pedido.totalPrice * 100),
            currency_code: data.currency || 'PEN',
            description: `Orden de Compra ${pedido.orderNumber}`,
            order_number: pedido.orderNumber,
            client_details: {
                first_name: data.customerProfile.nombre,
                last_name: data.customerProfile.apellidos,
                email: data.customerProfile.email,
                phone_number: data.customerProfile.telefono,
            },
            expiration_date: Math.floor(Date.now() / 1000) + 86400,
        };

        try {
            const culqiOrderRes = await fetch('https://api.culqi.com/v2/orders', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${process.env.CULQI_API_KEY}`,
                },
                body: JSON.stringify(culqiOrderPayload),
            });

            const culqiOrderData = (await culqiOrderRes.json()) as CulqiOrderResponse;

            if (culqiOrderRes.ok && culqiOrderData.id) {
                return {
                    gatewayOrderId: culqiOrderData.id,
                    gatewayData: culqiOrderData as unknown as Record<string, unknown>,
                };
            }
        } catch (err) {
            console.error('💥 [Culqi Gateway Error]:', err);
        }

        return {};
    }
}