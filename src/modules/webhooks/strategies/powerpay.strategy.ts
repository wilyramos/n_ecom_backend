// File: backend/src/modules/webhooks/strategies/powerpay.strategy.ts

import crypto from 'crypto';
import { IPaymentStrategy } from './payment.strategy.interface';
import Pedido, { EstadoPago, EstadoPedido } from '../../pedidos/pedido.model';
import { PedidoService } from '../../pedidos/pedido.service';

interface PowerpayWebhookData {
  id?: string;
  Id?: string;
  status?: string;
  Status?: string;
  created_at?: string;
  Created_at?: string;
  signature?: string;
  Signature?: string;
  [key: string]: unknown;
}

export class PowerpayStrategy implements IPaymentStrategy {
  private pedidoService: PedidoService;

  constructor() {
    this.pedidoService = new PedidoService();
  }

  async processWebhook(payload: Record<string, unknown>, signatureHeader?: string): Promise<boolean> {
    try {
      console.log('\n================== [POWERPAY WEBHOOK INCOMING] ==================');
      console.log('📦 Raw Payload:', JSON.stringify(payload, null, 2));

      const rawData = (payload?.data && typeof payload.data === 'object')
        ? (payload.data as PowerpayWebhookData)
        : (payload as PowerpayWebhookData);

      const id = rawData.id || rawData.Id;
      const status = rawData.status || rawData.Status;
      const createdAt = rawData.created_at || rawData.Created_at;
      const signature = rawData.signature || rawData.Signature || signatureHeader;

      console.log(`🔍 [Powerpay Parsing]: Transaction ID=${id}, Status=${status}, CreatedAt=${createdAt}`);

      if (!id || !status || !signature || !createdAt) {
        console.warn('⚠️ [Powerpay Webhook] Payload incompleto: faltan campos obligatorios.');
        return false;
      }

      // 1. Verificación de Firma Criptográfica SHA-256 (secret_key~id~created_at)
      const secretKey = process.env.POWERPAY_SECRET_KEY || '';
      const stringToHash = `${secretKey}~${id}~${createdAt}`;
      const calculatedSignature = crypto.createHash('sha256').update(stringToHash).digest('hex');

      console.log('🔐 String to Hash:', `${secretKey.substring(0, 8)}...~${id}~${createdAt}`);
      console.log('🔑 Signature Recibida:   ', signature);
      console.log('🔑 Signature Calculada:  ', calculatedSignature);

      if (calculatedSignature.toLowerCase() !== signature.toLowerCase()) {
        console.warn('⚠️ [Powerpay Webhook] Firma inválida.');
        return false;
      }

      // 2. Búsqueda del Pedido
      const pedido = await Pedido.findOne({ 'payment.gatewayOrderId': id });
      if (!pedido) {
        console.warn(`⚠️ [Powerpay Webhook] Pedido no encontrado para gatewayOrderId: ${id}`);
        return false;
      }

      console.log(`📋 [Powerpay Webhook] Pedido encontrado: #${pedido.orderNumber} (Estado Actual: ${pedido.payment.status})`);

      // Idempotencia: Si ya estaba aprobado, no volvemos a descontar stock
      if (pedido.payment.status === EstadoPago.APPROVED) {
        console.log(`ℹ️ [Powerpay Webhook] Pedido #${pedido.orderNumber} ya se encontraba APROBADO previamente.`);
        return true;
      }

      const normalizedStatus = status.toLowerCase();

      // 3. Procesamiento según el estado de Powerpay
      if (normalizedStatus === 'processed') {
        console.log(`🚀 [Powerpay Webhook] Pago confirmado para orden #${pedido.orderNumber}. Iniciando descuento de inventario...`);

        // Ejecuta la transición atómica: actualiza a approved, descuenta stock de cada item y envía correos
        await this.pedidoService.confirmarPagoAprobado(pedido, id, payload);

        console.log(`✅ [Powerpay Webhook] Proceso finalizado: Orden #${pedido.orderNumber} aprobada y stock descontado.`);
        return true;
      } else if (normalizedStatus === 'canceled' || normalizedStatus === 'expired') {
        if (pedido.payment.status !== EstadoPago.REJECTED) {
          await this.pedidoService.actualizarEstadoPedido(pedido._id.toString(), EstadoPedido.CANCELED);
          pedido.payment.status = EstadoPago.REJECTED;
          pedido.payment.gatewayData = payload;
          await pedido.save();
          console.log(`❌ [Powerpay Webhook] Orden #${pedido.orderNumber} cancelada/expirada.`);
        }
        return true;
      }

      return true;
    } catch (error) {
      console.error('💥 [Powerpay Webhook Error]:', error);
      return false;
    }
  }
}