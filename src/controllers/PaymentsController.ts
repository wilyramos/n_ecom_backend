// backend/src/controllers/PaymentsController.ts
import { Request, Response } from 'express';
import { preference, payment } from '../utils/mercadopago';
import Order, { PaymentStatus, OrderStatus, IOrder } from '../models/Order';
import Product from '../models/Product';
import mongoose from 'mongoose';
import { OrderEmail } from '../emails/OrderEmailResend';

// ─── Tipos Internos para Webhooks Culqi v4 ──────────────────────────────────

interface CulqiOrderWebhookData {
    object: 'order';
    id: string;
    amount: number;
    payment_code?: string;
    currency_code: string;
    description?: string;
    order_number: string;
    state: 'pending' | 'paid' | 'expired' | 'deleted';
    paid_at?: number;
    expiration_date?: number;
    metadata?: Record<string, any>;
}

interface CulqiChargeWebhookData {
    object: 'charge';
    id: string; // chr_test_xxx
    amount: number;
    currency_code: string;
    order_id?: string; // ID unificado de la orden de Culqi (ord_test_...) asociado a este cargo
    outcome: {
        type: string;
        merchant_message: string;
        user_message: string;
    };
    source?: {
        id: string;
        object: string;
    };
    metadata?: {
        order_id?: string; // Tu ID interno de MongoDB por si viaja en metadata
        order_number?: string;
    };
}

interface CulqiWebhookEvent {
    object: 'event';
    id: string;
    type: 'order.status.changed' | 'charge.creation.successful' | 'charge.creation.succeeded';
    creation_date: number;
    data: any;
}

// ─── Helper de Reducción de Stock Transaccional ──────────────────────────────
async function descontarStock(order: IOrder, session: mongoose.ClientSession) {
    for (const item of order.items) {
        const product = await Product.findById(item.productId).session(session);
        if (!product) return { ok: false, message: `Producto no encontrado: ${item.productId}` };

        if (item.variantId) {
            const variant = product.variants?.find(v => v._id!.toString() === item.variantId!.toString());
            if (!variant) return { ok: false, message: `Variante no encontrada` };
            if (variant.stock < item.quantity) return { ok: false, message: `Stock insuficiente` };

            variant.stock -= item.quantity;
            product.stock = product.variants!.reduce((sum, v) => sum + (v.stock || 0), 0);
        } else {
            if ((product.stock ?? 0) < item.quantity) return { ok: false, message: `Stock insuficiente` };
            product.stock! -= item.quantity;
        }
        await product.save({ session });
    }
    return { ok: true };
}

export class PaymentsController {

    // =========================================================================
    // ── CULQI NEGOCIO
    // =========================================================================

    static async processPaymentCulqi(req: Request, res: Response) {
        try {
            const { token, order, amount, currency_code = "PEN", email, orderId } = req.body;

            console.log("📦 [Backend Culqi Payment] Payload recibido:", req.body);

            if (!token && !order) {
                res.status(400).json({ message: "Debe enviar 'token' o 'order'" });
                return;
            }

            if (!amount || !orderId) {
                res.status(400).json({ message: "Faltan campos mandatorios: amount y orderId" });
                return;
            }

            const culqiApiKey = process.env.CULQI_API_KEY;
            let culqiResponse;
            let url = "";
            let payload: any = {};

            if (token) {
                // ── Flujo Síncrono: Tarjetas / Yape Directo ──
                url = "https://api.culqi.com/v2/charges";
                payload = {
                    amount,
                    currency_code: String(currency_code).toUpperCase().trim(),
                    email: String(email).toLowerCase().trim(),
                    source_id: token,
                    description: `Cargo por compra unificada - Orden: ${orderId}`,
                    metadata: { order_id: String(orderId) }
                };
            } else if (order) {
                // ── Flujo Asíncrono: PagoEfectivo / QR / Agentes (Confirmación) ──
                url = `https://api.culqi.com/v2/orders/${order}/confirm`;
            }

            culqiResponse = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${culqiApiKey}`,
                },
                body: token ? JSON.stringify(payload) : undefined,
            });

            const data = await culqiResponse.json();

            if (!culqiResponse.ok) {
                console.error("❌ Error de Culqi API:", data);
                res.status(culqiResponse.status).json({
                    status: "error",
                    message: data.user_message || "La transacción no pudo ser autorizada.",
                    error: data,
                });
                return;
            }

            console.log("✅ Operación autorizada exitosamente por Culqi:", data);
            res.status(200).json({ status: "success", message: "Pago procesado exitosamente", data });
        } catch (error) {
            console.error("💥 Error interno en processPaymentCulqi:", error);
            res.status(500).json({ message: "Error interno del servidor", error: (error as Error).message });
        }
    }

    // =========================================================================
    // ── CULQI WEBHOOK LISTENER
    // =========================================================================

    static async handleWebHookCulqi(req: Request, res: Response) {
        const session = await mongoose.startSession();
        try {
            const event = req.body as CulqiWebhookEvent;
            if (!event?.type || !event?.data) {
                res.status(400).json({ message: 'Payload de webhook inválido' });
                return;
            }

            console.log(`📥 [Webhook Culqi] Evento recibido: ${event.type}`);

            switch (event.type) {
                case 'order.status.changed':
                    return await PaymentsController._handleCulqiOrderStatusChanged(event.data as CulqiOrderWebhookData, session, res);

                // ── CORRECCIÓN CRUCIAL: Debe decir 'succeeded' igual que tu panel de Culqi
                case 'charge.creation.succeeded':
                    return await PaymentsController._handleCulqiChargeStatusChanged(event.data as CulqiChargeWebhookData, session, res);

                default:
                    console.log(`ℹ️ [Webhook Culqi] Evento ignorado (No requiere acción): ${event.type}`);
                    res.status(200).json({ message: `Evento ${event.type} recibido` });
                    return;
            }
        } catch (error) {
            if (session.inTransaction()) await session.abortTransaction();
            session.endSession();
            console.error('❌ Error crítico en Webhook de Culqi:', error);
            res.status(500).json({ message: 'Error interno del servidor' });
        }
    }

    private static async _handleCulqiOrderStatusChanged(data: CulqiOrderWebhookData, session: mongoose.ClientSession, res: Response) {
        const { id: culqiOrderId, state, order_number, payment_code, paid_at } = data;
        session.startTransaction();

        const order = await Order.findOne({
            $or: [
                { orderNumber: order_number },
                { 'payment.culqiOrderId': culqiOrderId },
                { 'payment.culqiOrderNumber': order_number }
            ]
        }).session(session);

        if (!order) {
            await session.abortTransaction();
            session.endSession();
            res.status(200).json({ message: 'Orden no encontrada, evento omitido' });
            return;
        }

        order.payment.culqiOrderId = culqiOrderId;
        order.payment.culqiOrderState = state;
        if (payment_code) order.payment.culqiPaymentCode = payment_code;
        order.payment.rawResponse = data;

        if (state === 'paid') {
            if (order.payment.status === PaymentStatus.APPROVED) {
                await session.abortTransaction();
                session.endSession();
                res.status(200).json({ message: 'Orden ya procesada anteriormente' });
                return;
            }

            const stockResult = await descontarStock(order, session);
            if (!stockResult.ok) {
                order.payment.status = PaymentStatus.APPROVED;
                order.status = OrderStatus.PAID_BUT_OUT_OF_STOCK;
                if (paid_at) order.payment.culqiPaidAt = paid_at;
                order.statusHistory.push({ status: order.status, changedAt: new Date() });
                await order.save({ session });
                await session.commitTransaction();
                session.endSession();
                res.status(200).json({ message: 'Pago capturado, pero sin stock disponible' });
                return;
            }

            order.payment.status = PaymentStatus.APPROVED;
            order.status = OrderStatus.PROCESSING;
            if (paid_at) order.payment.culqiPaidAt = paid_at;
            order.statusHistory.push({ status: order.status, changedAt: new Date() });

            await order.save({ session });
            await session.commitTransaction();
            session.endSession();

            if (order.customerProfile?.email) {
                OrderEmail.sendOrderConfirmationEmail({
                    email: order.customerProfile.email,
                    name: order.customerProfile.nombre,
                    orderId: order._id.toString(),
                    totalPrice: order.totalPrice,
                    shippingMethod: order.shippingAddress.direccion,
                    items: order.items,
                }).catch(err => console.error('⚠️ Error enviando email Culqi:', err));
            }

            res.status(200).json({ message: 'Orden completada exitosamente' });
            return;
        }

        if (state === 'expired' || state === 'deleted') {
            if (order.status === OrderStatus.AWAITING_PAYMENT) {
                order.status = OrderStatus.CANCELED;
                order.payment.status = PaymentStatus.REJECTED;
                order.statusHistory.push({ status: order.status, changedAt: new Date() });
            }
        }

        await order.save({ session });
        await session.commitTransaction();
        session.endSession();
        res.status(200).json({ message: `Estado ${state} registrado con éxito.` });
    }

    // backend/src/controllers/PaymentsController.ts

    private static async _handleCulqiChargeStatusChanged(
        eventPayload: any,
        session: mongoose.ClientSession,
        res: Response
    ) {
        let chargeData = eventPayload;

        // 🚨 DETECTAR Y REPARAR ENCAPSULAMIENTO DE CULQI V2/V4
        // Si Culqi envía el objeto envuelto en la propiedad raíz "data", nos metemos ahí.
        if (eventPayload && eventPayload.data) {
            chargeData = eventPayload.data;
        }

        // Si Culqi envía el objeto "data" serializado como un string de texto plano (común en entornos de prueba)
        if (typeof chargeData === 'string') {
            try {
                chargeData = JSON.parse(chargeData);
            } catch (e) {
                console.error("❌ [Webhook Cargo] Error al deserializar el string de data enviado por Culqi:", e);
            }
        }

        // 1. Extracción limpia y segura desde el objeto de cargo real normalizado
        const chargeId = chargeData?.id;
        const culqiOrderId = chargeData?.order_id || null;
        const mongoOrderId = chargeData?.metadata?.order_id || null;
        const outcomeType = chargeData?.outcome?.type || '';

        console.log(`🔍 [Webhook Cargo] Estructura normalizada con éxito para Cargo:`, {
            chargeId,
            culqiOrderId,
            mongoOrderId,
            outcomeType
        });

        // 2. Filtro de Seguridad Estructural
        if (!chargeId) {
            session.endSession();
            console.warn("⚠️ [Webhook Cargo] Petición rechazada: El payload normalizado no contiene un ID de cargo viable.");
            res.status(200).json({ message: "Payload inválido o vacío" });
            return;
        }

        if (!mongoOrderId && !culqiOrderId) {
            session.endSession();
            console.warn(`⚠️ [Webhook Cargo] Cargo ${chargeId} omitido: No se encontraron parámetros de vinculación a pedidos MongoDB.`);
            res.status(200).json({ message: "Sin referencias de vinculación comercial" });
            return;
        }

        session.startTransaction();

        // 3. Localizar el pedido en MongoDB por ID interno o ID de Orden de Culqi
        const order = await Order.findOne({
            $or: [
                { _id: mongoose.isValidObjectId(mongoOrderId) ? mongoOrderId : new mongoose.Types.ObjectId() },
                { 'payment.culqiOrderId': culqiOrderId }
            ]
        }).session(session);

        if (!order) {
            await session.abortTransaction();
            session.endSession();
            console.warn(`⚠️ [Webhook Cargo] No se encontró ninguna orden en la base de datos para los IDs provistos.`);
            res.status(200).json({ message: 'Orden no localizada en el sistema' });
            return;
        }

        // Idempotencia: Si ya fue aprobada previamente por concurrencia
        if (order.payment.status === PaymentStatus.APPROVED) {
            await session.abortTransaction();
            session.endSession();
            console.log(`ℹ️ [Webhook Cargo] Orden ${order._id} ya fue procesada anteriormente como APPROVED.`);
            res.status(200).json({ message: 'Orden ya procesada anteriormente' });
            return;
        }

        // Actualizar campos de auditoría financiera
        order.payment.transactionId = chargeId;
        if (culqiOrderId) order.payment.culqiOrderId = culqiOrderId;
        order.payment.rawResponse = chargeData;

        // 4. Evaluar el veredicto del Banco Emisor
        if (outcomeType === 'venta_exitosa') {
            console.log(`✅ [Webhook Cargo] Procesando venta exitosa para la Orden: ${order._id}`);

            const stockResult = await descontarStock(order, session);
            if (!stockResult.ok) {
                order.payment.status = PaymentStatus.APPROVED;
                order.status = OrderStatus.PAID_BUT_OUT_OF_STOCK;
                order.statusHistory.push({ status: order.status, changedAt: new Date() });
                await order.save({ session });
                await session.commitTransaction();
                session.endSession();
                res.status(200).json({ message: 'Pago capturado con éxito, pero sin stock físico disponible.' });
                return;
            }

            order.payment.status = PaymentStatus.APPROVED;
            order.status = OrderStatus.PROCESSING;
            order.statusHistory.push({ status: order.status, changedAt: new Date() });

            await order.save({ session });
            await session.commitTransaction();
            session.endSession();

            // Enviar confirmación por correo electrónico de manera asíncrona diferida
            if (order.customerProfile?.email) {
                OrderEmail.sendOrderConfirmationEmail({
                    email: order.customerProfile.email,
                    name: order.customerProfile.nombre,
                    orderId: order._id.toString(),
                    totalPrice: order.totalPrice,
                    shippingMethod: order.shippingAddress.direccion,
                    items: order.items,
                }).catch(err => console.error('⚠️ [Webhook Cargo] Error diferido enviando email:', err));
            }

            console.log(`🚀 [Webhook Cargo] Proceso completado con éxito. Orden ${order._id} movida a PROCESSING.`);
            res.status(200).json({ message: 'Cargo de tarjeta procesado e inventario actualizado con éxito.' });
            return;
        } else {
            // En caso de fondos insuficientes, tarjeta rechazada, etc.
            order.payment.status = PaymentStatus.REJECTED;
            order.status = OrderStatus.CANCELED;
            order.statusHistory.push({ status: order.status, changedAt: new Date() });

            await order.save({ session });
            await session.commitTransaction();
            session.endSession();
            console.log(`❌ [Webhook Cargo] Transacción denegada por el banco registrada para la orden: ${order._id}`);
            res.status(200).json({ message: 'Cargo denegado registrado de forma correcta.' });
            return;
        }
    }
    // =========================================================================
    // ── MERCADO PAGO NEGOCIO
    // =========================================================================

    static async createPreference(req: Request, res: Response) {
        try {
            const { items, payer, orderId } = req.body;
            if (!items || !Array.isArray(items) || !orderId) {
                res.status(400).json({ message: 'Items and orderId are required' });
                return;
            }

            const preferencePayload = {
                items,
                payer,
                back_urls: {
                    success: `${process.env.MP_SUCCESS_URL}?orderId=${orderId}`,
                    failure: `${process.env.MP_FAILURE_URL}?orderId=${orderId}`,
                    pending: `${process.env.MP_PENDING_URL}?orderId=${orderId}`,
                },
                auto_return: 'approved',
                metadata: { order_id: orderId },
                external_reference: orderId,
                notification_url: process.env.MP_NOTIFICATION_URL,
            };

            const response = await preference.create({ body: preferencePayload });
            res.status(200).json({ init_point: response.init_point });
        } catch (error) {
            res.status(500).json({ message: 'Internal Server Error' });
        }
    }

    static async createPreferenceWithOrderId(req: Request, res: Response) {
        try {
            const { orderId } = req.body;
            if (!orderId) {
                res.status(400).json({ message: 'orderId is required' });
                return;
            }

            const order = await Order.findById(orderId);
            if (!order) {
                res.status(404).json({ message: 'Order not found' });
                return;
            }

            const profile = order.customerProfile;
            const items = order.items.map((item) => ({
                id: String(item.productId),
                title: item.nombre,
                quantity: item.quantity,
                unit_price: item.price
            }));

            const payer = {
                email: profile.email,
                first_name: profile.nombre,
                last_name: profile.apellidos,
                phone: { number: profile.telefono },
                identification: { type: profile.tipoDocumento, number: profile.numeroDocumento }
            };

            const preferencePayload = {
                items,
                payer,
                back_urls: {
                    success: `${process.env.MP_SUCCESS_URL}?orderId=${orderId}`,
                    failure: `${process.env.MP_FAILURE_URL}?orderId=${orderId}`,
                    pending: `${process.env.MP_PENDING_URL}?orderId=${orderId}`,
                },
                auto_return: 'approved',
                metadata: { order_id: orderId },
                external_reference: orderId,
                notification_url: process.env.MP_NOTIFICATION_URL
            };

            const response = await preference.create({ body: preferencePayload });
            res.status(200).json({ init_point: response.init_point });
        } catch (error) {
            res.status(500).json({ message: 'Internal Server Error' });
        }
    }

    static async processPayment(req: Request, res: Response) {
        try {
            const { token, payment_method_id } = req.body;
            if (!token || !payment_method_id) {
                res.status(400).json({ message: 'Token and paymentMethodId are required' });
                return;
            }
            const response = await payment.create({ body: req.body });
            res.status(200).json(response);
        } catch (error) {
            res.status(500).json({ message: 'Internal Server Error' });
        }
    }

    static async processPaymentYape(req: Request, res: Response) {
        try {
            const { token, transaction_amount, orderId, description } = req.body;
            if (!token || !transaction_amount || !orderId) {
                res.status(400).json({ message: 'Faltan datos requeridos (token, transaction_amount, orderId)' });
                return;
            }

            const order = await Order.findById(orderId);
            if (!order || !order.customerProfile) {
                res.status(444).json({ message: 'Orden o perfil no encontrado' });
                return;
            }

            const profile = order.customerProfile;
            const paymentData = {
                transaction_amount: Number(transaction_amount),
                token,
                description: description || `Pago de orden ${order.orderNumber}`,
                installments: 1,
                payment_method_id: 'yape',
                binary_mode: true,
                statement_descriptor: "neoshopimportaciones.com",
                items: order.items.map(item => ({
                    id: item.productId.toString(),
                    title: item.nombre,
                    quantity: item.quantity,
                    unit_price: item.price
                })),
                payer: {
                    email: profile.email,
                    first_name: profile.nombre,
                    last_name: profile.apellidos,
                    identification: { type: profile.tipoDocumento || "DNI", number: profile.numeroDocumento || "00000000" },
                    phone: { number: profile.telefono || "" },
                    address: { zip_code: "", street_name: order.shippingAddress.direccion, street_number: order.shippingAddress.numero || "" }
                },
                external_reference: orderId,
                notification_url: process.env.MP_NOTIFICATION_URL,
                metadata: { order_id: orderId }
            };

            const response = await payment.create({ body: paymentData });
            res.status(200).json({ status: response.status, status_detail: response.status_detail, id: response.id });
        } catch (error: any) {
            res.status(500).json({ message: 'Error al procesar el pago con Yape', error: error.message });
        }
    }

    // =========================================================================
    // ── IZIPAY NEGOCIO
    // =========================================================================

    static async createPaymentIzipay(req: Request, res: Response) {
        try {
            const { amount, currency = "PEN", orderId, customer } = req.body;
            if (!amount || !orderId) {
                res.status(400).json({ message: "amount y orderId son obligatorios" });
                return;
            }

            const basicAuth = Buffer.from(`${process.env.IZIPAY_USER}:${process.env.IZIPAY_PASSWORD}`).toString("base64");
            const payload = {
                amount: amount * 100,
                currency,
                orderId,
                customer: { email: customer?.email || "cliente@example.com", reference: customer?.reference || orderId },
                notificationUrl: process.env.IZIPAY_NOTIFICATION_URL || "",
                language: "es-ES"
            };

            const response = await fetch("https://api.micuentaweb.pe/api-payment/V4/Charge/CreatePayment", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Basic ${basicAuth}` },
                body: JSON.stringify(payload)
            });

            const data = await response.json();
            if (!response.ok) {
                res.status(response.status).json({ message: "Error en la creación del pago", error: data });
                return;
            }

            res.json({ message: "Pago creado exitosamente", paymentData: data });
        } catch (error) {
            res.status(500).json({ message: "Error interno del servidor", error: (error as Error).message });
        }
    }
}