// File: backend/src/modules/webhooks/webhook.service.ts

import { IPaymentStrategy } from './strategies/payment.strategy.interface';
import { MercadoPagoStrategy } from './strategies/mercadopago.strategy';
import { CulqiStrategy } from './strategies/culqi.strategy';
import { IzipayStrategy } from './strategies/izipay.strategy';

export class WebhookService {
    private strategies: Record<string, IPaymentStrategy>;

    constructor() {
        // Registro de todas las pasarelas soportadas
        this.strategies = {
            mercadopago: new MercadoPagoStrategy(),
            culqi: new CulqiStrategy(),
            izipay: new IzipayStrategy(),
        };
    }

    async handleWebhook(provider: string, payload: Record<string, unknown>, signature?: string): Promise<void> {
        const strategy = this.strategies[provider.toLowerCase()];
        
        if (!strategy) {
            console.warn(`⚠️ [Webhooks Service] Proveedor no soportado o inválido: ${provider}`);
            return;
        }

        const success = await strategy.processWebhook(payload, signature);
        
        if (!success) {
            console.warn(`⚠️ [Webhooks Service] El procesamiento del payload para ${provider} falló o fue descartado.`);
        }
    }
}