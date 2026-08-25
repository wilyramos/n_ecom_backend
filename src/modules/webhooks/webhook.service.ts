import { IPaymentStrategy } from './strategies/payment.strategy.interface';
import { MercadoPagoStrategy } from './strategies/mercadopago.strategy';
import { CulqiStrategy } from './strategies/culqi.strategy';
import { IzipayStrategy } from './strategies/izipay.strategy';
import { PowerpayStrategy } from './strategies/powerpay.strategy';

export class WebhookService {
    private strategies: Record<string, IPaymentStrategy>;

    constructor() {
        this.strategies = {
            mercadopago: new MercadoPagoStrategy(),
            culqi: new CulqiStrategy(),
            izipay: new IzipayStrategy(),
            powerpay: new PowerpayStrategy(),
        };
    }

    async handleWebhook(provider: string, payload: Record<string, unknown>, signature?: string): Promise<void> {
        const key = provider.toLowerCase();
        console.log(`⚙️ [Webhook Service] Resolviendo estrategia para el proveedor: "${key}"`);

        const strategy = this.strategies[key];
        
        if (!strategy) {
            console.warn(`⚠️ [Webhook Service] Proveedor no soportado o inválido: ${provider}`);
            return;
        }

        console.log(`🔄 [Webhook Service] Ejecutando estrategia [${strategy.constructor.name}]`);
        const success = await strategy.processWebhook(payload, signature);
        
        if (!success) {
            console.warn(`⚠️ [Webhook Service] Falló o fue descartado el procesamiento para ${provider}`);
        } else {
            console.log(`✅ [Webhook Service] Procesamiento completado con éxito para ${provider}`);
        }
    }
}