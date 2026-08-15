import { Types } from 'mongoose';
import { EstadoPedido, EstadoPago, TipoDocumento, TipoComprobante } from './pedido.model';

export type MetodoEntrega = 'shipping' | 'pickup';

// ─── Interfaces del Modelo ───────────────────────────────────────────────────

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
  gatewayData?: Record<string, unknown>; // 🚀 Tipado seguro, reemplaza al "any"
}

export interface IHistorialEstado {
  status: EstadoPedido;
  changedAt: Date;
}

// ─── Interfaces de Parámetros y Respuestas API ───────────────────────────────

export interface IPedidoQueryParams {
  page?: number;
  limit?: number;
  status?: EstadoPedido | string;
  userId?: string;
  paymentProvider?: string;
  deliveryMethod?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
}

export interface IPaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface IRespuestaPedidosPaginados<T> {
  data: T[];
  pagination: IPaginationMeta;
}

export interface IRespuestaCrearPedido<T> {
  pedido: T;
  initPoint?: string | null;
  culqiOrderId?: string | null; // 🚀 Necesario para enviar el ID a PagoEfectivo / Cuotéalo
}

export interface IEstadisticasPedidos {
  totalRecaudado: number;
  totalApprovedOrders: number;
  pendientesCount: number;
  enProcesoCount: number;
  enviadosCount: number;
  entregadosCount: number;
  canceladosCount: number;
}