// File: backend/src/modules/webhooks/strategies/culqi.strategy.ts

import { IPaymentStrategy } from './payment.strategy.interface';
import Pedido, { EstadoPago, EstadoPedido } from '../../pedidos/pedido.model';
import { PedidoService } from '../../pedidos/pedido.service';

interface CulqiEventData {
  id: string;
  object: string;
  state?: string;
  charge_id?: string;
  metadata?: {
    orderNumber?: string;
    pedidoId?: string;
  };
  [key: string]: unknown;
}

export class CulqiStrategy implements IPaymentStrategy {
  private pedidoService: PedidoService;

  constructor() {
    this.pedidoService = new PedidoService();
  }

  async processWebhook(payload: Record<string, unknown>): Promise<boolean> {
    try {
      if (!payload || !payload.type) {
        console.warn('⚠️ [Culqi Webhook] Estructura de payload no válida.');
        return false;
      }

      const eventType = String(payload.type);
      let rawData = payload.data;

      // Culqi a veces envía el objeto 'data' serializado como string
      if (typeof rawData === 'string') {
        try {
          rawData = JSON.parse(rawData);
        } catch {
          console.error('🔴 [Culqi Webhook] Error al parsear campo data.');
          return false;
        }
      }

      const data = rawData as CulqiEventData;
      if (!data || !data.id) return false;

      const orderNumber = data.metadata?.orderNumber;

      // Para eventos de reembolso, el identificador transaccional original está en charge_id
      const transactionRefId = (eventType === 'refund.creation.succeeded' && data.charge_id) 
        ? data.charge_id 
        : data.id;

      const pedido = await Pedido.findOne({
        $or: [
          ...(orderNumber ? [{ orderNumber }] : []),
          { 'payment.gatewayOrderId': transactionRefId },
          { 'payment.transactionId': transactionRefId },
        ],
      });

      if (!pedido) {
        console.warn(`⚠️ [Culqi Webhook] Pedido no encontrado para ID/OrderNumber: ${transactionRefId} / ${orderNumber}`);
        return false;
      }

      // 1. Manejo de Reembolsos (Panel Culqi o API)
      if (eventType === 'refund.creation.succeeded') {
        if (pedido.status !== EstadoPedido.CANCELED) {
          console.log(`🔄 [Culqi Webhook] Procesando reembolso para el pedido #${pedido.orderNumber}`);
          
          // Ejecuta la transición a CANCELED, lo cual gatilla la reposición de stock en PedidoService
          await this.pedidoService.actualizarEstadoPedido(pedido._id.toString(), EstadoPedido.CANCELED);
          pedido.payment.status = EstadoPago.REFUNDED; 
          
          pedido.payment.gatewayData = {
            ...(pedido.payment.gatewayData || {}),
            refund_id: data.id,
            refund_data: data
          };

          await pedido.save();
          console.log(`✅ [Culqi Webhook] Reembolso procesado. Pedido cancelado y stock restablecido.`);
        }
        return true;
      }

      // Idempotencia para pagos exitosos
      if (pedido.payment.status === EstadoPago.APPROVED) {
        return true;
      }

      // 2. Pagos diferidos (PagoEfectivo, Cuotéalo, QR)
      if (eventType === 'order.state.changed' || eventType === 'order.status.changed') {
        if (data.state === 'paid') {
          console.log(`🚀 [Culqi Webhook] Orden #${pedido.orderNumber} pagada (Pago Diferido).`);
          await this.pedidoService.confirmarPagoAprobado(pedido, data.id, data);
          return true;
        } else if (data.state === 'expired' || data.state === 'deleted') {
          console.log(`❌ [Culqi Webhook] Orden #${pedido.orderNumber} expirada.`);
          await this.pedidoService.actualizarEstadoPedido(pedido._id.toString(), EstadoPedido.CANCELED);
          pedido.payment.status = EstadoPago.REJECTED;
          await pedido.save();
          return true;
        }
      } 
      // 3. Cargos directos asíncronos (Tarjetas, Yape token directo)
      else if (eventType === 'charge.creation.succeeded') {
        console.log(`🚀 [Culqi Webhook] Cargo exitoso para orden #${pedido.orderNumber}.`);
        await this.pedidoService.confirmarPagoAprobado(pedido, data.id, data);
        return true;
      } else if (eventType === 'charge.creation.failed') {
        console.log(`❌ [Culqi Webhook] Cargo fallido para orden #${pedido.orderNumber}.`);
        // Asegura que el estado se invalida vía API cuando falla asíncronamente
        await this.pedidoService.actualizarEstadoPedido(pedido._id.toString(), EstadoPedido.CANCELED);
        pedido.payment.status = EstadoPago.REJECTED;
        
        // Registrar motivo exacto del fallo para auditoría
        pedido.payment.gatewayData = {
          ...(pedido.payment.gatewayData || {}),
          failure_reason: data
        };
        await pedido.save();
        return true;
      }

      return true;
    } catch (error) {
      console.error('💥 [Culqi Webhook Error]:', error);
      return false;
    }
  }
}