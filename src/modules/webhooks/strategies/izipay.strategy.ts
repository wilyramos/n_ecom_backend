// File: backend/src/modules/webhooks/strategies/izipay.strategy.ts

import { IPaymentStrategy } from './payment.strategy.interface';

export class IzipayStrategy implements IPaymentStrategy {
    async processWebhook(payload: Record<string, unknown>, signature?: string): Promise<boolean> {
        try {
            // Izipay requiere validación estricta de firma usando SHA-256 HMAC
            console.log('🚧 [Izipay Webhook] Recibido. Pendiente implementación.', payload);
            return true; 
        } catch (error) {
            console.error('💥 [Izipay Webhook Error]:', error);
            return false;
        }
    }
}