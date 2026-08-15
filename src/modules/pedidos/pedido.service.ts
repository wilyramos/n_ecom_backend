// File: backend/src/modules/pedidos/pedido.service.ts

import Pedido, { IPedido, EstadoPedido, EstadoPago } from './pedido.model';
import { CrearPedidoInput } from './pedido.schema';
import {
  IPedidoQueryParams,
  IRespuestaPedidosPaginados,
  IEstadisticasPedidos,
  IRespuestaCrearPedido,
} from './pedido.interfaces';
import { Types, FilterQuery } from 'mongoose';
import { preference } from '../../utils/mercadopago';

const MP_SURCHARGE_RATE = 0.12;

interface CulqiOrderResponse {
  id: string;
  object: string;
  amount: number;
  currency_code: string;
  payment_code?: string;
  state?: string;
}

interface CulqiChargeSuccessResponse {
  id: string;
  object: string;
  amount: number;
  currency_code: string;
  outcome?: {
    type: string;
    code: string;
    merchant_message: string;
    user_message: string;
  };
}

interface CulqiChargeErrorResponse {
  object: 'error';
  type: string;
  merchant_message: string;
  user_message: string;
  param?: string;
}

type CulqiApiResponse = CulqiChargeSuccessResponse | CulqiChargeErrorResponse;

interface StatsAggregationResult {
  ventasAprobadas: Array<{ montoTotal: number; conteoAprobados: number }>;
  estadosOperativos: Array<{ _id: string; count: number }>;
}

export class PedidoService {
  private async generarNumeroPedido(): Promise<string> {
    const hoy = new Date();

    // Formato YYMMDD (Ej: 260809 para 9 de Agosto de 2026)
    const year = hoy.getFullYear().toString().slice(-2);
    const month = String(hoy.getMonth() + 1).padStart(2, '0');
    const day = String(hoy.getDate()).padStart(2, '0');
    const fechaStr = `${year}${month}${day}`;

    const conteo = await Pedido.countDocuments({
      createdAt: {
        $gte: new Date(hoy.setHours(0, 0, 0, 0)),
        $lt: new Date(hoy.setHours(23, 59, 59, 999)),
      },
    });

    const secuencia = String(conteo + 1).padStart(4, '0');

    // Retorna un número de orden limpio y profesional. Ej: 260809-0001
    return `${fechaStr}-${secuencia}`;
  }
  private calcularTotales(items: CrearPedidoInput['items'], shippingCost: number, provider: string) {
    const montoTotalItems = items.reduce((acc, item) => acc + item.price * item.quantity, 0);

    const recargoFinanciero =
      provider === 'mercadopago' ? Number((montoTotalItems * MP_SURCHARGE_RATE).toFixed(2)) : 0;

    const totalPrice = montoTotalItems + shippingCost + recargoFinanciero;
    const subtotal = Number((totalPrice / 1.18).toFixed(2));
    const igv = Number((totalPrice - subtotal).toFixed(2));

    return {
      subtotal,
      igv,
      shippingCost,
      recargoFinanciero,
      totalPrice: Number(totalPrice.toFixed(2)),
    };
  }

  async crearPedido(data: CrearPedidoInput, userId?: string): Promise<IRespuestaCrearPedido<IPedido>> {
    const orderNumber = await this.generarNumeroPedido();
    const { subtotal, igv, shippingCost, recargoFinanciero, totalPrice } = this.calcularTotales(
      data.items,
      data.shippingCost,
      data.payment.provider
    );

    const nuevoPedido = new Pedido({
      orderNumber,
      user: userId ? new Types.ObjectId(userId) : undefined,
      customerProfile: data.customerProfile,
      deliveryMethod: data.deliveryMethod,
      invoiceInfo: data.invoiceInfo,
      items: data.items.map((item) => ({
        ...item,
        productId: new Types.ObjectId(item.productId),
        variantId: item.variantId ? new Types.ObjectId(item.variantId) : undefined,
      })),
      subtotal,
      igv,
      shippingCost,
      recargoFinanciero,
      totalPrice,
      currency: data.currency || 'PEN',
      status: EstadoPedido.AWAITING_PAYMENT,
      statusHistory: [{ status: EstadoPedido.AWAITING_PAYMENT, changedAt: new Date() }],
      shippingAddress: data.shippingAddress,
      payment: {
        provider: data.payment.provider,
        method: data.payment.method,
        paymentCode: data.payment.paymentCode,
        status: EstadoPago.PENDING,
      },
    });

    let initPoint: string | null = null;
    let culqiOrderId: string | null = null;

    if (data.payment.provider === 'mercadopago') {
      const itemsMP = data.items.map((item) => ({
        id: item.productId.toString(),
        title: item.nombre,
        quantity: item.quantity,
        unit_price: item.price,
        currency_id: 'PEN',
      }));

      if (shippingCost > 0) {
        itemsMP.push({ id: 'ENVIO', title: 'Envío', quantity: 1, unit_price: shippingCost, currency_id: 'PEN' });
      }

      const prefResponse = await preference.create({
        body: {
          items: itemsMP,
          payer: {
            name: data.customerProfile.nombre,
            surname: data.customerProfile.apellidos,
            email: data.customerProfile.email,
          },
          back_urls: {
            success: `${process.env.FRONTEND_URL}/checkout-result/success/${orderNumber}`,
            failure: `${process.env.FRONTEND_URL}/checkout-result/failure?order=${orderNumber}`,
            pending: `${process.env.FRONTEND_URL}/checkout-result/pending`,
          },
          auto_return: 'approved',
          external_reference: orderNumber,
        },
      });

      initPoint = prefResponse.init_point || null;
      nuevoPedido.payment.gatewayOrderId = prefResponse.id;
    } else if (data.payment.provider === 'culqi') {
      // 🚀 CREAR ORDEN EN CULQI DESDE EL BACKEND
      const culqiOrderPayload = {
        amount: Math.round(totalPrice * 100),
        currency_code: data.currency || 'PEN',
        description: `Orden de Compra ${orderNumber}`,
        order_number: orderNumber,
        client_details: {
          first_name: data.customerProfile.nombre,
          last_name: data.customerProfile.apellidos,
          email: data.customerProfile.email,
          phone_number: data.customerProfile.telefono,
        },
        expiration_date: Math.floor(Date.now() / 1000) + 86400, // 24H
      };

      try {
        const culqiOrderRes = await fetch('https://api.culqi.com/v2/orders', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.CULQI_API_KEY}`,
          },
          body: JSON.stringify(culqiOrderPayload),
        });

        const culqiOrderData = (await culqiOrderRes.json()) as CulqiOrderResponse;

        if (culqiOrderRes.ok && culqiOrderData.id) {
          culqiOrderId = culqiOrderData.id;
          nuevoPedido.payment.gatewayOrderId = culqiOrderId;
        }
      } catch (err) {
        console.error('[PedidoService] Fetch error en Culqi Orders:', err);
      }
    }

    await nuevoPedido.save();
    return { pedido: nuevoPedido, initPoint, culqiOrderId };
  }


  async procesarCargoCulqi(orderNumber: string, culqiTokenOrOrder: string) {
    const pedido = await Pedido.findOne({ orderNumber });
    if (!pedido) {
      throw new Error('No se encontró el pedido a procesar.');
    }

    if (pedido.payment.status === EstadoPago.APPROVED) {
      return { pedido };
    }

    if (!process.env.CULQI_API_KEY) {
      throw new Error('Configuración de pasarela incompleta (CULQI_API_KEY ausente).');
    }

    // 🚀 CASO 1: ES UNA ORDEN (PAGOEFECTIVO, CUOTÉALO, BILLETERA QR)
    if (culqiTokenOrOrder.startsWith('ord_')) {
      // Consultar el estado actual de la orden en Culqi para extraer el CIP o el QR (si es que no se pagó aún)
      const fetchOrderRes = await fetch(`https://api.culqi.com/v2/orders/${culqiTokenOrOrder}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.CULQI_API_KEY}`,
        },
      });

      if (fetchOrderRes.ok) {
        const orderData: any = await fetchOrderRes.json();

        pedido.payment.gatewayData = orderData;

        // Extraer Código de PagoEfectivo
        if (orderData.payment_code) {
          pedido.payment.paymentCode = orderData.payment_code;
        }

        // Si el estado en Culqi ya dice 'paid' (El cliente escaneó el QR en el modal y se aprobó rápido)
        if (orderData.state === 'paid') {
          pedido.payment.status = EstadoPago.APPROVED;
          pedido.payment.transactionId = orderData.id;
          pedido.payment.paidAt = new Date();
          pedido.status = EstadoPedido.PROCESSING;
          pedido.statusHistory.push({ status: EstadoPedido.PROCESSING, changedAt: new Date() });
          await pedido.save();
          return { pedido };
        }
      }

      // Si sigue pendiente en Culqi (El cliente generó el QR/CIP pero cerró el modal para pagar luego)
      pedido.payment.status = EstadoPago.PENDING;
      pedido.payment.gatewayOrderId = culqiTokenOrOrder;
      pedido.status = EstadoPedido.AWAITING_PAYMENT;
      await pedido.save();
      return { pedido };
    }

    // 🚀 CASO 2: ES UN TOKEN (TARJETA DE CRÉDITO / DÉBITO / YAPE APP DIRECTO)
    const amountInCents = Math.round(pedido.totalPrice * 100);

    const culqiPayload = {
      amount: amountInCents,
      currency_code: pedido.currency || 'PEN',
      email: pedido.customerProfile.email,
      source_id: culqiTokenOrOrder,
      antifraud_details: {
        first_name: pedido.customerProfile.nombre,
        last_name: pedido.customerProfile.apellidos,
        phone_number: pedido.customerProfile.telefono,
      },
      metadata: {
        orderNumber: pedido.orderNumber,
      },
    };

    const culqiResponse = await fetch('https://api.culqi.com/v2/charges', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.CULQI_API_KEY}`,
      },
      body: JSON.stringify(culqiPayload),
    });

    const culqiData = (await culqiResponse.json()) as CulqiApiResponse;

    if (!culqiResponse.ok) {
      const errorData = culqiData as CulqiChargeErrorResponse;
      pedido.payment.status = EstadoPago.REJECTED;
      await pedido.save();
      const userMessage =
        errorData.user_message || errorData.merchant_message || 'Transacción denegada por el banco emisor.';
      throw new Error(userMessage);
    }

    const successData = culqiData as CulqiChargeSuccessResponse;

    pedido.payment.status = EstadoPago.APPROVED;
    pedido.payment.transactionId = successData.id;
    pedido.payment.paidAt = new Date();
    pedido.payment.gatewayData = successData as unknown as Record<string, unknown>;

    pedido.status = EstadoPedido.PROCESSING;
    pedido.statusHistory.push({ status: EstadoPedido.PROCESSING, changedAt: new Date() });

    await pedido.save();
    return { pedido };
  }

  async obtenerPedidoPorId(pedidoId: string): Promise<IPedido> {
    const pedido = await Pedido.findById(pedidoId).populate('user', 'nombre email');
    if (!pedido) throw new Error('Pedido no encontrado');
    return pedido;
  }

  async obtenerPedidos(params: IPedidoQueryParams): Promise<IRespuestaPedidosPaginados<IPedido>> {
    const page = Number(params.page) || 1;
    const limit = Number(params.limit) || 10;
    const skip = (page - 1) * limit;

    const filtro: FilterQuery<IPedido> = {};

    if (params.status) filtro.status = params.status;
    if (params.userId) filtro.user = new Types.ObjectId(params.userId);
    if (params.paymentProvider) filtro['payment.provider'] = params.paymentProvider;
    if (params.deliveryMethod) filtro.deliveryMethod = params.deliveryMethod;

    if (params.search) {
      filtro.$or = [
        { orderNumber: { $regex: params.search, $options: 'i' } },
        { 'customerProfile.email': { $regex: params.search, $options: 'i' } },
        { 'customerProfile.numeroDocumento': { $regex: params.search, $options: 'i' } },
      ];
    }

    if (params.dateFrom || params.dateTo) {
      filtro.createdAt = {};
      if (params.dateFrom) filtro.createdAt.$gte = new Date(params.dateFrom);
      if (params.dateTo) {
        const endOfDay = new Date(params.dateTo);
        endOfDay.setHours(23, 59, 59, 999);
        filtro.createdAt.$lte = endOfDay;
      }
    }

    const [data, total] = await Promise.all([
      Pedido.find(filtro).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('user', 'nombre email'),
      Pedido.countDocuments(filtro),
    ]);

    return { data, pagination: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async actualizarEstadoPedido(pedidoId: string, nuevoEstado: EstadoPedido): Promise<IPedido> {
    const pedido = await Pedido.findById(pedidoId);
    if (!pedido) throw new Error('Pedido no encontrado');
    pedido.status = nuevoEstado;
    pedido.statusHistory.push({ status: nuevoEstado, changedAt: new Date() });
    return await pedido.save();
  }

  async obtenerPedidoPorNumero(orderNumber: string): Promise<IPedido> {
    const pedido = await Pedido.findOne({ orderNumber }).populate('user', 'nombre email');
    if (!pedido) throw new Error('Pedido no encontrado');
    return pedido;
  }

  async obtenerEstadisticasPedidos(): Promise<IEstadisticasPedidos> {
    const result = await Pedido.aggregate<StatsAggregationResult>([
      {
        $facet: {
          ventasAprobadas: [
            { $match: { 'payment.status': EstadoPago.APPROVED } },
            {
              $group: {
                _id: null,
                montoTotal: { $sum: '$totalPrice' },
                conteoAprobados: { $sum: 1 },
              },
            },
          ],
          estadosOperativos: [
            {
              $group: {
                _id: '$status',
                count: { $sum: 1 },
              },
            },
          ],
        },
      },
    ]);

    const ventasData = result[0]?.ventasAprobadas[0] || { montoTotal: 0, conteoAprobados: 0 };
    const estados = result[0]?.estadosOperativos || [];

    const getCountByStatus = (statusEnum: EstadoPedido) => {
      const found = estados.find((e) => e._id === statusEnum);
      return found ? found.count : 0;
    };

    const awaiting = getCountByStatus(EstadoPedido.AWAITING_PAYMENT);
    const processing = getCountByStatus(EstadoPedido.PROCESSING);
    const shipped = getCountByStatus(EstadoPedido.SHIPPED);
    const delivered = getCountByStatus(EstadoPedido.DELIVERED);
    const canceled = getCountByStatus(EstadoPedido.CANCELED);

    return {
      totalRecaudado: Number(ventasData.montoTotal.toFixed(2)),
      totalApprovedOrders: ventasData.conteoAprobados,
      pendientesCount: awaiting + processing,
      enProcesoCount: processing,
      enviadosCount: shipped,
      entregadosCount: delivered,
      canceladosCount: canceled,
    };
  }
}