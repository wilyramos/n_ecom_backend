//File: backend/src/controllers/OrderController.ts

import Order, { OrderStatus, PaymentStatus } from '../models/Order';
import { Request, Response } from 'express';
import mongoose from 'mongoose';
import Product from '../models/Product';
import { startOfDay, endOfDay, parseISO } from 'date-fns';
import { OrderService } from '../services/OrderService';
import { buildOrderReceipt } from '../templates/saleReceipt.template';
import { PdfService } from '../services/pdf.service';
import { buildShippingLabel } from '../templates/shippingLabel.template';



// Definir junto al controlador o en un archivo de constantes
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
                paymentMethod,
                transactionId,
                payment,
                rawPaymentResponse,
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

            if (!payment?.provider) {
                await session.abortTransaction();
                res.status(400).json({ message: 'Proveedor de pago requerido' });
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
                        res.status(400).json({
                            message: `La variante seleccionada para "${dbProduct.nombre}" no existe`
                        });
                        return;
                    }

                    finalPrice = variant.precio ?? dbProduct.precio ?? 0;
                    nombre = `${dbProduct.nombre} ${variant.nombre ?? ''}`.trim();
                    imagen = variant.imagenes?.[0] || dbProduct.imagenes?.[0];

                    try {
                        variantAttributes = variant.atributos
                            ? JSON.parse(JSON.stringify(variant.atributos))
                            : {};
                    } catch {
                        variantAttributes = {};
                    }

                    if ((variant.stock ?? 0) < item.quantity) {
                        await session.abortTransaction();
                        res.status(400).json({
                            message: `Stock insuficiente para "${nombre}". Disponible: ${variant.stock}`
                        });
                        return;
                    }
                } else {
                    imagen = dbProduct.imagenes?.[0];

                    if ((dbProduct.stock ?? 0) < item.quantity) {
                        await session.abortTransaction();
                        res.status(400).json({
                            message: `Stock insuficiente para "${nombre}". Disponible: ${dbProduct.stock}`
                        });
                        return;
                    }
                }

                if (item.price !== finalPrice) {
                    await session.abortTransaction();
                    res.status(400).json({
                        message: `El precio de "${nombre}" ha cambiado. Por favor recarga la página.`
                    });
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

            if (calculatedSubtotal !== subtotal) {
                await session.abortTransaction();
                res.status(400).json({ message: 'El subtotal no coincide' });
                return;
            }

            if (subtotal + shippingCost !== totalPrice) {
                await session.abortTransaction();
                res.status(400).json({ message: 'El total no coincide' });
                return;
            }

            const orderNumber = `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

            // ── Culqi Orders API ──────────────────────────────────────────────────
            let culqiOrderId: string | undefined;
            let culqiOrderNumber: string | undefined;
            let culqiPaymentCode: string | undefined;
            let culqiOrderState: string | undefined;
            let culqiExpiration: number | undefined;
            let culqiRawResponse: unknown;

            if (payment.provider === 'culqi') {
                const amountInCents = Math.round(totalPrice * 100);
                // Asegurar que la expiración sea de mínimo 24 horas exactas hacia el futuro
                const expirationDate = Math.floor(Date.now() / 1000) + (24 * 60 * 60);

                try {
                    const culqiResponse = await fetch('https://api.culqi.com/v2/orders', {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${process.env.CULQI_API_KEY}`,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            amount: amountInCents,
                            currency_code: String(currency).toUpperCase().trim(),
                            description: `NEOSHOP Compra - Pedido ${orderNumber}`,
                            order_number: orderNumber,
                            expiration_date: expirationDate,
                            client_details: {
                                first_name: customerProfile.nombre,
                                last_name: customerProfile.apellidos,
                                email: customerProfile.email.toLowerCase().trim(),
                                phone_number: customerProfile.telefono,
                            },
                            // Parámetros obligatorios para la prevención de fraudes 3DS de Culqi
                            antifraud_details: {
                                address: shippingAddress.direccion,
                                address_city: shippingAddress.distrito,
                                country_code: "PE",
                                first_name: customerProfile.nombre,
                                last_name: customerProfile.apellidos,
                                phone_number: customerProfile.telefono
                            },
                            metadata: {
                                order_number: orderNumber,
                            },
                        }),
                    });

                    const culqiData = await culqiResponse.json() as Record<string, any>;
                    culqiRawResponse = culqiData;

                    if (culqiResponse.ok && typeof culqiData.id === 'string') {
                        culqiOrderId = culqiData.id;
                        culqiOrderNumber = typeof culqiData.order_number === 'string' ? culqiData.order_number : orderNumber;
                        culqiPaymentCode = typeof culqiData.payment_code === 'string' ? culqiData.payment_code : undefined;
                        culqiOrderState = typeof culqiData.state === 'string' ? culqiData.state : 'pending';
                        culqiExpiration = typeof culqiData.expiration_date === 'number' ? culqiData.expiration_date : expirationDate;

                        console.log(`✅ [Express API] Culqi orden creada exitosamente: ${culqiOrderId} en estado: ${culqiOrderState}`);
                    } else {
                        console.error('⚠️ [Express API] Culqi denegó los parámetros estructurados enviados:', culqiData);
                    }

                } catch (networkError) {
                    console.error('❌ [Express API] Error crítico de comunicación con Culqi API:', networkError);
                }
            }

            // ── Persistencia MongoDB ──────────────────────────────────────────────
            const newOrder = await Order.create([{
                orderNumber,
                user: req.user ? req.user._id : undefined,
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
                    provider: payment.provider,
                    method: paymentMethod,
                    transactionId,
                    status: payment.status || PaymentStatus.PENDING,
                    rawResponse: culqiRawResponse ?? rawPaymentResponse,
                    ...(payment.provider === 'culqi' && {
                        culqiOrderId,
                        culqiOrderNumber,
                        culqiPaymentCode,
                        culqiOrderState,
                        culqiExpirationDate: culqiExpiration,
                    }),
                }
            }], { session });

            await session.commitTransaction();

            res.status(201).json({
                message: 'Orden creada exitosamente',
                order: newOrder[0],
                ...(culqiOrderId && { culqiOrderId }),
            });

        } catch (error) {
            await session.abortTransaction();
            console.error('Error al crear la orden:', error);
            res.status(500).json({ message: 'Error al crear la orden' });
        } finally {
            session.endSession();
        }
    }

    // Trear todas las orders para el administrador
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

            // Filtro por número de pedido
            if (pedido?.trim()) {
                searchConditions.orderNumber = { $regex: pedido, $options: "i" };
            }

            // Filtro por rango de fechas
            if (fecha) {
                const startDate = new Date(fecha);
                const endDate = new Date(fechaFin || fecha);
                endDate.setHours(23, 59, 59, 999);
                searchConditions.createdAt = { $gte: startDate, $lte: endDate };
            }

            // Filtro por estado de pago
            if (estadoPago) {
                searchConditions['payment.status'] = estadoPago;
            }

            // Filtro por estado de envío
            if (estadoEnvio) {
                searchConditions.status = estadoEnvio;
            }

            // Filtro por rango de monto
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
                .limit(limit)
            // .populate('user', 'nombre email')
            // .populate('items.productId', 'nombre');

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

            // Limitar a maximo 50
            if (limit > 50) {
                limit = 50;
            }

            const orders = await Order.find({ user: userId })
                .sort({ createdAt: -1 }) // Ordenar por fecha de creación
                .skip(skip)
                .limit(limit)

            const totalOrders = await Order.countDocuments({ user: userId });

            res.status(200).json({
                orders,
                totalOrders,
                currentPage: page,
                totalPages: Math.ceil(totalOrders / limit),
            });
        } catch (error) {
            // console.error(error);
            res.status(500).json({ message: 'Error al obtener las órdenes del usuario' });
            return;
        }
    }

    static async getOrderById(req: Request, res: Response) {
        try {
            const { id } = req.params;
            // const userId = req.user._id;
            // const rol = req.user.rol;

            const order = await Order.findById(id)
                .populate('user', 'nombre apellidos email') // Populate el usuario si es necesario

            if (!order) {
                res.status(404).json({ message: 'Orden no encontrada' });
                return;
            }

            // if (rol !== 'administrador' && order.user._id.toString() !== userId.toString()) {
            //     res.status(403).json({ message: 'No tienes permiso para acceder a esta orden' });
            //     return;
            // }

            res.status(200).json(order);
        } catch (error) {
            // console.error(error);
            res.status(500).json({ message: 'Error al obtener la orden' });
            return;
        }
    }

    static async createOrderFromPayment(req: Request, res: Response) {
        try {
            const { userId, items, totalPrice, shippingAddress, paymentMethod, paymentStatus, trackingId } = req.body;

            // Validar que los datos necesarios estén presentes
            if (!userId || !items || !totalPrice || !shippingAddress || !paymentMethod || !paymentStatus) {
                res.status(400).json({ message: 'Datos incompletos para crear la orden' });
                return;
            }

            const totalOrders = await Order.countDocuments();
            const orderNumber = `ORD-${totalOrders + 1}`; // Generar un número de orden único

            // Crear la orden
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

    // *** REPORTS ***


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

            // Inicializar métricas
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
            return;

        } catch (error) {
            console.error("Error en getSummaryOrders:", error);
            res.status(500).json({ message: "Error al obtener resumen de órdenes" });
            return;
        }
    }

    static async getOrderByOrderNumber(req: Request, res: Response) {
        try {
            const { orderNumber } = req.params;

            if (!orderNumber) {
                res.status(400).json({ message: 'El número de orden es requerido en los parámetros.' });
                return;
            }

            // Buscar la orden por coincidencia exacta de número de pedido
            const order = await Order.findOne({ orderNumber });

            if (!order) {
                res.status(404).json({ message: 'El número de pedido solicitado no existe en el sistema.' });
                return;
            }

            // Responder estructurado bajo el objeto 'order' para el mapeo directo en el frontend
            res.status(200).json({ order });
            return;
        } catch (error) {
            console.error('❌ Error interno en getOrderByOrderNumber:', error);
            res.status(500).json({ message: 'Error interno del servidor al consultar el estado del pedido.' });
            return;
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
            const dateFormat = "%Y-%m-%d"; // Formato de fecha para agrupar por día

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
            return
        } catch (error) {
            console.error("Error en getOrdersOverTime:", error);
            res.status(500).json({ message: "Error al obtener órdenes por tiempo" });
            return;
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
            return
        } catch (error) {
            console.error("Error en getReportOrdersByStatus:", error);
            res.status(500).json({ message: "Error al obtener reporte de órdenes por estado" });
            return;
        }
    }

    static async getReportOrdersByMethodPayment(req: Request, res: Response) {
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
                        _id: "$payment.method",
                        numberOfOrders: { $sum: 1 },
                        totalSales: { $sum: "$totalPrice" },
                    }
                },
                {
                    $project: {
                        _id: 0,
                        method: "$_id",
                        numberOfOrders: 1,
                        totalSales: 1
                    }
                },
                { $sort: { method: 1 } }
            ]);

            res.json(report);
            return
        } catch (error) {
            console.error("Error en getReportOrdersByMethodPayment:", error);
            res.status(500).json({ message: "Error al obtener reporte de órdenes por método de pago" });
            return;
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
            return
        } catch (error) {
            console.error("Error en getReportOrdersByCity:", error);
            res.status(500).json({ message: "Error al obtener reporte de órdenes por ciudad" });
            return;
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

            // CASO A: Cancelación — restaurar stock si ya fue descontado
            if (newStatus === OrderStatus.CANCELED && STATUSES_WITH_DEDUCTED_STOCK.includes(currentStatus)) {
                console.log(`[Stock] Restaurando inventario para orden: ${order.orderNumber}`);
                await OrderService.adjustStock(order.items, 'restore', session);
            }

            // CASO B: ELIMINADO — createOrder ya descuenta stock al crear la orden
            // AWAITING_PAYMENT → PROCESSING no requiere ajuste de stock adicional

            // CASO C: PAID_BUT_OUT_OF_STOCK → PROCESSING
            // El admin repuso inventario manualmente en DB, ahora confirma la orden
            // Solo descontar si el stock fue previamente restaurado al entrar en este estado
            // (depende de tu flujo de webhook — ver nota abajo)
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

            // 1. Buscamos la orden y populamos el usuario para tener su nombre y correo
            const order = await Order.findById(id).populate('user', 'nombre apellidos email');

            if (!order) {
                res.status(404).json({ message: 'Orden no encontrada' });
                return;
            }

            // (Opcional) Seguridad: Verificar que el usuario que lo solicita es dueño de la orden o es admin
            // Si req.user existe, descomenta esto:
            // if (req.user.rol !== 'administrador' && order.user._id.toString() !== req.user._id.toString()) {
            //     res.status(403).json({ message: 'No autorizado' });
            //     return;
            // }

            // 2. Ruta de tu logo (Opcional, ajusta la ruta según tu servidor)
            // const logoPath = path.resolve(__dirname, '../../public/logo.png');
            const path = require('path');
            const logoPath = path.join(process.cwd(), 'public', 'logocompleto.png');

            // 3. Usamos nuestro servicio genérico pasándole el template y los datos
            const pdfBuffer = await PdfService.generateBuffer(
                (doc, data) => buildOrderReceipt(doc, data, logoPath),
                order
            );

            // 4. Devolver el archivo binario al cliente con los headers correctos
            res.setHeader("Content-Type", "application/pdf");
            res.setHeader("Content-Disposition", `inline; filename="Orden-${order.orderNumber}.pdf"`);
            res.setHeader("Content-Length", pdfBuffer.length);

            res.end(pdfBuffer);
            return;

        } catch (error) {
            console.error("Error en generateOrderPDF:", error);
            res.status(500).json({ message: "Error interno al generar el PDF de la orden" });
            return;
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

            // Generamos el PDF indicando el tamaño exacto de etiqueta térmica 4x6 pulgadas
            // (72 puntos por pulgada -> 4 * 72 = 288, 6 * 72 = 432)
            const pdfBuffer = await PdfService.generateBuffer(
                buildShippingLabel,
                order,
                { size: [288, 432], margin: 0 } // Quitamos el margen global para manejarlo en el template
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