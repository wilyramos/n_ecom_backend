//File: backend/src/modules/pedidos/gateways/payment-gateway.interface.ts

import { IPedido } from '../pedido.model';
import { CrearPedidoInput } from '../pedido.schema';

export interface PaymentGatewayResult {
  initPoint?: string | null;
  gatewayOrderId?: string | null;
  gatewayData?: Record<string, unknown>;
}

export interface IPaymentGatewayService {
  readonly providerName: string;
  crearPreferencia(pedido: IPedido, data: CrearPedidoInput, userId?: string): Promise<PaymentGatewayResult>;
}