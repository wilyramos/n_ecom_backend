// File: backend/src/modules/reports/reports.interfaces.ts

import { EstadoPedido, EstadoPago } from '../pedidos/pedido.model';

export interface IEstadisticasPedidos {
    totalRecaudado: number;
    totalApprovedOrders: number;
    pendientesCount: number;
    enProcesoCount: number;
    enviadosCount: number;
    entregadosCount: number;
    canceladosCount: number;
}

export interface StatsAggregationResult {
    ventasAprobadas: Array<{ montoTotal: number; conteoAprobados: number }>;
    estadosOperativos: Array<{ _id: string; count: number }>;
}

export interface IReporteQueryFilters {
    dateFrom?: string;
    dateTo?: string;
    status?: EstadoPedido | string;
    paymentStatus?: EstadoPago | string;
}

export interface IReporteAvanzadoFiltros extends IReporteQueryFilters {
    groupBy?: 'daily' | 'monthly' | 'yearly';
}

export interface IVentasPorPeriodo {
    periodo: string;
    totalRecaudado: number;
    cantidadPedidos: number;
}

export interface IMetricasPorAgrupacion {
    _id: string;
    totalRecaudado: number;
    cantidad: number;
}

export interface ITopProducto {
    productoId: string;
    nombre: string;
    cantidadVendida: number;
    ingresosGenerados: number;
}

export interface IReporteAvanzadoResponse {
    ventasEnElTiempo: IVentasPorPeriodo[];
    ventasPorMetodoPago: IMetricasPorAgrupacion[];
    ventasPorMetodoEnvio: IMetricasPorAgrupacion[];
    productosMasVendidos: ITopProducto[];
}