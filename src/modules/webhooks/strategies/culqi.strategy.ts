// File: backend/src/modules/webhooks/strategies/culqi.strategy.ts

import { IPaymentStrategy } from './payment.strategy.interface';
import Pedido from '../../pedidos/pedido.model';
import { EstadoPago, EstadoPedido } from '../../pedidos/pedido.model';

interface CulqiEventData {
    id: string;
    object: string;
    state?: string; // Presente en "order"
    metadata?: {
        orderNumber?: string;
    };
    [key: string]: unknown;
}

export class CulqiStrategy implements IPaymentStrategy {
    async processWebhook(payload: Record<string, unknown>): Promise<boolean> {
        try {
            if (!payload || !payload.type) {
                console.warn('⚠️ [Culqi Webhook] Estructura de payload no válida.');
                return false;
            }

            const eventType = String(payload.type);
            
            // Decodificar 'data' de manera segura (Culqi a veces lo manda como string JSON)
            let rawData = payload.data;
            if (typeof rawData === 'string') {
                try {
                    rawData = JSON.parse(rawData);
                } catch {
                    console.error('🔴 [Culqi Webhook] No se pudo parsear el campo data.');
                    return false;
                }
            }

            const data = rawData as CulqiEventData;
            if (!data || !data.id) return false;

            // Intentar obtener el orderNumber del metadata
            const orderNumber = data.metadata?.orderNumber;

            // Buscar el pedido por orderNumber o por el ID de la orden en la pasarela
            const pedido = await Pedido.findOne({
                $or: [
                    { orderNumber: orderNumber },
                    { 'payment.gatewayOrderId': data.id },
                    { 'payment.transactionId': data.id }
                ]
            });

            if (!pedido) {
                console.warn(`⚠️ [Culqi Webhook] Pedido no encontrado para ID/OrderNumber: ${data.id} / ${orderNumber}`);
                return false;
            }

            // Evitar doble procesamiento si el pedido ya fue marcado como procesado (Evita sobreescribir timestamps)
            if (pedido.payment.status === EstadoPago.APPROVED) {
                console.log(`✅ [Culqi Webhook] Pedido ${pedido.orderNumber} ya estaba aprobado. Ignorando.`);
                return true;
            }

            let nuevoEstadoPago: EstadoPago | null = null;
            let nuevoEstadoPedido: EstadoPedido | null = null;

            // ─── 1. EVALUAR EVENTOS DE ÓRDENES (PagoEfectivo, Cuotéalo) ───
            if (eventType === 'order.status.changed') {
                if (data.state === 'paid') {
                    nuevoEstadoPago = EstadoPago.APPROVED;
                    nuevoEstadoPedido = EstadoPedido.PROCESSING;
                } else if (data.state === 'expired') {
                    nuevoEstadoPago = EstadoPago.REJECTED;
                    nuevoEstadoPedido = EstadoPedido.CANCELED;
                }
            } 
            // ─── 2. EVALUAR EVENTOS DE CARGOS DIRECTOS (Tarjetas, Yape) ───
            else if (eventType === 'charge.creation.succeeded') {
                nuevoEstadoPago = EstadoPago.APPROVED;
                nuevoEstadoPedido = EstadoPedido.PROCESSING;
            } else if (eventType === 'charge.creation.failed') {
                nuevoEstadoPago = EstadoPago.REJECTED;
                nuevoEstadoPedido = EstadoPedido.CANCELED;
            }

            // ─── 3. GUARDAR CAMBIOS SI APLICA ───
            if (nuevoEstadoPago && nuevoEstadoPedido) {
                pedido.payment.status = nuevoEstadoPago;
                pedido.payment.gatewayData = data;
                
                if (nuevoEstadoPago === EstadoPago.APPROVED) {
                    pedido.payment.paidAt = new Date();
                    pedido.payment.transactionId = data.id; // Guardar el ID de la transacción final
                }

                if (pedido.status !== nuevoEstadoPedido) {
                    pedido.status = nuevoEstadoPedido;
                    pedido.statusHistory.push({
                        status: nuevoEstadoPedido,
                        changedAt: new Date(),
                    });
                }

                await pedido.save();
                console.log(`🚀 [Culqi Webhook] Pedido ${pedido.orderNumber} actualizado a ${nuevoEstadoPago}.`);
            }

            return true;
        } catch (error) {
            console.error('💥 [Culqi Webhook Error]:', error);
            return false;
        }
    }
}