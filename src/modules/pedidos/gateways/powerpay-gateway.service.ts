// File: backend/src/modules/pedidos/gateways/powerpay-gateway.service.ts

import { IPaymentGatewayService, PaymentGatewayResult } from './payment-gateway.interface';
import { IPedido } from '../pedido.model';
import { CrearPedidoInput } from '../pedido.schema';

interface PowerpayCreateTransactionResponse {
  id?: string;
  Id?: string;
  redirection_url?: string;
  Redirection_url?: string;
  external_id?: string;
  message?: string;
  Message?: string;
  code?: string | number;
  Code?: string | number;
}

export class PowerpayGatewayService implements IPaymentGatewayService {
  readonly providerName = 'powerpay';

  async crearPreferencia(pedido: IPedido, data: CrearPedidoInput, userId?: string): Promise<PaymentGatewayResult> {
    // 1. Validación de acuerdos comerciales de montos mínimo y máximo
    const minAmount = Number(process.env.POWERPAY_MIN_AMOUNT || 50);
    const maxAmount = Number(process.env.POWERPAY_MAX_AMOUNT || 10000);

    if (pedido.totalPrice < minAmount) {
      throw new Error(`El monto mínimo para financiar con Powerpay es de S/ ${minAmount.toFixed(2)}.`);
    }

    if (pedido.totalPrice > maxAmount) {
      throw new Error(`El monto máximo permitido para financiar con Powerpay es de S/ ${maxAmount.toFixed(2)}.`);
    }

    // 2. Configuración de credenciales y endpoints
    const powerpayEndpoint =
      process.env.POWERPAY_API_URL ||
      'https://mo-services-bbva-bnpl-pe-green.moprestamo.com/api/merchant-transactions';

    const secretKey = process.env.POWERPAY_SECRET_KEY || '';
    if (!secretKey) {
      throw new Error('Configuración de pasarela incompleta: POWERPAY_SECRET_KEY ausente.');
    }

    const base64Auth = Buffer.from(secretKey).toString('base64');
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

    // 3. Formateo estricto de campos según especificación técnica
    const isStorePickup = data.deliveryMethod === 'pickup';
    const shippingAddressFormatted = isStorePickup
      ? 'InStore'
      : `${data.shippingAddress.direccion} ${data.shippingAddress.numero || ''}`.trim();

    // Solo letras y números, hasta 45 caracteres
    const cleanExternalId = pedido.orderNumber.replace(/[^a-zA-Z0-9]/g, '').substring(0, 45);

    // Concepto de pago truncado a 300 caracteres
    const paymentConcept = data.items
      .map((item) => item.nombre)
      .join(', ')
      .substring(0, 300);

    const powerpayPayload = {
      external_id: cleanExternalId,
      callback_url: `${frontendUrl}/checkout-result/powerpay-response`,
      amount: pedido.totalPrice.toFixed(2),
      values: {
        merchant_id: process.env.POWERPAY_MERCHANT_ID || '',
        currency: 'PEN',
        document_number: data.customerProfile.numeroDocumento,
        document_type: data.customerProfile.tipoDocumento === 'DNI' ? 'DNI' : 'DNI',
        first_name: data.customerProfile.nombre.substring(0, 100),
        last_name: data.customerProfile.apellidos.substring(0, 100),
        email: data.customerProfile.email.substring(0, 50),
        country_code: '+51',
        phone_number: data.customerProfile.telefono.replace(/\D/g, ''),
        payment_concept: paymentConcept,
        shipping_postal_code: 15000,
        shipping_address: shippingAddressFormatted.substring(0, 200),
        additional_data1: userId ? 'Old' : 'New',
        channel: 'Web',
      },
    };

    // 4. Invocación de API de generación de transacción
    const response = await fetch(powerpayEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: base64Auth,
      },
      body: JSON.stringify(powerpayPayload),
    });

    const dataPP = (await response.json()) as PowerpayCreateTransactionResponse;
    const redirectUrl = dataPP.redirection_url || dataPP.Redirection_url;
    const transactionId = dataPP.id || dataPP.Id;

    if (!response.ok || !redirectUrl) {
      console.error('💥 [Powerpay API Error]:', dataPP);
      throw new Error(dataPP.message || dataPP.Message || 'Error al conectar con la pasarela Powerpay.');
    }

    return {
      initPoint: redirectUrl,
      gatewayOrderId: transactionId,
      gatewayData: dataPP as Record<string, unknown>,
    };
  }
}