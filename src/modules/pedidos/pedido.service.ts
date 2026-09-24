// File: backend/src/modules/pedidos/pedido.service.ts

import Pedido, { IPedido, EstadoPedido, EstadoPago } from './pedido.model';
import { UsersService } from '../users/users.service';
import { CrearPedidoInput } from './pedido.schema';
import {
  IPedidoQueryParams,
  IRespuestaPedidosPaginados,
  IEstadisticasPedidos,
  IRespuestaCrearPedido,
} from './pedido.interfaces';
import { Types, FilterQuery } from 'mongoose';
import crypto from 'crypto';
import { PaymentGatewayFactory } from './gateways/payment-gateway.factory';
import { OrderEmail } from '../../emails/OrderEmailResend';
import { InventoryService } from '../inventory/inventory.service';
import { AppError } from '../../utils/AppError';

const MP_SURCHARGE_RATE = 0.12;

interface StatsAggregationResult {
  ventasAprobadas: Array<{ montoTotal: number; conteoAprobados: number }>;
  estadosOperativos: Array<{ _id: string; count: number }>;
}

const TRANSICIONES_VALIDAS: Record<EstadoPedido, EstadoPedido[]> = {
  [EstadoPedido.AWAITING_PAYMENT]: [EstadoPedido.PROCESSING, EstadoPedido.CANCELED],
  [EstadoPedido.PROCESSING]: [
    EstadoPedido.SHIPPED,
    EstadoPedido.DELIVERED,
    EstadoPedido.PAID_BUT_OUT_OF_STOCK,
    EstadoPedido.CANCELED,
  ],
  [EstadoPedido.PAID_BUT_OUT_OF_STOCK]: [EstadoPedido.PROCESSING, EstadoPedido.CANCELED],
  [EstadoPedido.SHIPPED]: [EstadoPedido.DELIVERED, EstadoPedido.CANCELED],
  [EstadoPedido.DELIVERED]: [],
  [EstadoPedido.CANCELED]: [],
};

export class PedidoService {
  private async generarNumeroPedido(): Promise<string> {
    const hoy = new Date();
    const year = hoy.getFullYear().toString().slice(-2);
    const month = String(hoy.getMonth() + 1).padStart(2, '0');
    const day = String(hoy.getDate()).padStart(2, '0');
    const fechaStr = `${year}${month}${day}`;

    const inicioDia = new Date(hoy);
    inicioDia.setHours(0, 0, 0, 0);

    const finDia = new Date(hoy);
    finDia.setHours(23, 59, 59, 999);

    const conteo = await Pedido.countDocuments({
      createdAt: { $gte: inicioDia,$lt: finDia },
    });

    const secuencia = String(conteo + 1).padStart(4, '0');
    const randomSalt = crypto.randomBytes(2).toString('hex').toUpperCase();

    return `${fechaStr}${secuencia}${randomSalt}`;
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

  async dispararCorreosConfirmacion(pedido: IPedido): Promise<void> {
    try {
      const fullAddress =
        pedido.deliveryMethod === 'pickup'
          ? 'Recojo en Tienda Oficial'
          : `${pedido.shippingAddress.direccion} (${pedido.shippingAddress.distrito}, ${pedido.shippingAddress.provincia} - ${pedido.shippingAddress.departamento})`;

      const customerName = `${pedido.customerProfile.nombre} ${pedido.customerProfile.apellidos || ''}`.trim();

      const itemsPayload = (pedido.items || []).map((it: any) => ({
        nombre: it.nombre,
        quantity: it.quantity,
        price: it.price,
        imagen: it.imagen,
      }));

      await Promise.allSettled([
        OrderEmail.sendOrderConfirmationEmail({
          email: pedido.customerProfile.email,
          name: customerName,
          orderId: pedido.orderNumber,
          totalPrice: pedido.totalPrice,
          shippingMethod: fullAddress,
          items: itemsPayload,
        }),
        OrderEmail.notifyAdminsOnNewOrder(pedido),
      ]);
    } catch (error) {
      console.error(`⚠️ [PedidoService] Fallo enviando correos de orden #${pedido.orderNumber}:`, error);
    }
  }

  async confirmarPagoAprobado(pedido: IPedido, transactionId: string, gatewayData?: any): Promise<void> {
    if (pedido.payment.status === EstadoPago.APPROVED) return;

    pedido.payment.status = EstadoPago.APPROVED;
    pedido.payment.transactionId = transactionId;
    pedido.payment.paidAt = new Date();

    if (gatewayData) {
      pedido.payment.gatewayData = gatewayData;

      if (pedido.payment.provider === 'culqi') {
        const source = gatewayData.source || gatewayData.charges?.[0]?.source;

        pedido.payment.details = {
          installments: gatewayData.installments || gatewayData.metadata?.installments || 1,
        };

        if (source) {
          if (source.iin) {
            pedido.payment.details.brand = source.iin.card_brand || source.iin.card_type;
            pedido.payment.details.issuerName = source.iin.issuer?.name;
            pedido.payment.details.cardType = source.iin.card_category;
          }

          if (source.last_four) {
            pedido.payment.details.lastFour = source.last_four;
            pedido.payment.details.paymentMethod = 'tarjeta';
          } else if (source.type === 'yape') {
            pedido.payment.details.paymentMethod = 'yape';
            pedido.payment.details.brand = 'Yape';
          }
        } else if (gatewayData.payment_code) {
          pedido.payment.details.paymentMethod = 'pagoefectivo';
        }
      }
    }

    pedido.status = EstadoPedido.PROCESSING;
    pedido.statusHistory.push({ status: EstadoPedido.PROCESSING, changedAt: new Date() });

    await pedido.save();
    await InventoryService.descontarStockItems(pedido.items);

    this.dispararCorreosConfirmacion(pedido).catch((err) =>
      console.error('Error background correo confirmación:', err)
    );
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
      customerProfile: {
        ...data.customerProfile,
        email: data.customerProfile.email.trim().toLowerCase(),
      },
      receiverInfo: data.receiverInfo,
      deliveryNotes: data.deliveryNotes,
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

    const gatewayService = PaymentGatewayFactory.get(data.payment.provider);

    if (gatewayService) {
      const gatewayResult = await gatewayService.crearPreferencia(nuevoPedido, data, userId);
      initPoint = gatewayResult.initPoint || null;
      culqiOrderId = data.payment.provider === 'culqi' ? gatewayResult.gatewayOrderId || null : null;

      if (gatewayResult.gatewayOrderId) {
        nuevoPedido.payment.gatewayOrderId = gatewayResult.gatewayOrderId;
      }
      if (gatewayResult.gatewayData) {
        nuevoPedido.payment.gatewayData = gatewayResult.gatewayData;
      }
    }

    await nuevoPedido.save();

    // Sincronización desacoplada llamando al servicio del módulo Users
    if (userId) {
      UsersService.syncCheckoutProfile(userId, {
        nombre: data.customerProfile.nombre,
        apellidos: data.customerProfile.apellidos,
        telefono: data.customerProfile.telefono,
        tipoDocumento: data.customerProfile.tipoDocumento,
        numeroDocumento: data.customerProfile.numeroDocumento,
      }).catch((err) =>
        console.error('⚠️ [PedidoService] Error sincronizando datos al perfil de usuario:', err)
      );
    }

    return { pedido: nuevoPedido, initPoint, culqiOrderId };
  }

  async cancelarPedidoAbordado(orderNumber: string): Promise<void> {
    const pedido = await Pedido.findOne({ orderNumber: orderNumber.trim() });
    if (!pedido || pedido.status === EstadoPedido.CANCELED) return;

    const pagoPreviamenteAprobado = pedido.payment.status === EstadoPago.APPROVED;

    pedido.status = EstadoPedido.CANCELED;
    pedido.payment.status = EstadoPago.REJECTED;
    pedido.statusHistory.push({ status: EstadoPedido.CANCELED, changedAt: new Date() });

    await pedido.save();

    if (pagoPreviamenteAprobado) {
      await InventoryService.reponerStockItems(pedido.items);
      console.log(`📦 [Inventario] Stock repuesto para pedido cancelado #${orderNumber}`);
    }
  }

  async procesarCargoCulqi(
    orderNumber: string,
    culqiTokenOrOrder: string,
    parameters3DS?: Record<string, unknown>,
    deviceFingerPrintId?: string,
    installments: number = 1
  ) {
    const pedido = await Pedido.findOne({ orderNumber: orderNumber.trim() });

    if (!pedido) throw Object.assign(new Error('No se encontró el pedido a procesar.'), { statusCode: 404 });
    if (pedido.payment.status === EstadoPago.APPROVED) return { pedido, status: 'approved' };
    if (!process.env.CULQI_API_KEY) throw Object.assign(new Error('Configuración incompleta: CULQI_API_KEY ausente.'), { statusCode: 500 });

    if (culqiTokenOrOrder.startsWith('chr_')) {
      const fetchChargeRes = await fetch(`https://api.culqi.com/v2/charges/${culqiTokenOrOrder}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.CULQI_API_KEY}`,
        },
      });

      const chargeData = (await fetchChargeRes.json()) as Record<string, any>;

      if (
        !fetchChargeRes.ok ||
        chargeData.outcome?.type !== 'venta_exitosa' ||
        (chargeData.action_code && chargeData.action_code !== '000')
      ) {
        pedido.status = EstadoPedido.CANCELED;
        pedido.payment.status = EstadoPago.REJECTED;
        pedido.payment.gatewayData = { ...(pedido.payment.gatewayData || {}), lastError: chargeData };
        await pedido.save();

        throw Object.assign(new Error(chargeData.user_message || 'Transacción denegada por el banco emisor.'), { statusCode: 400 });
      }

      await this.confirmarPagoAprobado(pedido, chargeData.id, chargeData);
      return { pedido, status: 'approved' };
    }

    if (culqiTokenOrOrder.startsWith('ord_')) {
      const fetchOrderRes = await fetch(`https://api.culqi.com/v2/orders/${culqiTokenOrOrder}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.CULQI_API_KEY}`,
        },
      });

      const orderData = (await fetchOrderRes.json()) as Record<string, any>;
      pedido.payment.gatewayData = orderData;

      if (!fetchOrderRes.ok) {
        pedido.status = EstadoPedido.CANCELED;
        pedido.payment.status = EstadoPago.REJECTED;
        pedido.payment.gatewayData = { ...(pedido.payment.gatewayData || {}), lastError: orderData };
        await pedido.save();

        throw Object.assign(new Error(orderData.user_message || 'El proceso de validación fue cancelado.'), { statusCode: 400 });
      }

      if (orderData.state === 'paid') {
        const chargeId = orderData.charges && orderData.charges.length > 0 ? orderData.charges[0].id : orderData.id;
        await this.confirmarPagoAprobado(pedido, chargeId, orderData);
        return { pedido, status: 'approved' };
      }

      if (orderData.state === 'pending' && orderData.payment_code) {
        pedido.payment.status = EstadoPago.PENDING;
        pedido.payment.gatewayOrderId = culqiTokenOrOrder;
        pedido.payment.paymentCode = orderData.payment_code;
        pedido.status = EstadoPedido.AWAITING_PAYMENT;
        await pedido.save();
        return { pedido, status: 'pending', paymentCode: orderData.payment_code };
      }

      pedido.status = EstadoPedido.CANCELED;
      pedido.payment.status = EstadoPago.REJECTED;

      let userMessage = 'La transacción fue rechazada por el banco emisor o cancelada.';
      if (orderData.charges && orderData.charges.length > 0) {
        userMessage = orderData.charges[0].user_message || userMessage;
      }

      await pedido.save();
      throw Object.assign(new Error(userMessage), { statusCode: 400 });
    }

    const amountInCents = Math.round(pedido.totalPrice * 100);
    const cleanPhone = (pedido.customerProfile.telefono || '').replace(/\D/g, '').substring(0, 15);

    const payload: Record<string, any> = {
      amount: amountInCents,
      currency_code: pedido.currency || 'PEN',
      email: pedido.customerProfile.email,
      source_id: culqiTokenOrOrder,
      antifraud_details: {
        first_name: pedido.customerProfile.nombre,
        last_name: pedido.customerProfile.apellidos,
        phone_number: cleanPhone.length >= 5 ? cleanPhone : '999999999',
        ...(deviceFingerPrintId && { device_finger_print_id: deviceFingerPrintId }),
      },
      metadata: { orderNumber: pedido.orderNumber },
    };

    if (installments && installments > 1) {
      payload.installments = installments;
    }

    if (parameters3DS) {
      payload.authentication_3DS = parameters3DS;
    }

    const culqiResponse = await fetch('https://api.culqi.com/v2/charges', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.CULQI_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    const culqiData = (await culqiResponse.json()) as Record<string, any>;

    if (culqiResponse.status === 200 && culqiData.action_code === 'REVIEW') {
      pedido.payment.gatewayData = { ...(pedido.payment.gatewayData || {}), last3DSChallenge: culqiData };
      await pedido.save();
      return { pedido, status: 'requires_3ds' };
    }

    const isSuccess =
      culqiResponse.status === 201 &&
      culqiData.object === 'charge' &&
      culqiData.outcome?.type === 'venta_exitosa' &&
      (!culqiData.action_code || culqiData.action_code === '000');

    if (!isSuccess) {
      pedido.status = EstadoPedido.CANCELED;
      pedido.payment.status = EstadoPago.REJECTED;
      pedido.payment.gatewayData = { ...(pedido.payment.gatewayData || {}), lastError: culqiData };
      await pedido.save();

      const errorMessage = culqiData.user_message || culqiData.merchant_message || 'Transacción denegada por el banco emisor.';
      throw Object.assign(new Error(errorMessage), { statusCode: 400 });
    }

    await this.confirmarPagoAprobado(pedido, culqiData.id, culqiData);
    return { pedido, status: 'approved' };
  }

  async obtenerMisPedidosCliente(userId: string, email: string): Promise<IPedido[]> {
    const cleanEmail = email.trim().toLowerCase();
    return await Pedido.find({
      $or: [
        { user: new Types.ObjectId(userId) },
        { user: { $exists: false }, 'customerProfile.email': cleanEmail },
        { user: null, 'customerProfile.email': cleanEmail },
      ],
    })
      .sort({ createdAt: -1 })
      .populate('user', 'nombre apellidos email');
  }

  async obtenerPedidoPorId(pedidoId: string, userId?: string, email?: string, isAdmin: boolean = false): Promise<IPedido> {
    const cleanEmail = email ? email.trim().toLowerCase() : undefined;
    let filtro: FilterQuery<IPedido> = { _id: pedidoId };

    if (!isAdmin && (userId || cleanEmail)) {
      filtro = {
        _id: pedidoId,
        $or: [
          ...(userId ? [{ user: new Types.ObjectId(userId) }] : []),
          ...(cleanEmail ? [{ 'customerProfile.email': cleanEmail }] : []),
        ],
      };
    }

    const pedido = await Pedido.findOne(filtro).populate('user', 'nombre email');
    if (!pedido) {
      throw new AppError(`No se encontró el pedido: ${pedidoId}`, 404);
    }
    return pedido;
  }

  async obtenerPedidoPorNumero(orderNumber: string): Promise<IPedido> {
    const cleanSearch = orderNumber.trim();
    const alphanumericOnly = cleanSearch.replace(/[^a-zA-Z0-9]/g, '');
    const flexibleRegex = new RegExp(`^${alphanumericOnly.split('').join('-?')}$`, 'i');

    const pedido = await Pedido.findOne({
      $or: [
        { orderNumber: cleanSearch },
        { orderNumber: flexibleRegex },
        { 'payment.gatewayOrderId': cleanSearch },
        { 'payment.transactionId': cleanSearch },
      ],
    }).populate('user', 'nombre email');

    if (!pedido) {
      throw Object.assign(new Error(`No se encontró el pedido: ${orderNumber}`), { statusCode: 404 });
    }
    return pedido;
  }

  async consultarTrackingPublico(orderNumber: string, emailOrDoc: string): Promise<IPedido> {
    const cleanSearch = orderNumber.trim();
    const alphanumericOnly = cleanSearch.replace(/[^a-zA-Z0-9]/g, '');
    const flexibleRegex = new RegExp(`^${alphanumericOnly.split('').join('-?')}$`, 'i');
    const docOrEmail = emailOrDoc.trim().toLowerCase();

    const pedido = await Pedido.findOne({
      $and: [
        {
          $or: [
            { orderNumber: cleanSearch },
            { orderNumber: flexibleRegex },
            { 'payment.gatewayOrderId': cleanSearch },
          ],
        },
        {
          $or: [
            { 'customerProfile.email': docOrEmail },
            { 'customerProfile.numeroDocumento': docOrEmail },
          ],
        },
      ],
    }).select('-payment.gatewayData');

    if (!pedido) {
      throw new AppError('No se encontró el pedido con los datos proporcionados.', 404);
    }
    return pedido;
  }

  async vincularPedidosInvitado(email: string, userId: string): Promise<number> {
    const cleanEmail = email.trim().toLowerCase();
    const result = await Pedido.updateMany(
      {
        $or: [{ user: {$exists: false } }, { user: null }],
        'customerProfile.email': cleanEmail,
      },
      { $set: { user: new Types.ObjectId(userId) } }
    );
    return result.modifiedCount;
  }

  async obtenerPedidos(params: IPedidoQueryParams): Promise<IRespuestaPedidosPaginados<IPedido>> {
    const page = Number(params.page) || 1;
    const limit = Number(params.limit) || 10;
    const skip = (page - 1) * limit;
    const filtro: FilterQuery<IPedido> = {};

    if (
      params.status &&
      params.status !== 'all' &&
      Object.values(EstadoPedido).includes(params.status as EstadoPedido)
    ) {
      filtro.status = params.status as EstadoPedido;
    }

    if (params.paymentStatus && params.paymentStatus !== 'all') {
      filtro['payment.status'] = params.paymentStatus;
    }

    if (params.userId) filtro.user = new Types.ObjectId(params.userId);
    if (params.paymentProvider && params.paymentProvider !== 'all') filtro['payment.provider'] = params.paymentProvider;
    if (params.deliveryMethod && params.deliveryMethod !== 'all') filtro.deliveryMethod = params.deliveryMethod;

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

  async obtenerEstadisticasPedidos(): Promise<IEstadisticasPedidos> {
    const result = await Pedido.aggregate<StatsAggregationResult>([
      {
        $facet: {
          ventasAprobadas: [
            {
              $match: {
                'payment.status': EstadoPago.APPROVED,
                status: { $ne: EstadoPedido.CANCELED },
              },
            },
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

    return {
      totalRecaudado: Number(ventasData.montoTotal.toFixed(2)),
      totalApprovedOrders: ventasData.conteoAprobados,
      pendientesCount: getCountByStatus(EstadoPedido.AWAITING_PAYMENT) + getCountByStatus(EstadoPedido.PROCESSING),
      enProcesoCount: getCountByStatus(EstadoPedido.PROCESSING),
      enviadosCount: getCountByStatus(EstadoPedido.SHIPPED),
      entregadosCount: getCountByStatus(EstadoPedido.DELIVERED),
      canceladosCount: getCountByStatus(EstadoPedido.CANCELED),
    };
  }

  async actualizarEstadoPedido(pedidoId: string, nuevoEstado: EstadoPedido): Promise<IPedido> {
    const pedido = await Pedido.findById(pedidoId);
    if (!pedido) throw new AppError('Pedido no encontrado', 404);

    const estadoAnterior = pedido.status;
    const pagoAprobadoPrevio = pedido.payment.status === EstadoPago.APPROVED;

    if (estadoAnterior === nuevoEstado) return pedido;

    const transicionesPermitidas = TRANSICIONES_VALIDAS[estadoAnterior] || [];
    if (!transicionesPermitidas.includes(nuevoEstado)) {
      throw new AppError(
        `Cambio de estado inválido. No es posible transicionar de '${estadoAnterior}' a '${nuevoEstado}'.`,
        400
      );
    }

    pedido.status = nuevoEstado;
    pedido.statusHistory.push({ status: nuevoEstado, changedAt: new Date() });

    if (
      pagoAprobadoPrevio &&
      nuevoEstado === EstadoPedido.CANCELED &&
      estadoAnterior !== EstadoPedido.CANCELED
    ) {
      await InventoryService.reponerStockItems(pedido.items);
      console.log(`📦 [Inventario] Stock reabastecido para la orden cancelada #${pedido.orderNumber}`);
    }

    const pedidoActualizado = await pedido.save();

    if (nuevoEstado !== EstadoPedido.AWAITING_PAYMENT) {
      const customerName = `${pedidoActualizado.customerProfile.nombre} ${pedidoActualizado.customerProfile.apellidos || ''}`.trim();

      OrderEmail.sendStatusUpdateEmail({
        email: pedidoActualizado.customerProfile.email,
        name: customerName,
        orderId: pedidoActualizado.orderNumber,
        newStatus: nuevoEstado,
        deliveryMethod: pedidoActualizado.deliveryMethod,
      }).catch((err) =>
        console.error(`⚠️ [PedidoService] Fallo enviando correo de cambio de estado a #${pedidoActualizado.orderNumber}:`, err)
      );
    }

    return pedidoActualizado;
  }

  async expirarOrdenesPendientesPowerpay(): Promise<number> {
    const TOLERANCIA_MINUTOS = 10;
    const VIGENCIA_POWERPAY_MINUTOS = 30;
    const LIMITE_EXPIRACION_MS = (VIGENCIA_POWERPAY_MINUTOS + TOLERANCIA_MINUTOS) * 60 * 1000;
    const fechaCorte = new Date(Date.now() - LIMITE_EXPIRACION_MS);

    const pedidosAExpirar = await Pedido.find({
      'payment.provider': 'powerpay',
      status: EstadoPedido.AWAITING_PAYMENT,
      'payment.status': EstadoPago.PENDING,
      createdAt: { $lte: fechaCorte },
    });

    if (pedidosAExpirar.length === 0) return 0;

    for (const pedido of pedidosAExpirar) {
      pedido.status = EstadoPedido.CANCELED;
      pedido.payment.status = EstadoPago.REJECTED;
      pedido.statusHistory.push({ status: EstadoPedido.CANCELED, changedAt: new Date() });
      await pedido.save();
    }

    return pedidosAExpirar.length;
  }

  async expirarOrdenesPendientesGlobal(): Promise<number> {
    const LIMITE_EXPIRACION_MS = 24 * 60 * 60 * 1000;
    const fechaCorte = new Date(Date.now() - LIMITE_EXPIRACION_MS);

    const pedidosAExpirar = await Pedido.find({
      status: EstadoPedido.AWAITING_PAYMENT,
      'payment.status': EstadoPago.PENDING,
      createdAt: { $lte: fechaCorte },
    });

    if (pedidosAExpirar.length === 0) return 0;

    for (const pedido of pedidosAExpirar) {
      const pagoHabiaSidoAprobado = pedido.payment.status === EstadoPago.APPROVED;
      pedido.status = EstadoPedido.CANCELED;
      pedido.payment.status = EstadoPago.REJECTED;
      pedido.statusHistory.push({ status: EstadoPedido.CANCELED, changedAt: new Date() });
      await pedido.save();

      if (pagoHabiaSidoAprobado) {
        await InventoryService.reponerStockItems(pedido.items);
      }
    }

    return pedidosAExpirar.length;
  }

  async purgarOrdenesCanceladasAntiguas(): Promise<number> {
    const DIAS_RETENCION = 30;
    const fechaLimite = new Date(Date.now() - DIAS_RETENCION * 24 * 60 * 60 * 1000);

    const resultado = await Pedido.deleteMany({
      status: EstadoPedido.CANCELED,
      updatedAt: { $lte: fechaLimite },
    });

    return resultado.deletedCount;
  }
}