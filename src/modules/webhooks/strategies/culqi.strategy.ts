import { IPaymentStrategy } from './payment.strategy.interface';
import Pedido, { EstadoPago, EstadoPedido } from '../../pedidos/pedido.model';
import { PedidoService } from '../../pedidos/pedido.service';

interface CulqiEventData {
  id: string;
  object: string;
  state?: string;
  charge_id?: string;
  action_code?: string;
  outcome?: {
    type: string;
    code?: string;
  };
  metadata?: {
    orderNumber?: string;
    pedidoId?: string;
  };
  charges?: Array<{ id: string; user_message?: string }>;
  [key: string]: unknown;
}

export class CulqiStrategy implements IPaymentStrategy {
  private pedidoService: PedidoService;

  constructor() {
    this.pedidoService = new PedidoService();
  }

  async processWebhook(payload: Record<string, unknown>): Promise<boolean> {
    try {
      if (!payload || !payload.type || !payload.data) {
        console.warn('⚠️ [Culqi Webhook] Estructura de payload inválida o incompleta.');
        return false;
      }

      const eventType = String(payload.type);
      let rawData = payload.data;

      if (typeof rawData === 'string') {
        try {
          rawData = JSON.parse(rawData);
        } catch {
          console.error('🔴 [Culqi Webhook] Error al deserializar campo data.');
          return false;
        }
      }

      let data = rawData as CulqiEventData;
      const objectId = data.id;

      if (!objectId) {
        console.warn('⚠️ [Culqi Webhook] Payload sin identificador de objeto.');
        return false;
      }

      // =======================================================================
      // ANTI-SPOOFING: Verificación Zero-Trust consultando a la API de Culqi
      // =======================================================================
      const endpoint = objectId.startsWith('chr_')
        ? 'charges'
        : objectId.startsWith('ord_')
          ? 'orders'
          : objectId.startsWith('ref_')
            ? 'refunds'
            : null;

      if (endpoint && process.env.CULQI_API_KEY) {
        const verifyRes = await fetch(`https://api.culqi.com/v2/${endpoint}/${objectId}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.CULQI_API_KEY}`,
          },
        });

        if (!verifyRes.ok) {
          console.error(`🚨 [Culqi Webhook Anti-Spoofing] El recurso ${objectId} no existe en Culqi.`);
          return false;
        }

        data = (await verifyRes.json()) as CulqiEventData;
      }

      const orderNumber = data.metadata?.orderNumber;
      const transactionRefId =
        eventType === 'refund.creation.succeeded' && data.charge_id
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
        console.warn(`⚠️ [Culqi Webhook] Pedido no encontrado para Ref: ${transactionRefId} / Order: ${orderNumber}`);
        return false;
      }

      // =======================================================================
      // 1. MANEJO DE REEMBOLSOS
      // =======================================================================
      if (eventType === 'refund.creation.succeeded') {
        if (pedido.status !== EstadoPedido.CANCELED) {
          console.log(`🔄 [Culqi Webhook] Procesando reembolso para pedido #${pedido.orderNumber}`);
          await this.pedidoService.actualizarEstadoPedido(pedido._id.toString(), EstadoPedido.CANCELED);
          pedido.payment.status = EstadoPago.REFUNDED;
          pedido.payment.gatewayData = {
            ...(pedido.payment.gatewayData || {}),
            refund_id: data.id,
            refund_data: data,
          };
          await pedido.save();
          console.log(`✅ [Culqi Webhook] Reembolso aplicado y stock devuelto para #${pedido.orderNumber}`);
        }
        return true;
      }

      // Idempotencia: Si ya está aprobado, ignoramos duplicados
      if (pedido.payment.status === EstadoPago.APPROVED) {
        return true;
      }

      // =======================================================================
      // 2. ÓRDENES DIFERIDAS (PagoEfectivo, Cuotéalo, QR)
      // =======================================================================
      if (eventType === 'order.state.changed' || eventType === 'order.status.changed') {
        if (data.state === 'paid') {
          console.log(`🚀 [Culqi Webhook] Orden diferida pagada: #${pedido.orderNumber}`);
          const chargeId = data.charges && data.charges.length > 0 ? data.charges[0].id : data.id;
          await this.pedidoService.confirmarPagoAprobado(pedido, chargeId, data);
          return true;
        }

        if (data.state === 'expired' || data.state === 'deleted' || data.state === 'error') {
          console.log(`❌ [Culqi Webhook] Orden diferida finalizada con estado: ${data.state} (#${pedido.orderNumber})`);
          await this.pedidoService.actualizarEstadoPedido(pedido._id.toString(), EstadoPedido.CANCELED);
          pedido.payment.status = EstadoPago.REJECTED;
          await pedido.save();
          return true;
        }

        if (data.state === 'processing') {
          return true;
        }
      }

      // =======================================================================
      // 3. CARGOS DIRECTOS ASÍNCRONOS (Tarjetas, Yape)
      // =======================================================================
      if (eventType === 'charge.creation.succeeded') {
        const isApproved =
          (data.outcome?.type === 'venta_exitosa' && data.action_code === '000') ||
          (data.outcome?.type === 'venta_exitosa' && !data.action_code);

        if (isApproved) {
          console.log(`🚀 [Culqi Webhook] Cargo exitoso confirmado para #${pedido.orderNumber}`);
          await this.pedidoService.confirmarPagoAprobado(pedido, data.id, data);
        }
        return true;
      }

      if (eventType === 'charge.creation.failed') {
        console.log(`❌ [Culqi Webhook] Cargo fallido reportado para #${pedido.orderNumber}`);
        await this.pedidoService.actualizarEstadoPedido(pedido._id.toString(), EstadoPedido.CANCELED);
        pedido.payment.status = EstadoPago.REJECTED;
        pedido.payment.gatewayData = {
          ...(pedido.payment.gatewayData || {}),
          failure_reason: data,
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