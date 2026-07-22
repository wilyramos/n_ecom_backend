// File: backend/src/controllers/OrderController.ts

import Order, { OrderStatus, PaymentStatus } from '../models/Order';
import { Request, Response } from 'express';
import mongoose from 'mongoose';
import Product from '../models/Product';
import { startOfDay, endOfDay, parseISO } from 'date-fns';
import { OrderService } from '../services/OrderService';
import { buildOrderReceipt } from '../templates/saleReceipt.template';
import { PdfService } from '../services/pdf.service';
import { buildShippingLabel } from '../templates/shippingLabel.template';

const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
    [OrderStatus.AWAITING_PAYMENT]: [
        OrderStatus.PROCESSING,
        OrderStatus.CANCELED,
        OrderStatus.PAID_BUT_OUT_OF_STOCK
    ],
    [OrderStatus.PROCESSING]: [
        OrderStatus.SHIPPED,
        OrderStatus.CANCELED
    ],
    [OrderStatus.SHIPPED]: [
        OrderStatus.DELIVERED,
        OrderStatus.CANCELED
    ],
    [OrderStatus.DELIVERED]: [],
    [OrderStatus.CANCELED]: [],
    [OrderStatus.PAID_BUT_OUT_OF_STOCK]: [
        OrderStatus.PROCESSING,
        OrderStatus.CANCELED
    ],
};

const STATUSES_WITH_DEDUCTED_STOCK: OrderStatus[] = [
    OrderStatus.PROCESSING,
    OrderStatus.SHIPPED,
    OrderStatus.PAID_BUT_OUT_OF_STOCK,
];

export class OrderController {

    static async createOrder(req: Request, res: Response) {
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            const {
                customerProfile,
                items,
                subtotal,
                shippingCost,
                totalPrice,
                shippingAddress,
                currency = 'PEN'
            } = req.body;

            if (!customerProfile) {
                await session.abortTransaction();
                res.status(400).json({ message: 'Los datos de identificación del cliente son obligatorios' });
                return;
            }

            if (!items || !Array.isArray(items) || items.length === 0) {
                await session.abortTransaction();
                res.status(400).json({ message: 'La orden debe tener al menos un producto' });
                return;
            }

            const productIds = items.map((i: any) => i.productId);
            const uniqueProductIds = [...new Set(productIds)];
            const dbProducts = await Product.find({ _id: { $in: uniqueProductIds } }).session(session);

            if (dbProducts.length !== uniqueProductIds.length) {
                await session.abortTransaction();
                res.status(400).json({ message: 'Uno o más productos no existen' });
                return;
            }

            const normalizeVariantId = (id: string | undefined | null): string | undefined =>
                (!id || id === '$undefined' || id === 'undefined') ? undefined : id;

            let calculatedSubtotal = 0;
            const orderItems: any[] = [];

            for (const item of items) {
                const dbProduct = dbProducts.find((p: any) => p._id.toString() === item.productId);
                if (!dbProduct) continue;

                const variantId = normalizeVariantId(item.variantId);
                let finalPrice = dbProduct.precio || 0;
                let nombre = dbProduct.nombre;
                let imagen: string | undefined;
                let variantAttributes: Record<string, string> = {};

                if (variantId) {
                    const variant = dbProduct.variants?.find((v: any) => v._id!.toString() === variantId);
                    if (!variant) {
                        await session.abortTransaction();
                        res.status(400).json({ message: `La variante seleccionada para "${dbProduct.nombre}" no existe` });
                        return;
                    }
                    finalPrice = variant.precio ?? dbProduct.precio ?? 0;
                    nombre = `${dbProduct.nombre} ${variant.nombre ?? ''}`.trim();
                    imagen = variant.imagenes?.[0] || dbProduct.imagenes?.[0];
                    variantAttributes = variant.atributos ? JSON.parse(JSON.stringify(variant.atributos)) : {};

                    if ((variant.stock ?? 0) < item.quantity) {
                        await session.abortTransaction();
                        res.status(400).json({ message: `Stock insuficiente para "${nombre}".` });
                        return;
                    }
                } else {
                    imagen = dbProduct.imagenes?.[0];
                    if ((dbProduct.stock ?? 0) < item.quantity) {
                        await session.abortTransaction();
                        res.status(400).json({ message: `Stock insuficiente para "${nombre}".` });
                        return;
                    }
                }

                if (item.price !== finalPrice) {
                    await session.abortTransaction();
                    res.status(400).json({ message: `El precio de "${nombre}" ha cambiado.` });
                    return;
                }

                calculatedSubtotal += finalPrice * item.quantity;
                orderItems.push({
                    productId: dbProduct._id,
                    variantId: variantId ?? undefined,
                    variantAttributes,
                    quantity: item.quantity,
                    price: finalPrice,
                    nombre,
                    imagen
                });
            }

            if (calculatedSubtotal !== subtotal || subtotal + shippingCost !== totalPrice) {
                await session.abortTransaction();
                res.status(400).json({ message: 'Los montos calculados no coinciden' });
                return;
            }

            const orderNumber = `ORD-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
            // ─── COMUNICACIÓN CON CULQI ORDERS API ───────────────────────────
            const CULQI_FEE = 0.037;
            // CAMBIO AQUÍ: Sumamos la comisión antes de enviar los céntimos a Culqi
            const totalPriceWithFee = totalPrice * (1 + CULQI_FEE);
            const amountInCents = Math.round(totalPriceWithFee * 100);

            const expirationTimestamp = Math.floor(Date.now() / 1000) + (24 * 60 * 60); // 24 horas

            let culqiOrderId: string | undefined = undefined;

            try {
                const culqiResponse = await fetch("https://api.culqi.com/v2/orders", {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${process.env.CULQI_API_KEY}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        amount: amountInCents,
                        currency_code: currency.toUpperCase().trim(),
                        description: `Cargo por orden comercial ${orderNumber}`,
                        order_number: orderNumber,
                        expiration_date: expirationTimestamp,
                        client_details: {
                            first_name: customerProfile.nombre,
                            last_name: customerProfile.apellidos,
                            email: customerProfile.email,
                            phone_number: customerProfile.telefono
                        },
                        confirm: false
                    })
                });

                const culqiOrderData = (await culqiResponse.json()) as { id?: string; object?: string;[key: string]: unknown };

                if (culqiResponse.ok && culqiOrderData.id) {
                    culqiOrderId = culqiOrderData.id;
                    console.log(`🌐 [Culqi Orders] Orden generada exitosamente: ${culqiOrderId}`);
                } else {
                    console.error("⚠️ La API de Culqi denegó la creación de la orden:", culqiOrderData);
                }
            } catch (error) {
                console.error("❌ Error de red / Timeout al comunicar con Culqi Orders API:", error);
            }

            // ─── PERSISTENCIA FINAL EN BASE DE DATOS ─────────────────────────
            const newOrder = await Order.create([{
                orderNumber,
                // Si req.user fue inyectado por el middleware opcional, extrae su _id; si no, guarda null de forma explícita
                user: req.user ? new mongoose.Types.ObjectId(req.user._id as string) : null,
                customerProfile,
                items: orderItems,
                subtotal,
                shippingCost,
                totalPrice,
                currency,
                status: OrderStatus.AWAITING_PAYMENT,
                statusHistory: [{ status: OrderStatus.AWAITING_PAYMENT, changedAt: new Date() }],
                shippingAddress,
                payment: {
                    provider: 'culqi',
                    status: PaymentStatus.PENDING,
                    culqiOrderId: culqiOrderId,
                    culqiOrderNumber: orderNumber,
                    culqiOrderState: culqiOrderId ? 'pending' : undefined,
                    culqiExpirationDate: culqiOrderId ? expirationTimestamp : undefined
                }
            }], { session });

            await session.commitTransaction();

            res.status(201).json({
                message: 'Orden registrada localmente con éxito',
                order: newOrder[0]
            });

        } catch (error) {
            await session.abortTransaction();
            console.error('Error al crear la orden local:', error);
            res.status(500).json({ message: 'Error al procesar la orden' });
        } finally {
            session.endSession();
        }
    }


    static async getOrders(req: Request, res: Response) {
        try {
            const page = parseInt(req.query.page as string) || 1;
            let limit = parseInt(req.query.limit as string) || 10;
            const pedido = req.query.pedido as string || '';
            const fecha = req.query.fecha as string || '';
            const fechaFin = req.query.fechaFin as string || '';
            const estadoPago = req.query.estadoPago as string || '';
            const estadoEnvio = req.query.estadoEnvio as string || '';
            const usuario = req.query.usuario as string || '';
            const montoMin = req.query.montoMin as string || '';
            const montoMax = req.query.montoMax as string || '';

            if (limit > 50) {
                limit = 50;
            }

            const skip = (page - 1) * limit;
            const searchConditions: any = {};

            if (pedido?.trim()) {
                searchConditions.orderNumber = { $regex: pedido, $options: "i" };
            }

            if (fecha) {
                const fechaInicioStr = `${fecha}T00:00:00.000-05:00`;
                const fechaFinStr = `${fechaFin || fecha}T23:59:59.999-05:00`;

                const startDate = new Date(fechaInicioStr);
                const endDate = new Date(fechaFinStr);

                searchConditions.createdAt = { $gte: startDate, $lte: endDate };
            }

            if (estadoPago) {
                searchConditions['payment.status'] = estadoPago;
            }

            if (estadoEnvio) {
                searchConditions.status = estadoEnvio;
            }

            if (montoMin || montoMax) {
                searchConditions.totalPrice = {};
                if (montoMin) {
                    searchConditions.totalPrice.$gte = parseFloat(montoMin);
                }
                if (montoMax) {
                    searchConditions.totalPrice.$lte = parseFloat(montoMax);
                }
            }

            const orders = await Order.find(searchConditions)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit);

            const totalOrders = await Order.countDocuments(searchConditions);

            res.status(200).json({
                orders,
                totalOrders,
                currentPage: page,
                totalPages: Math.ceil(totalOrders / limit),
            });

        } catch (error) {
            console.error('Error fetching orders:', error);
            res.status(500).json({ message: 'Error al obtener las órdenes' });
        }
    }

    static async getOrdersByUser(req: Request, res: Response) {
        try {
            const page = parseInt(req.query.page as string) || 1;
            let limit = parseInt(req.query.limit as string) || 5;
            const userId = req.user._id;

            const skip = (page - 1) * limit;

            if (limit > 50) {
                limit = 50;
            }

            const orders = await Order.find({ user: userId })
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit);

            console.log(`🔍 Consultando órdenes para  ${orders}`, orders);

            const totalOrders = await Order.countDocuments({ user: userId });

            console.log(`📦 Usuario ${userId} ha consultado sus órdenes. Página: ${page}, Límite: ${limit}, Total Órdenes: ${totalOrders}`);

            res.status(200).json({
                orders,
                totalOrders,
                currentPage: page,
                totalPages: Math.ceil(totalOrders / limit),
            });
        } catch (error) {
            res.status(500).json({ message: 'Error al obtener las órdenes del usuario' });
        }
    }

    static async getOrderById(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const order = await Order.findById(id).populate('user', 'nombre apellidos email');

            if (!order) {
                res.status(404).json({ message: 'Orden no encontrada' });
                return;
            }

            res.status(200).json(order);
        } catch (error) {
            res.status(500).json({ message: 'Error al obtener la orden' });
        }
    }

    static async createOrderFromPayment(req: Request, res: Response) {
        try {
            const { userId, items, totalPrice, shippingAddress, paymentMethod, paymentStatus, trackingId } = req.body;

            if (!userId || !items || !totalPrice || !shippingAddress || !paymentMethod || !paymentStatus) {
                res.status(400).json({ message: 'Datos incompletos para crear la orden' });
                return;
            }

            const totalOrders = await Order.countDocuments();
            const orderNumber = `ORD-${totalOrders + 1}`;

            const newOrder = new Order({
                orderNumber,
                user: userId,
                items,
                totalPrice,
                shippingAddress,
                paymentMethod,
                paymentStatus,
                trackingId: trackingId || null,
            });

            await newOrder.save();
            res.status(201).json({ message: 'Orden creada exitosamente', order: newOrder });

        } catch (error) {
            console.error('❌ Error al guardar orden desde webhook:', error);
        }
    }

    static async getSummaryOrders(req: Request, res: Response) {
        try {
            const { fechaInicio, fechaFin } = req.query;

            if (!fechaInicio || !fechaFin || typeof fechaInicio !== "string" || typeof fechaFin !== "string") {
                res.status(400).json({ message: "Debe proporcionar fechaInicio y fechaFin válidas" });
                return;
            }

            const startDate = startOfDay(parseISO(fechaInicio));
            const endDate = endOfDay(parseISO(fechaFin));

            const orders = await Order.find({
                createdAt: { $gte: startDate, $lte: endDate }
            }).populate("items.productId");

            let grossSales = 0;
            let netSales = 0;
            let numberOrdersPagadas = 0;
            let numberOrdersPendientes = 0;
            let numberOrdersCanceladas = 0;
            let totalUnitsSold = 0;
            let margin = 0;

            for (const order of orders) {
                grossSales += order.totalPrice;

                const isPaid = order.payment.status === PaymentStatus.APPROVED;
                const isPending = order.payment.status === PaymentStatus.PENDING;
                const isCanceled = order.status === "canceled";

                if (isPaid) {
                    numberOrdersPagadas++;
                    netSales += order.totalPrice;

                    for (const item of order.items) {
                        const product = item.productId as any;
                        totalUnitsSold += item.quantity;

                        if (product?.costo != null) {
                            margin += (item.price - product.costo) * item.quantity;
                        }
                    }
                }

                if (isPending) numberOrdersPendientes++;
                if (isCanceled) numberOrdersCanceladas++;
            }

            const avgPaidOrderValue = numberOrdersPagadas > 0 ? netSales / numberOrdersPagadas : 0;
            const marginRate = netSales > 0 ? (margin / netSales) * 100 : 0;

            const summary = {
                grossSales,
                netSales,
                numberOrders: orders.length,
                numberOrdersPagadas,
                numberOrdersPendientes,
                numberOrdersCanceladas,
                totalUnitsSold,
                margin,
                marginRate: `${marginRate.toFixed(2)}%`,
                avgPaidOrderValue
            };

            res.json(summary);
        } catch (error) {
            console.error("Error en getSummaryOrders:", error);
            res.status(500).json({ message: "Error al obtener resumen de órdenes" });
        }
    }

    static async getOrderByOrderNumber(req: Request, res: Response) {
        try {
            const { orderNumber } = req.params;

            if (!orderNumber) {
                res.status(400).json({ message: 'El número de orden es requerido en los parámetros.' });
                return;
            }

            const order = await Order.findOne({ orderNumber });

            if (!order) {
                res.status(404).json({ message: 'El número de pedido solicitado no existe en el sistema.' });
                return;
            }

            res.status(200).json({ order });
        } catch (error) {
            console.error('❌ Error interno en getOrderByOrderNumber:', error);
            res.status(500).json({ message: 'Error interno del servidor al consultar el estado del pedido.' });
        }
    }

    static async getOrdersOverTime(req: Request, res: Response) {
        try {
            const { fechaInicio, fechaFin } = req.query;

            if (!fechaInicio || !fechaFin || typeof fechaInicio !== "string" || typeof fechaFin !== "string") {
                res.status(400).json({ message: "Debe proporcionar fechaInicio y fechaFin válidas" });
                return;
            }

            const startDate = startOfDay(parseISO(fechaInicio));
            const endDate = endOfDay(parseISO(fechaFin));
            const dateFormat = "%Y-%m-%d";

            const report = await Order.aggregate([
                {
                    $match: {
                        "payment.status": PaymentStatus.APPROVED,
                        createdAt: { $gte: startDate, $lte: endDate }
                    }
                },
                {
                    $group: {
                        _id: {
                            $dateToString: { format: dateFormat, date: "$createdAt" }
                        },
                        totalSales: { $sum: "$totalPrice" },
                        numberOfOrders: { $sum: 1 },
                    }
                },
                {
                    $project: {
                        _id: 0,
                        date: "$_id",
                        numberOfOrders: 1,
                        totalSales: 1
                    }
                },
                { $sort: { date: 1 } }
            ]);

            res.json(report);
        } catch (error) {
            console.error("Error en getOrdersOverTime:", error);
            res.status(500).json({ message: "Error al obtener órdenes por tiempo" });
        }
    }

    static async getReportOrdersByStatus(req: Request, res: Response) {
        try {
            const { fechaInicio, fechaFin } = req.query;

            if (!fechaInicio || !fechaFin || typeof fechaInicio !== "string" || typeof fechaFin !== "string") {
                res.status(400).json({ message: "Debe proporcionar fechaInicio y fechaFin válidas" });
                return;
            }

            const startDate = startOfDay(parseISO(fechaInicio));
            const endDate = endOfDay(parseISO(fechaFin));

            const report = await Order.aggregate([
                {
                    $match: {
                        createdAt: { $gte: startDate, $lte: endDate }
                    }
                },
                {
                    $group: {
                        _id: "$status",
                        numberOfOrders: { $sum: 1 },
                    }
                },
                {
                    $project: {
                        _id: 0,
                        status: "$_id",
                        numberOfOrders: 1,
                    }
                },
                { $sort: { status: 1 } }
            ]);

            res.json(report);
        } catch (error) {
            console.error("Error en getReportOrdersByStatus:", error);
            res.status(500).json({ message: "Error al obtener reporte de órdenes por estado" });
        }
    }

    static async getReportOrdersByMethodPayment(req: Request, res: Response) {
        try {
            const { fechaInicio, fechaFin } = req.query;

            if (!fechaInicio || !fechaFin || typeof fechaInicio !== "string" || typeof fechaFin !== "string") {
                res.status(400).json({ message: "Debe proporcionar fechas válidas" });
                return;
            }

            const startDate = startOfDay(parseISO(fechaInicio));
            const endDate = endOfDay(parseISO(fechaFin));

            const report = await Order.aggregate([
                {
                    $match: {
                        createdAt: { $gte: startDate, $lte: endDate },
                        "payment.status": PaymentStatus.APPROVED // Solo consideramos ventas reales
                    }
                },
                {
                    $group: {
                        _id: "$payment.provider", // O "$payment.method" según cómo lo guardes
                        numberOfOrders: { $sum: 1 },
                        totalSales: { $sum: "$totalPrice" },
                    }
                },
                {
                    $project: {
                        _id: 0,
                        provider: "$_id",
                        numberOfOrders: 1,
                        totalSales: 1
                    }
                }
            ]);

            res.json(report);
        } catch (error) {
            console.error("Error en getReportOrdersByMethodPayment:", error);
            res.status(500).json({ message: "Error al generar reporte de pagos" });
        }
    }

    static async getReportOrdersByPaymentStatus(req: Request, res: Response) {
        try {
            const { fechaInicio, fechaFin } = req.query;

            if (!fechaInicio || !fechaFin || typeof fechaInicio !== "string" || typeof fechaFin !== "string") {
                res.status(400).json({ message: "Fechas inválidas" });
                return;
            }

            const startDate = startOfDay(parseISO(fechaInicio));
            const endDate = endOfDay(parseISO(fechaFin));

            const report = await Order.aggregate([
                {
                    $match: {
                        createdAt: { $gte: startDate, $lte: endDate }
                    }
                },
                {
                    $group: {
                        _id: "$payment.status", // Agrupa por el enum de PaymentStatus
                        numberOfOrders: { $sum: 1 }
                    }
                },
                {
                    $project: {
                        _id: 0,
                        status: "$_id", // Mapea a 'status' para que coincida con tu esquema
                        numberOfOrders: 1
                    }
                },
                { $sort: { status: 1 } }
            ]);

            res.json(report);
        } catch (error) {
            console.error("Error en getReportOrdersByPaymentStatus:", error);
            res.status(500).json({ message: "Error al generar reporte de estado de pago" });
        }
    }

    static async getReportOrdersByCity(req: Request, res: Response) {
        try {
            const { fechaInicio, fechaFin } = req.query;

            if (!fechaInicio || !fechaFin || typeof fechaInicio !== "string" || typeof fechaFin !== "string") {
                res.status(400).json({ message: "Debe proporcionar fechaInicio y fechaFin válidas" });
                return;
            }

            const startDate = startOfDay(parseISO(fechaInicio));
            const endDate = endOfDay(parseISO(fechaFin));

            const report = await Order.aggregate([
                {
                    $match: {
                        createdAt: { $gte: startDate, $lte: endDate }
                    }
                },
                {
                    $group: {
                        _id: "$shippingAddress.departamento",
                        numberOfOrders: { $sum: 1 },
                        totalSales: { $sum: "$totalPrice" },
                    }
                },
                {
                    $project: {
                        _id: 0,
                        department: "$_id",
                        numberOfOrders: 1,
                        totalSales: 1
                    }
                },
                { $sort: { department: 1 } }
            ]);

            res.json(report);
        } catch (error) {
            console.error("Error en getReportOrdersByCity:", error);
            res.status(500).json({ message: "Error al obtener reporte de órdenes por ciudad" });
        }
    }

    static async updateOrderStatus(req: Request, res: Response) {
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            const { id } = req.params;
            const { status: newStatus } = req.body as { status: OrderStatus };

            const order = await Order.findById(id).session(session);
            if (!order) {
                await session.abortTransaction();
                res.status(404).json({ message: 'Orden no encontrada' });
                return;
            }

            const currentStatus = order.status;

            if (!ALLOWED_TRANSITIONS[currentStatus]?.includes(newStatus)) {
                await session.abortTransaction();
                res.status(400).json({
                    message: `Transición no permitida: de ${currentStatus} a ${newStatus}`
                });
                return;
            }

            if (newStatus === OrderStatus.CANCELED && STATUSES_WITH_DEDUCTED_STOCK.includes(currentStatus)) {
                console.log(`[Stock] Restaurando inventario para orden: ${order.orderNumber}`);
                await OrderService.adjustStock(order.items, 'restore', session);
            }

            if (currentStatus === OrderStatus.PAID_BUT_OUT_OF_STOCK && newStatus === OrderStatus.PROCESSING) {
                console.log(`[Stock] Descontando stock tras reposición: ${order.orderNumber}`);
                await OrderService.adjustStock(order.items, 'deduct', session);
            }

            order.status = newStatus;
            order.statusHistory.push({
                status: newStatus,
                changedAt: new Date()
            });

            await order.save({ session });
            await session.commitTransaction();

            res.status(200).json({
                message: 'Estado actualizado y stock sincronizado correctamente',
                order
            });

        } catch (error: any) {
            await session.abortTransaction();
            console.error('Error al actualizar estado de la orden:', error);
            res.status(500).json({
                message: 'Error interno al procesar el cambio de estado',
                error: error.message
            });
        } finally {
            session.endSession();
        }
    }

    static async generateOrderPDF(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const order = await Order.findById(id).populate('user', 'nombre apellidos email');

            if (!order) {
                res.status(404).json({ message: 'Orden no encontrada' });
                return;
            }

            const path = require('path');
            const logoPath = path.join(process.cwd(), 'public', 'logocompleto.png');

            const pdfBuffer = await PdfService.generateBuffer(
                (doc, data) => buildOrderReceipt(doc, data, logoPath),
                order
            );

            res.setHeader("Content-Type", "application/pdf");
            res.setHeader("Content-Disposition", `inline; filename="Orden-${order.orderNumber}.pdf"`);
            res.setHeader("Content-Length", pdfBuffer.length);

            res.end(pdfBuffer);
        } catch (error) {
            console.error("Error en generateOrderPDF:", error);
            res.status(500).json({ message: "Error interno al generar el PDF de la orden" });
        }
    }

    static async generateShippingLabelPDF(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const order = await Order.findById(id).populate('user', 'nombre apellidos telefono email');

            if (!order) {
                res.status(404).json({ message: 'Orden no encontrada' });
                return;
            }

            const pdfBuffer = await PdfService.generateBuffer(
                buildShippingLabel,
                order,
                { size: [288, 432], margin: 0 }
            );

            res.setHeader("Content-Type", "application/pdf");
            res.setHeader("Content-Disposition", `inline; filename="Etiqueta-${order.orderNumber}.pdf"`);
            res.setHeader("Content-Length", pdfBuffer.length);

            res.end(pdfBuffer);
        } catch (error) {
            console.error("Error al generar Etiqueta de Envío:", error);
            res.status(500).json({ message: "Error interno al generar etiqueta" });
        }
    }


}