//File: backend/src/modules/pedidos/gateways/payment-gateway.factory.ts

import { IPaymentGatewayService } from './payment-gateway.interface';
import { PowerpayGatewayService } from './powerpay-gateway.service';
import { CulqiGatewayService } from './culqi-gateway.service';
import { MercadoPagoGatewayService } from './mercadopago-gateway.service';

export class PaymentGatewayFactory {
    private static gateways: Map<string, IPaymentGatewayService> = new Map<string, IPaymentGatewayService>([
        ['powerpay', new PowerpayGatewayService()],
        ['culqi', new CulqiGatewayService()],
        ['mercadopago', new MercadoPagoGatewayService()],
    ]);

    static get(provider: string): IPaymentGatewayService | undefined {
        return this.gateways.get(provider.toLowerCase());
    }
}