// File: backend/src/controllers/PaymentsController.ts
import { Request, Response } from 'express';
import Order, { PaymentStatus, OrderStatus, IOrder } from '../models/Order';
import Product from '../models/Product';
import mongoose from 'mongoose';
import { OrderEmail } from '../emails/OrderEmailResend';

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
    id: string;
    amount: number;
    currency_code: string;
    order_id?: string;
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
        order_id?: string;
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
    // ── CULQI PROCESAMIENTO
    // =========================================================================

    static async processPaymentCulqi(req: Request, res: Response) {
        try {
            const { token, order: culqiOrderId, amount, currency_code = "PEN", email, orderId } = req.body;

            const dbOrder = await Order.findById(orderId);
            if (!dbOrder) {
                res.status(404).json({ message: "Orden interna no encontrada" });
                return;
            }

            if (culqiOrderId && !token) {
                dbOrder.payment.culqiOrderId = culqiOrderId;
                dbOrder.payment.status = PaymentStatus.PENDING;
                await dbOrder.save();

                res.status(200).json({
                    status: "pending",
                    message: "Orden asíncrona registrada de forma interactiva.",
                });
                return;
            }

            if (token) {
                const CULQI_FEE = 0.037;
                const expectedAmount = Math.round((dbOrder.totalPrice * (1 + CULQI_FEE)) * 100);

                if (Math.abs(amount - expectedAmount) > 1) { 
                    res.status(400).json({ message: "El monto enviado no coincide con el total + comisión." });
                    return;
                }

                const chargePayload = {
                    amount: amount, 
                    currency_code: String(currency_code).toUpperCase().trim(),
                    email: String(email).toLowerCase().trim(),
                    source_id: token,
                    description: `Cargo por compra - Pedido: ${dbOrder.orderNumber}`,
                    metadata: { order_id: String(dbOrder._id) },
                };

                const culqiResponse = await fetch("https://api.culqi.com/v2/charges", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${process.env.CULQI_API_KEY}`,
                    },
                    body: JSON.stringify(chargePayload),
                });

                const data = await culqiResponse.json();

                if (!culqiResponse.ok) {
                    res.status(culqiResponse.status).json({ status: "error", error: data });
                    return;
                }

                // Si es un flujo síncrono directo por API, impactamos la comisión de inmediato
                dbOrder.totalPrice = Number((amount / 100).toFixed(2));
                dbOrder.payment.status = PaymentStatus.APPROVED;
                dbOrder.status = OrderStatus.PROCESSING;
                await dbOrder.save();

                res.status(200).json({ status: "success", message: "Pago procesado exitosamente", data });
                return;
            }

        } catch (error) {
            res.status(500).json({ message: "Error interno", error: (error as Error).message });
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
        const { id: culqiOrderId, state, order_number, payment_code, paid_at, amount } = data;
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

            // Sincronización del total pagado real con la comisión incluida desde el webhook (amount viene en céntimos)
            if (amount) {
                order.totalPrice = Number((amount / 100).toFixed(2));
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
                    orderId: order.orderNumber,
                    totalPrice: order.totalPrice, // Envía el total actualizado con comisión
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

    private static async _handleCulqiChargeStatusChanged(data: CulqiChargeWebhookData, session: mongoose.ClientSession, res: Response) {
        const { id: chargeId, order_id: culqiOrderId, metadata: chargeMetadata, outcome, amount } = data;
        const mongoOrderId = chargeMetadata?.order_id || null;
        const outcomeType = outcome?.type || '';

        if (!chargeId) {
            res.status(200).json({ message: "Payload inválido o vacío" });
            return;
        }

        session.startTransaction();

        const order = await Order.findOne({
            $or: [
                { _id: mongoose.isValidObjectId(mongoOrderId) ? mongoOrderId : new mongoose.Types.ObjectId() },
                { 'payment.culqiOrderId': culqiOrderId }
            ]
        }).session(session);

        if (!order) {
            await session.abortTransaction();
            session.endSession();
            res.status(200).json({ message: 'Orden no localizada en el sistema' });
            return;
        }

        if (order.payment.status === PaymentStatus.APPROVED) {
            await session.abortTransaction();
            session.endSession();
            res.status(200).json({ message: 'Orden ya procesada anteriormente' });
            return;
        }

        order.payment.transactionId = chargeId;
        if (culqiOrderId) order.payment.culqiOrderId = culqiOrderId;
        order.payment.rawResponse = data;

        if (outcomeType === 'venta_exitosa') {
            // Sincronización del total pagado real con la comisión incluida
            if (amount) {
                order.totalPrice = Number((amount / 100).toFixed(2));
            }

            const stockResult = await descontarStock(order, session);
            if (!stockResult.ok) {
                order.payment.status = PaymentStatus.APPROVED;
                order.status = OrderStatus.PAID_BUT_OUT_OF_STOCK;
                order.payment.culqiOrderState = 'paid';
                order.statusHistory.push({ status: order.status, changedAt: new Date() });
                await order.save({ session });
                await session.commitTransaction();
                session.endSession();
                res.status(200).json({ message: 'Pago capturado con éxito, pero sin stock físico disponible.' });
                return;
            }

            order.payment.status = PaymentStatus.APPROVED;
            order.status = OrderStatus.PROCESSING;
            order.payment.culqiOrderState = 'paid';
            order.statusHistory.push({ status: order.status, changedAt: new Date() });

            await order.save({ session });
            await session.commitTransaction();
            session.endSession();

            if (order.customerProfile?.email) {
                OrderEmail.sendOrderConfirmationEmail({
                    email: order.customerProfile.email,
                    name: order.customerProfile.nombre,
                    orderId: order.orderNumber,
                    totalPrice: order.totalPrice, // Envía el total actualizado con comisión
                    shippingMethod: order.shippingAddress.direccion,
                    items: order.items,
                }).catch(err => console.error('⚠️ [Webhook Cargo] Error diferido enviando email:', err));
            }

            res.status(200).json({ message: 'Cargo de tarjeta procesado e inventario actualizado con éxito.' });
            return;
        } else {
            order.payment.status = PaymentStatus.REJECTED;
            order.statusHistory.push({
                status: order.status,
                changedAt: new Date(),
                note: `Cargo rechazado: ${outcome?.merchant_message || 'Sin detalle'}`
            } as any);

            await order.save({ session });
            await session.commitTransaction();
            session.endSession();
            res.status(200).json({ message: 'Cargo denegado registrado. Orden disponible para reintento.' });
            return;
        }
    }
}