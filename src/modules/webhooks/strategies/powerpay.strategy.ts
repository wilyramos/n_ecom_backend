import crypto from 'crypto';
import { IPaymentStrategy } from './payment.strategy.interface';
import Pedido from '../../pedidos/pedido.model';
import { EstadoPago, EstadoPedido } from '../../pedidos/pedido.model';

export class PowerpayStrategy implements IPaymentStrategy {
  async processWebhook(payload: Record<string, unknown>, signatureHeader?: string): Promise<boolean> {
    try {
      const id = payload.Id as string;
      const status = payload.Status as string;
      const createdAt = payload.Created_at as string;
      const signature = payload.Signature as string;

      if (!id || !status || !signature || !createdAt) return false;

      // Validación de la firma: secret_key~id~created_at (codificado con SHA256)[cite: 2]
      const secretKey = process.env.POWERPAY_SECRET_KEY || '';
      const stringToHash = `${secretKey}~${id}~${createdAt}`;
      const calculatedSignature = crypto.createHash('sha256').update(stringToHash).digest('hex');

      if (calculatedSignature !== signature) {
        console.warn('⚠️ [Powerpay Webhook] Firma inválida.');
        return false;
      }

      // Buscar el pedido por el ID de transacción de Powerpay
      const pedido = await Pedido.findOne({ 'payment.gatewayOrderId': id });
      if (!pedido) {
        console.warn(`⚠️ [Powerpay Webhook] Pedido no encontrado para ID: ${id}`);
        return false;
      }

      // El estado de la transacción solo puede cambiar a "Pagado" una sola vez[cite: 1]
      if (pedido.payment.status === EstadoPago.APPROVED) {
        return true;
      }

      let estadoModificado = false;

      // Evaluación de estados de la transacción de Powerpay[cite: 1, 2]
      if (status === 'Processed') {
        pedido.payment.status = EstadoPago.APPROVED;
        pedido.status = EstadoPedido.PROCESSING;
        pedido.payment.paidAt = new Date();
        pedido.payment.transactionId = id;
        estadoModificado = true;
      } else if (status === 'Canceled' || status === 'Expired') {
        if (pedido.payment.status !== EstadoPago.REJECTED) {
          pedido.payment.status = EstadoPago.REJECTED;
          pedido.status = EstadoPedido.CANCELED;
          estadoModificado = true;
        }
      }

      if (estadoModificado) {
        pedido.payment.gatewayData = payload;
        pedido.statusHistory.push({
          status: pedido.status,
          changedAt: new Date()
        });

        await pedido.save();
        console.log(`🚀 [Powerpay Webhook] Pedido actualizado a ${pedido.payment.status}.`);
      }

      return true; // El WebhookController enviará automáticamente el estado 200 OK requerido[cite: 1, 2]
    } catch (error) {
      console.error('💥 [Powerpay Webhook Error]:', error);
      return false;
    }
  }
}