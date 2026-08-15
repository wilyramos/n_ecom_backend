// File: backend/src/modules/webhooks/strategies/payment.strategy.interface.ts

export interface IPaymentStrategy {
    /**
     * Procesa la notificación enviada por la pasarela de pago.
     * @param payload El body recibido en la petición.
     * @param signature Firma de seguridad (opcional/requerida según el proveedor).
     * @returns boolean indicando si se procesó exitosamente.
     */
    processWebhook(payload: Record<string, unknown>, signature?: string): Promise<boolean>;
}