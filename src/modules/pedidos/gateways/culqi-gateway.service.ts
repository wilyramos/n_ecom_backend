// File: backend/src/modules/pedidos/gateways/culqi-gateway.service.ts

import { IPaymentGatewayService, PaymentGatewayResult } from './payment-gateway.interface';
import { IPedido } from '../pedido.model';
import { CrearPedidoInput } from '../pedido.schema';

interface CulqiOrderResponse {
    id: string;
    object: string;
    amount: number;
    currency_code: string;
    state?: string;
    user_message?: string;
    merchant_message?: string;
    [key: string]: unknown;
}

export class CulqiGatewayService implements IPaymentGatewayService {
    readonly providerName = 'culqi';

    async crearPreferencia(pedido: IPedido, data: CrearPedidoInput, userId?: string): Promise<PaymentGatewayResult> {
        console.log(`\n🔵 [Culqi Gateway] Iniciando creación de orden para el pedido #${pedido.orderNumber}...`);

        if (!process.env.CULQI_API_KEY) {
            console.error('🔴 [Culqi Gateway Error]: CULQI_API_KEY ausente en las variables de entorno.');
            throw new Error('Configuración de pasarela incompleta: CULQI_API_KEY ausente.');
        }

        const cleanPhone = (data.customerProfile.telefono || '').replace(/\D/g, '').substring(0, 15);
        const finalPhone = cleanPhone.length >= 5 ? cleanPhone : '999999999';
        
        console.log(`⚙️ [Culqi Gateway] Teléfono sanitizado: ${finalPhone} (Original: ${data.customerProfile.telefono})`);

        const culqiOrderPayload = {
            amount: Math.round(pedido.totalPrice * 100),
            currency_code: data.currency || 'PEN',
            description: `Orden de Compra #${pedido.orderNumber}`,
            order_number: pedido.orderNumber,
            client_details: {
                first_name: data.customerProfile.nombre.trim(),
                last_name: data.customerProfile.apellidos.trim(),
                email: data.customerProfile.email.trim().toLowerCase(),
                phone_number: finalPhone,
            },
            expiration_date: Math.floor(Date.now() / 1000) + (24 * 60 * 60),
            // 🔴 SOLUCIÓN CRÍTICA PARA CHECKOUT V4 CON MÉTODOS DIFERIDOS
            // Evita que Culqi intente confirmar la orden prematuramente en su backend.
            confirm: false, 
            metadata: {
                pedidoId: pedido._id.toString(),
                userId: userId || 'guest'
            }
        };

        console.log(`📦 [Culqi Gateway] Payload preparado para enviar a Culqi:`, JSON.stringify(culqiOrderPayload, null, 2));
        console.log(`🌐 [Culqi Gateway] Realizando petición POST a https://api.culqi.com/v2/orders ...`);

        const culqiOrderRes = await fetch('https://api.culqi.com/v2/orders', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${process.env.CULQI_API_KEY}`,
            },
            body: JSON.stringify(culqiOrderPayload),
        });

        console.log(`📡 [Culqi Gateway] Respuesta recibida. Status HTTP: ${culqiOrderRes.status}`);

        const culqiOrderData = (await culqiOrderRes.json()) as CulqiOrderResponse;

        if (!culqiOrderRes.ok || !culqiOrderData.id) {
            console.error('🔴 [Culqi Gateway] Error detectado en la respuesta de la API de Culqi:');
            console.error(JSON.stringify(culqiOrderData, null, 2));
            throw new Error(
                culqiOrderData.user_message || 
                culqiOrderData.merchant_message || 
                'No se pudo generar la orden de pago en Culqi.'
            );
        }

        console.log(`✅ [Culqi Gateway] Orden creada exitosamente en Culqi. ID Generado: ${culqiOrderData.id}`);

        return {
            gatewayOrderId: culqiOrderData.id,
            gatewayData: culqiOrderData as unknown as Record<string, unknown>,
        };
    }
}