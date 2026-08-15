// File: backend/src/modules/pedidos/pedido.model.ts

import mongoose, { Schema, Document, Types } from 'mongoose';

// ─── Enums ────────────────────────────────────────────────────────────────────

export enum EstadoPedido {
  AWAITING_PAYMENT = 'awaiting_payment',
  PROCESSING = 'processing',
  SHIPPED = 'shipped',
  DELIVERED = 'delivered',
  CANCELED = 'canceled',
  PAID_BUT_OUT_OF_STOCK = 'paid_but_out_of_stock',
}

export enum EstadoPago {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  REFUNDED = 'refunded',
}

export enum TipoDocumento {
  DNI = 'DNI',
  CE = 'CE',
  RUC = 'RUC',
  PASSPORT = 'PASAPORTE',
  OTHER = 'OTRO',
}

export enum TipoComprobante {
  BOLETA = 'boleta',
  FACTURA = 'factura',
}

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface IDireccionEnvio {
  departamento: string;
  provincia: string;
  distrito: string;
  direccion: string;
  numero?: string;
  pisoDpto?: string;
  referencia?: string;
}

export interface IPerfilCliente {
  nombre: string;
  apellidos: string;
  email: string;
  telefono: string;
  tipoDocumento: TipoDocumento;
  numeroDocumento: string;
}

export interface IInfoFacturacion {
  type: TipoComprobante;
  documentNumber: string;
  businessName?: string;
  address?: string;
}

export interface IItemPedido {
  productId: Types.ObjectId;
  variantId?: Types.ObjectId;
  variantAttributes?: Record<string, string>;
  quantity: number;
  price: number;
  nombre: string;
  imagen?: string;
}

export interface IInfoPago {
  provider: string;
  method?: string;
  gatewayOrderId?: string;
  transactionId?: string;
  paymentCode?: string;
  status: EstadoPago;
  paidAt?: Date;
  gatewayData?: Record<string, any>;
}

export interface IHistorialEstado {
  status: EstadoPedido;
  changedAt: Date;
}

export interface IPedido extends Document {
  orderNumber: string;
  user?: Types.ObjectId;
  customerProfile: IPerfilCliente;
  deliveryMethod: 'shipping' | 'pickup';
  invoiceInfo?: IInfoFacturacion;
  items: IItemPedido[];

  subtotal: number;
  igv: number;
  shippingCost: number;
  recargoFinanciero: number;
  totalPrice: number;
  currency: string;

  status: EstadoPedido;
  statusHistory: IHistorialEstado[];
  shippingAddress: IDireccionEnvio;
  payment: IInfoPago;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Sub-schemas ──────────────────────────────────────────────────────────────

const direccionEnvioSchema = new Schema<IDireccionEnvio>({
  departamento: { type: String, required: true },
  provincia: { type: String, required: true },
  distrito: { type: String, required: true },
  direccion: { type: String, required: true },
  numero: { type: String },
  pisoDpto: { type: String },
  referencia: { type: String },
}, { _id: false });

const perfilClienteSchema = new Schema<IPerfilCliente>({
  nombre: { type: String, required: true },
  apellidos: { type: String, required: true },
  email: { type: String, required: true },
  telefono: { type: String, required: true },
  tipoDocumento: { type: String, enum: Object.values(TipoDocumento), required: true },
  numeroDocumento: { type: String, required: true },
}, { _id: false });

const infoFacturacionSchema = new Schema<IInfoFacturacion>({
  type: { type: String, enum: Object.values(TipoComprobante), required: true },
  documentNumber: { type: String, required: true },
  businessName: { type: String },
  address: { type: String },
}, { _id: false });

const itemPedidoSchema = new Schema<IItemPedido>({
  productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  variantId: { type: Schema.Types.ObjectId },
  variantAttributes: { type: Map, of: String },
  quantity: { type: Number, required: true },
  price: { type: Number, required: true },
  nombre: { type: String, required: true },
  imagen: { type: String },
}, { _id: false });

const infoPagoSchema = new Schema<IInfoPago>({
  provider: { type: String, required: true },
  method: { type: String },
  gatewayOrderId: { type: String },
  transactionId: { type: String },
  paymentCode: { type: String },
  status: { type: String, enum: Object.values(EstadoPago), default: EstadoPago.PENDING },
  paidAt: { type: Date },
  gatewayData: { type: Schema.Types.Mixed },
}, { _id: false });

const historialEstadoSchema = new Schema<IHistorialEstado>({
  status: { type: String, enum: Object.values(EstadoPedido), required: true },
  changedAt: { type: Date, default: Date.now },
}, { _id: false });

// ─── Schema principal ─────────────────────────────────────────────────────────

const pedidoSchema = new Schema<IPedido>({
  orderNumber: { type: String, unique: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: false },
  customerProfile: { type: perfilClienteSchema, required: true },
  deliveryMethod: { type: String, enum: ['shipping', 'pickup'], default: 'shipping' },
  invoiceInfo: { type: infoFacturacionSchema, required: false },
  items: { type: [itemPedidoSchema], required: true },

  subtotal: { type: Number, required: true },
  igv: { type: Number, required: true },
  shippingCost: { type: Number, default: 0 },
  recargoFinanciero: { type: Number, default: 0 },
  totalPrice: { type: Number, required: true },
  currency: { type: String, default: 'PEN' },

  status: { type: String, enum: Object.values(EstadoPedido), default: EstadoPedido.AWAITING_PAYMENT },
  statusHistory: { type: [historialEstadoSchema], default: [] },
  shippingAddress: { type: direccionEnvioSchema, required: true },
  payment: { type: infoPagoSchema, required: true },
}, { timestamps: true });

// ─── Índices ──────────────────────────────────────────────────────────────────

pedidoSchema.index({ user: 1 });
pedidoSchema.index({ status: 1 });
pedidoSchema.index({ 'payment.transactionId': 1 });
pedidoSchema.index({ 'payment.gatewayOrderId': 1 });
pedidoSchema.index({ 'payment.paymentCode': 1 });

const Pedido = mongoose.model<IPedido>('Pedido', pedidoSchema);

export default Pedido;