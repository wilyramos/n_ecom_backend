import mongoose, { Schema, Document, Types } from 'mongoose';
import { IUser } from './User';
import { IProduct } from './Product';

// ─── Enums ────────────────────────────────────────────────────────────────────

export enum OrderStatus {
    AWAITING_PAYMENT = 'awaiting_payment',
    PROCESSING = 'processing',
    SHIPPED = 'shipped',
    DELIVERED = 'delivered',
    CANCELED = 'canceled',
    PAID_BUT_OUT_OF_STOCK = 'paid_but_out_of_stock',
}

export enum PaymentStatus {
    PENDING = 'pending',
    APPROVED = 'approved',
    REJECTED = 'rejected',
    REFUNDED = 'refunded',
}

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface IShippingAddress {
    departamento: string;
    provincia: string;
    distrito: string;
    direccion: string;
    numero?: string;
    pisoDpto?: string;
    referencia?: string;
}

export interface ICustomerProfile {
    nombre: string;
    apellidos: string;
    email: string;
    telefono: string;
    tipoDocumento: string;
    numeroDocumento: string;
}

export interface IOrderItem {
    productId: Types.ObjectId | IProduct;
    variantId?: Types.ObjectId;
    variantAttributes?: Record<string, string>;
    quantity: number;
    price: number;
    nombre: string; // nombre histórico producto + variante
    imagen?: string;
}

export interface IPaymentInfo {
    provider: string;
    method?: string;
    /**
     * ID del cargo (cge_live_xxx) para pagos con tarjeta directa.
     * Para órdenes Culqi usa culqiOrderId.
     */
    transactionId?: string;
    status: PaymentStatus;
    rawResponse?: any;

    // ── Culqi Orden ──────────────────────────────────────────────────────────
    /** ID único de la orden en Culqi: "ord_live_xxxxxxxxxxx" */
    culqiOrderId?: string;
    /**
     * Tu order_number enviado a Culqi.
     * Facilita la conciliación contable en el CulqiPanel.
     */
    culqiOrderNumber?: string;
    /**
     * Código CIP generado por PagoEfectivo.
     * Debe mostrársele al cliente para pagar en agentes / bancos.
     */
    culqiPaymentCode?: string;
    /**
     * Estado de la orden en Culqi: "pending" | "paid" | "expired" | "deleted".
     * Es independiente del OrderStatus interno.
     */
    culqiOrderState?: string;
    /** Unix timestamp de expiración de la orden (enviado al crear la orden). */
    culqiExpirationDate?: number;
    /** Unix timestamp en que Culqi confirmó el pago (campo paid_at del webhook). */
    culqiPaidAt?: number;
}

export interface IStatusHistory {
    status: OrderStatus;
    changedAt: Date;
}

export interface IOrder extends Document {
    orderNumber: string;
    user?: Types.ObjectId | IUser; // Opcional — link relacional si está registrado
    customerProfile: ICustomerProfile;       // Siempre requerido — copia estática histórica
    items: IOrderItem[];
    subtotal: number;
    shippingCost: number;
    totalPrice: number;
    currency: string;
    status: OrderStatus;
    statusHistory: IStatusHistory[];
    shippingAddress: IShippingAddress;
    payment: IPaymentInfo;
    createdAt: Date;
    updatedAt: Date;
}

// ─── Sub-schemas ──────────────────────────────────────────────────────────────

const shippingAddressSchema = new Schema<IShippingAddress>({
    departamento: { type: String, required: true },
    provincia: { type: String, required: true },
    distrito: { type: String, required: true },
    direccion: { type: String, required: true },
    numero: { type: String },
    pisoDpto: { type: String },
    referencia: { type: String },
}, { _id: false });

const customerProfileSchema = new Schema<ICustomerProfile>({
    nombre: { type: String, required: true },
    apellidos: { type: String, required: true },
    email: { type: String, required: true },
    telefono: { type: String, required: true },
    tipoDocumento: { type: String, required: true },
    numeroDocumento: { type: String, required: true },
}, { _id: false });

const orderItemSchema = new Schema<IOrderItem>({
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    variantId: { type: Schema.Types.ObjectId },
    variantAttributes: { type: Map, of: String },
    quantity: { type: Number, required: true },
    price: { type: Number, required: true },
    nombre: { type: String, required: true },
    imagen: { type: String },
}, { _id: false });

const paymentSchema = new Schema<IPaymentInfo>({
    provider: { type: String, required: true },
    method: { type: String },
    transactionId: { type: String },
    status: { type: String, enum: Object.values(PaymentStatus), default: PaymentStatus.PENDING },
    rawResponse: { type: Schema.Types.Mixed },

    // Culqi Orden
    culqiOrderId: { type: String },
    culqiOrderNumber: { type: String },
    culqiPaymentCode: { type: String },
    culqiOrderState: { type: String },
    culqiExpirationDate: { type: Number },
    culqiPaidAt: { type: Number },
}, { _id: false });

const statusHistorySchema = new Schema<IStatusHistory>({
    status: { type: String, enum: Object.values(OrderStatus), required: true },
    changedAt: { type: Date, default: Date.now },
}, { _id: false });

// ─── Schema principal ─────────────────────────────────────────────────────────

const orderSchema = new Schema<IOrder>({
    orderNumber: { type: String, unique: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: false },
    customerProfile: { type: customerProfileSchema, required: true },
    items: { type: [orderItemSchema], required: true },
    subtotal: { type: Number, required: true },
    shippingCost: { type: Number, default: 0 },
    totalPrice: { type: Number, required: true },
    currency: { type: String, default: 'PEN' },
    status: { type: String, enum: Object.values(OrderStatus), default: OrderStatus.AWAITING_PAYMENT },
    statusHistory: { type: [statusHistorySchema], default: [] },
    shippingAddress: { type: shippingAddressSchema, required: true },
    payment: { type: paymentSchema, required: true },
}, { timestamps: true });

// ─── Índices ──────────────────────────────────────────────────────────────────

orderSchema.index({ user: 1 });
orderSchema.index({ status: 1 });
orderSchema.index({ 'payment.transactionId': 1 });
orderSchema.index({ 'payment.culqiOrderId': 1 });   // búsqueda por orden Culqi
orderSchema.index({ 'payment.culqiPaymentCode': 1 }); // búsqueda por código CIP

// ─── Model ────────────────────────────────────────────────────────────────────

const Order = mongoose.model<IOrder>('Order', orderSchema);

export default Order;