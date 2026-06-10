import { Request, Response } from 'express';
import Order, { PaymentStatus, OrderStatus, IOrder } from '../models/Order';
import Product from '../models/Product';
import mongoose from 'mongoose';
import { OrderEmail } from '../emails/OrderEmailResend';
import crypto from 'crypto';

interface MPWebhookBody {
    action: string;
    api_version: string;
    data: { id: string };
    date_created: string;
    id: string;
    live_mode: boolean;
    type: 'payment' | 'merchant_order';
    user_id: number;
}

interface MPPaymentResponse {
    id: number;
    status: 'approved' | 'pending' | 'in_process' | 'rejected' | 'cancelled' | 'refunded';
    status_detail: string;
    external_reference: string; 
    order?: { id: number; type: string };
    preference_id: string; 
    transaction_amount: number;
    currency_id: string;
    payment_method_id: string;
    payment_type_id: string;
    metadata?: { order_id?: string; order_number?: string };
    date_approved?: string;
}

interface MPPreferenceResponse {
    id: string;
    init_point: string;
    sandbox_init_point: string;
}

async function descontarStock(order: IOrder, session: mongoose.ClientSession): Promise<{ ok: boolean; message?: string }> {
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

function validateMPSignature(req: Request): boolean {
    const secret = process.env.MP_WEBHOOK_SECRET;
    if (!secret) {
        console.warn('⚠️ [MP Webhook] MP_WEBHOOK_SECRET no configurado — omitiendo validación');
        return true; 
    }

    const xSignature = req.headers['x-signature'] as string;
    const xRequestId = req.headers['x-request-id'] as string;

    if (!xSignature) return false;

    const parts = xSignature.split(',');
    let ts = '';
    let v1 = '';
    for (const part of parts) {
        const [key, value] = part.trim().split('=');
        if (key === 'ts') ts = value;
        if (key === 'v1') v1 = value;
    }

    if (!ts || !v1) return false;

    const dataId = req.query['data.id'] as string;
    const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;

    const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(manifest)
        .digest('hex');

    return crypto.timingSafeEqual(
        Buffer.from(v1, 'hex'),
        Buffer.from(expectedSignature, 'hex')
    );
}

export class MercadoPagoController {

    static async createPreference(req: Request, res: Response) {
        try {
            const { orderId } = req.body;

            if (!orderId) {
                res.status(400).json({ message: 'orderId es obligatorio' });
                return;
            }

            const order = await Order.findById(orderId);
            if (!order) {
                res.status(404).json({ message: 'Orden no encontrada' });
                return;
            }

            if (order.payment.status === PaymentStatus.APPROVED) {
                res.status(400).json({ message: 'Esta orden ya fue pagada' });
                return;
            }

            const accessToken = process.env.MP_ACCESS_TOKEN;
            if (!accessToken) {
                res.status(500).json({ message: 'Configuración de MercadoPago incompleta' });
                return;
            }

            const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
            const backendUrl = process.env.BACKEND_URL || 'http://localhost:4000';

            const cleanFrontendUrl = frontendUrl.replace(/\/$/, '');
            const cleanBackendUrl = backendUrl.replace(/\/$/, '');
            // Validar si es local para apagar dinámicamente auto_return y evitar errores 400 de MP
            const isLocalhost = cleanFrontendUrl.includes('localhost') || cleanFrontendUrl.includes('127.0.0.1');

            const items = order.items.map(item => ({
                id: item.productId.toString(),
                title: item.nombre,
                quantity: item.quantity,
                unit_price: item.price,
                currency_id: order.currency || 'PEN',
                picture_url: item.imagen || undefined,
            }));

            if (order.shippingCost > 0) {
                items.push({
                    id: 'shipping',
                    title: 'Costo de envío',
                    quantity: 1,
                    unit_price: order.shippingCost,
                    currency_id: order.currency || 'PEN',
                    picture_url: undefined,
                });
            }

            const preferenceBody = {
                external_reference: order.orderNumber, 
                items,
                payer: {
                    name: order.customerProfile.nombre,
                    surname: order.customerProfile.apellidos,
                    email: order.customerProfile.email,
                    phone: { area_code: '', number: order.customerProfile.telefono },
                    identification: {
                        type: order.customerProfile.tipoDocumento,
                        number: order.customerProfile.numeroDocumento,
                    },
                },
                back_urls: {
                    success: `${cleanFrontendUrl}/checkout-result/resultado?status=success&orderId=${order._id.toString()}`,
                    failure: `${cleanFrontendUrl}/checkout-result/resultado?status=failure&orderId=${order._id.toString()}`,
                    pending: `${cleanFrontendUrl}/checkout-result/resultado?status=pending&orderId=${order._id.toString()}`,
                },
                auto_return: isLocalhost ? undefined : 'approved',   
                notification_url: `${cleanBackendUrl}/api/checkout/webhook-mp`,
                metadata: {
                    order_id: order._id.toString(),
                    order_number: order.orderNumber,
                },
                expiration_date_from: new Date().toISOString(),
                expiration_date_to: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
                expires: true,
            };

            const mpResponse = await fetch('https://api.mercadopago.com/checkout/preferences', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${accessToken}`,
                },
                body: JSON.stringify(preferenceBody),
            });

            const mpData = (await mpResponse.json()) as MPPreferenceResponse & { message?: string };

            if (!mpResponse.ok || !mpData.id) {
                console.error('❌ [MP] Error al crear preferencia:', mpData);
                res.status(mpResponse.status).json({ message: 'Error al crear preferencia en MercadoPago', detail: mpData });
                return;
            }

            order.payment.provider = 'mercadopago';
            order.payment.mpPreferenceId = mpData.id;
            await order.save();

            const isProduction = process.env.NODE_ENV === 'production';

            res.status(200).json({
                preferenceId: mpData.id,
                initPoint: isProduction ? mpData.init_point : mpData.sandbox_init_point,
            });

        } catch (error) {
            console.error('❌ Error en createPreference MP:', error);
            res.status(500).json({ message: 'Error interno del servidor' });
        }
    }

    static async handleWebhook(req: Request, res: Response) {
        // Responder 200 de inmediato para mitigar reintentos por latencia
        res.status(200).json({ received: true });

        const session = await mongoose.startSession();

        try {
            const body = req.body as MPWebhookBody;

            if (body.type !== 'payment' || !body.data?.id) {
                return;
            }

            if (process.env.NODE_ENV === 'production' && !validateMPSignature(req)) {
                console.warn('⚠️ [MP Webhook] Firma inválida — ignorando notificación');
                return;
            }

            const paymentId = body.data.id;

            const mpPaymentRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
                headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` },
            });

            if (!mpPaymentRes.ok) {
                console.error(`❌ [MP Webhook] No se pudo obtener la info del pago ${paymentId}`);
                return;
            }

            const payment = (await mpPaymentRes.json()) as MPPaymentResponse;
            const { status, external_reference, status_detail, preference_id, order: mpOrder, metadata } = payment;

            session.startTransaction();

            // Estrategia de búsqueda resiliente de 3 capas (External Reference -> Preference ID -> Metadata fallback)
            const order = await Order.findOne({
                $or: [
                    { orderNumber: external_reference },
                    { 'payment.mpPreferenceId': preference_id },
                    { _id: metadata?.order_id && mongoose.isValidObjectId(metadata.order_id) ? metadata.order_id : new mongoose.Types.ObjectId() }
                ],
            }).session(session);

            if (!order) {
                await session.abortTransaction();
                session.endSession();
                console.warn(`⚠️ [MP Webhook] Orden no encontrada para ref: ${external_reference} o pref: ${preference_id}`);
                return;
            }

            order.payment.transactionId = paymentId.toString();
            order.payment.mpMerchantOrderId = mpOrder?.id?.toString();
            order.payment.mpPaymentStatusDetail = status_detail;
            order.payment.method = payment.payment_method_id;
            order.payment.rawResponse = payment;

            if (status === 'approved') {
                if (order.payment.status === PaymentStatus.APPROVED) {
                    await session.abortTransaction();
                    session.endSession();
                    return;
                }

                const stockResult = await descontarStock(order, session);

                if (!stockResult.ok) {
                    order.payment.status = PaymentStatus.APPROVED;
                    order.status = OrderStatus.PAID_BUT_OUT_OF_STOCK;
                    order.statusHistory.push({ status: order.status, changedAt: new Date() });
                    await order.save({ session });
                    await session.commitTransaction();
                    session.endSession();
                    console.warn(`⚠️ [MP Webhook] Pago OK pero sin stock disponible: ${order.orderNumber}`);
                    return;
                }

                order.payment.status = PaymentStatus.APPROVED;
                order.status = OrderStatus.PROCESSING;
                order.statusHistory.push({ status: order.status, changedAt: new Date() });

                await order.save({ session });
                await session.commitTransaction();
                session.endSession();

                if (order.customerProfile?.email) {
                    OrderEmail.sendOrderConfirmationEmail({
                        email: order.customerProfile.email,
                        name: order.customerProfile.nombre,
                        orderId: order.orderNumber,
                        totalPrice: order.totalPrice,
                        shippingMethod: order.shippingAddress.direccion,
                        items: order.items,
                    }).catch(err => console.error('⚠️ [MP Webhook] Error enviando email:', err));
                }

                console.log(`✅ [MP Webhook] Orden ${order.orderNumber} aprobada con éxito`);

            } else if (status === 'rejected' || status === 'cancelled') {
                if (order.status === OrderStatus.AWAITING_PAYMENT) {
                    order.status = OrderStatus.CANCELED;
                    order.payment.status = PaymentStatus.REJECTED;
                    order.statusHistory.push({ status: order.status, changedAt: new Date() });
                }
                await order.save({ session });
                await session.commitTransaction();
                session.endSession();
                console.log(`❌ [MP Webhook] Pago rechazado para orden ${order.orderNumber}. Detalle: ${status_detail}`);

            } else {
                order.payment.status = PaymentStatus.PENDING;
                await order.save({ session });
                await session.commitTransaction();
                session.endSession();
            }

        } catch (error) {
            if (session.inTransaction()) await session.abortTransaction();
            session.endSession();
            console.error('❌ [MP Webhook] Error crítico:', error);
        }
    }
}