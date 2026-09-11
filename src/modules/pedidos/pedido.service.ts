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
import crypto from 'crypto';
import { PaymentGatewayFactory } from './gateways/payment-gateway.factory';
import { OrderEmail } from '../../emails/OrderEmailResend';
import { InventoryService } from '../inventory/inventory.service';

const MP_SURCHARGE_RATE = 0.12;

interface StatsAggregationResult {
  ventasAprobadas: Array<{ montoTotal: number; conteoAprobados: number }>;
  estadosOperativos: Array<{ _id: string; count: number }>;
}

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
      createdAt: { $gte: inicioDia, $lt: finDia },
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
          ? 'Recojo en Tienda'
          : `${pedido.shippingAddress.direccion} (${pedido.shippingAddress.distrito}, ${pedido.shippingAddress.provincia})`;

      const customerName = `${pedido.customerProfile.nombre} ${pedido.customerProfile.apellidos || ''}`.trim();

      await Promise.allSettled([
        OrderEmail.sendOrderConfirmationEmail({
          email: pedido.customerProfile.email,
          name: customerName,
          orderId: pedido.orderNumber,
          totalPrice: pedido.totalPrice,
          shippingMethod: fullAddress,
          items: pedido.items as any,
        }),
        OrderEmail.notifyAdminsOnNewOrder(pedido),
      ]);
    } catch (error) {
      console.error(`⚠️ [PedidoService] Fallo enviando correos de orden #${pedido.orderNumber}:`, error);
    }
  }

  /**
   * Transición atómica a APROBADO: registra pago, descuenta stock e inicia envíos de correos
   */
  async confirmarPagoAprobado(pedido: IPedido, transactionId: string, gatewayData?: Record<string, unknown>): Promise<void> {
    if (pedido.payment.status === EstadoPago.APPROVED) return;

    pedido.payment.status = EstadoPago.APPROVED;
    pedido.payment.transactionId = transactionId;
    pedido.payment.paidAt = new Date();

    if (gatewayData) {
      pedido.payment.gatewayData = gatewayData;
    }

    pedido.status = EstadoPedido.PROCESSING;
    pedido.statusHistory.push({ status: EstadoPedido.PROCESSING, changedAt: new Date() });

    await pedido.save();

    // Descuenta stock únicamente cuando el cobro fue confirmado
    await InventoryService.descontarStockItems(pedido.items);

    // Dispara correos de confirmación en background
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
    return { pedido: nuevoPedido, initPoint, culqiOrderId };
  }

  async procesarCargoCulqi(orderNumber: string, culqiTokenOrOrder: string) {
    const pedido = await Pedido.findOne({ orderNumber: orderNumber.trim() });

    if (!pedido) throw Object.assign(new Error('No se encontró el pedido a procesar.'), { statusCode: 404 });
    if (pedido.payment.status === EstadoPago.APPROVED) return { pedido, status: 'approved' };
    if (!process.env.CULQI_API_KEY) throw Object.assign(new Error('Configuración incompleta: CULQI_API_KEY ausente.'), { statusCode: 500 });

    // =======================================================================
    // 1. CONSULTA DIRECTA A LA API DE CULQI PARA CARGOS AUTOMÁTICOS (chr_...)
    // =======================================================================
    if (culqiTokenOrOrder.startsWith('chr_')) {
      const fetchChargeRes = await fetch(`https://api.culqi.com/v2/charges/${culqiTokenOrOrder}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.CULQI_API_KEY}`,
        },
      });

      if (!fetchChargeRes.ok) {
        throw Object.assign(new Error('Error al verificar la transacción con los servidores de Culqi.'), { statusCode: 502 });
      }

      const chargeData = await fetchChargeRes.json() as Record<string, any>;

      // 🔴 VALIDACIÓN ZERO-TRUST: Verificamos en la respuesta oficial de Culqi
      if (chargeData.outcome?.type === 'venta_exitosa' && chargeData.action_code === '000') {
        await this.confirmarPagoAprobado(pedido, chargeData.id, chargeData);
        return { pedido, status: 'approved' };
      } else {
        // Bloqueo y cancelación del pedido por falla o fraude
        pedido.status = EstadoPedido.CANCELED;
        pedido.payment.status = EstadoPago.REJECTED;
        pedido.payment.gatewayData = { ...(pedido.payment.gatewayData || {}), lastError: chargeData };
        await pedido.save();

        throw Object.assign(new Error(chargeData.user_message || 'Transacción denegada por el banco emisor.'), { statusCode: 400 });
      }
    }

    // =======================================================================
    // 2. CONSULTA DIRECTA A LA API DE CULQI PARA ÓRDENES DIFERIDAS (ord_...)
    // =======================================================================
    if (culqiTokenOrOrder.startsWith('ord_')) {
      const fetchOrderRes = await fetch(`https://api.culqi.com/v2/orders/${culqiTokenOrOrder}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.CULQI_API_KEY}`,
        },
      });

      if (!fetchOrderRes.ok) {
        throw Object.assign(new Error('No se pudo verificar la orden en la pasarela.'), { statusCode: 502 });
      }

      const orderData = await fetchOrderRes.json() as Record<string, any>;
      pedido.payment.gatewayData = orderData;

      // 🔴 Verificación Oficial: Culqi confirma que está pagado (ej: Yape directo / 3DS)
      if (orderData.state === 'paid') {
        const chargeId = (orderData.charges && orderData.charges.length > 0)
          ? orderData.charges[0].id
          : orderData.id;

        await this.confirmarPagoAprobado(pedido, chargeId, orderData);
        return { pedido, status: 'approved' };
      }

      // Verificación Oficial: Culqi confirma que es un CIP válido pendiente (PagoEfectivo/Cuotéalo)
      if (orderData.state === 'pending' && orderData.payment_code) {
        pedido.payment.status = EstadoPago.PENDING;
        pedido.payment.gatewayOrderId = culqiTokenOrOrder;
        pedido.payment.paymentCode = orderData.payment_code;
        pedido.status = EstadoPedido.AWAITING_PAYMENT;
        await pedido.save();
        return { pedido, status: 'pending', paymentCode: orderData.payment_code };
      }

      // Si Culqi dice que está expirado, fallido, borrado, o es un error disfrazado
      pedido.status = EstadoPedido.CANCELED;
      pedido.payment.status = EstadoPago.REJECTED;

      let userMessage = 'La transacción fue rechazada por el banco emisor o cancelada.';
      if (orderData.charges && orderData.charges.length > 0) {
        userMessage = orderData.charges[0].user_message || userMessage;
      }

      await pedido.save();
      throw Object.assign(new Error(userMessage), { statusCode: 400 });
    }

    // =======================================================================
    // 3. GENERACIÓN DE CARGO VÍA TOKEN (tkn_live_...) -> Solo flujos manuales
    // =======================================================================
    const amountInCents = Math.round(pedido.totalPrice * 100);
    const culqiResponse = await fetch('https://api.culqi.com/v2/charges', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.CULQI_API_KEY}`,
      },
      body: JSON.stringify({
        amount: amountInCents,
        currency_code: pedido.currency || 'PEN',
        email: pedido.customerProfile.email,
        source_id: culqiTokenOrOrder,
        antifraud_details: {
          first_name: pedido.customerProfile.nombre,
          last_name: pedido.customerProfile.apellidos,
          phone_number: pedido.customerProfile.telefono,
        },
        metadata: { orderNumber: pedido.orderNumber },
      }),
    });

    const culqiData = await culqiResponse.json() as Record<string, any>;

    // 🔴 BLINDAJE 3DS: Si Culqi responde 201, exige autenticación 3DS que el frontend saltó
    if (culqiResponse.status === 201) {
      pedido.status = EstadoPedido.CANCELED;
      pedido.payment.status = EstadoPago.REJECTED;
      pedido.payment.gatewayData = { ...(pedido.payment.gatewayData || {}), lastError: culqiData };
      await pedido.save();

      throw Object.assign(new Error('Esta tarjeta requiere validación de identidad (3D Secure). Por favor, intenta de nuevo y espera a que cargue la ventana de tu banco.'), { statusCode: 400 });
    }

    // 🔴 Verificamos la respuesta directa de la creación del cargo (venta exitosa o denegación)
    if (!culqiResponse.ok || (culqiData.outcome && culqiData.outcome.type !== 'venta_exitosa')) {
      pedido.status = EstadoPedido.CANCELED;
      pedido.payment.status = EstadoPago.REJECTED;
      pedido.payment.gatewayData = { ...(pedido.payment.gatewayData || {}), lastError: culqiData };
      await pedido.save();

      const errorMessage = culqiData.user_message || 'Transacción denegada por el banco emisor. Intenta con otra tarjeta.';
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
      throw Object.assign(new Error('Pedido no encontrado o no autorizado.'), { statusCode: 404 });
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
      throw Object.assign(new Error('No se encontró el pedido con los datos proporcionados.'), { statusCode: 404 });
    }
    return pedido;
  }

  async vincularPedidosInvitado(email: string, userId: string): Promise<number> {
    const cleanEmail = email.trim().toLowerCase();
    const result = await Pedido.updateMany(
      {
        $or: [{ user: { $exists: false } }, { user: null }],
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

  /**
   * Actualiza el estado logístico del pedido, repone el stock si se cancela
   * y envía el correo correspondiente al cliente (excluye awaiting_payment).
   */
  async actualizarEstadoPedido(pedidoId: string, nuevoEstado: EstadoPedido): Promise<IPedido> {
    const pedido = await Pedido.findById(pedidoId);
    if (!pedido) throw new Error('Pedido no encontrado');

    const estadoAnterior = pedido.status;
    const pagoAprobadoPrevio = pedido.payment.status === EstadoPago.APPROVED;

    if (estadoAnterior === nuevoEstado) return pedido;

    pedido.status = nuevoEstado;
    pedido.statusHistory.push({ status: nuevoEstado, changedAt: new Date() });

    // Si se cancela una orden que ya tenía el stock descontado -> Reponer stock
    if (
      pagoAprobadoPrevio &&
      nuevoEstado === EstadoPedido.CANCELED &&
      estadoAnterior !== EstadoPedido.CANCELED
    ) {
      await InventoryService.reponerStockItems(pedido.items);
      console.log(`📦 [Inventario] Stock reabastecido para la orden cancelada #${pedido.orderNumber}`);
    }

    const pedidoActualizado = await pedido.save();

    // Disparar correo de actualización si no es awaiting_payment
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

  /**
   * Tarea Cron: Expira y cancela órdenes en estado pendiente que superaron el tiempo de expiración
   * Cumple con el lineamiento técnico de Powerpay (30 min de vigencia + 10 min de tolerancia).
   */
  async expirarOrdenesPendientesPowerpay(): Promise<number> {
    const TOLERANCIA_MINUTOS = 10;
    const VIGENCIA_POWERPAY_MINUTOS = 30;
    const LIMITE_EXPIRACION_MS = (VIGENCIA_POWERPAY_MINUTOS + TOLERANCIA_MINUTOS) * 60 * 1000;
    const fechaCorte = new Date(Date.now() - LIMITE_EXPIRACION_MS);

    // Busca pedidos de Powerpay que sigan en 'awaiting_payment' o pago 'pending'
    const pedidosAExpirar = await Pedido.find({
      'payment.provider': 'powerpay',
      status: EstadoPedido.AWAITING_PAYMENT,
      'payment.status': EstadoPago.PENDING,
      createdAt: { $lte: fechaCorte },
    });

    if (pedidosAExpirar.length === 0) {
      return 0;
    }

    console.log(`⏱️ [Powerpay Cron] Expirando ${pedidosAExpirar.length} orden(es) abandonada(s)...`);

    for (const pedido of pedidosAExpirar) {
      pedido.status = EstadoPedido.CANCELED;
      pedido.payment.status = EstadoPago.REJECTED;
      pedido.statusHistory.push({
        status: EstadoPedido.CANCELED,
        changedAt: new Date(),
      });

      await pedido.save();
      console.log(`❌ [Powerpay Cron] Pedido #${pedido.orderNumber} marcado como CANCELED (Expirado).`);
    }

    return pedidosAExpirar.length;
  }
}