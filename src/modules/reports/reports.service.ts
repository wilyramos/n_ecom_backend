// File: backend/src/modules/reports/reports.service.ts

import Pedido, { EstadoPedido, EstadoPago, IPedido } from '../pedidos/pedido.model';
import { 
  IEstadisticasPedidos, 
  StatsAggregationResult, 
  IReporteQueryFilters, 
  IReporteAvanzadoFiltros,
  IReporteAvanzadoResponse
} from './reports.interfaces';
import { FilterQuery } from 'mongoose';

export class ReportsService {
  private construirFiltroFechasBase(filtros: IReporteQueryFilters): FilterQuery<IPedido> {
    const matchFiltros: FilterQuery<IPedido> = {};
    
    if (filtros.dateFrom || filtros.dateTo) {
      matchFiltros.createdAt = {};
      
      if (filtros.dateFrom) {
        // Inicio del día
        matchFiltros.createdAt.$gte = new Date(`${filtros.dateFrom}T00:00:00.000Z`);
      }
      
      if (filtros.dateTo) {
        // Fin del día (23:59:59) para asegurar que tome los pedidos de ese mismo día
        matchFiltros.createdAt.$lte = new Date(`${filtros.dateTo}T23:59:59.999Z`);
      }
    }
    
    return matchFiltros;
  }

  // Mantiene las métricas básicas para la parte superior del panel
  async obtenerEstadisticasPedidos(filtros: IReporteQueryFilters = {}): Promise<IEstadisticasPedidos> {
    const matchFiltros = this.construirFiltroFechasBase(filtros);

    const result = await Pedido.aggregate<StatsAggregationResult>([
      { $match: matchFiltros },
      {
        $facet: {
          ventasAprobadas: [
            {
              $match: {
                'payment.status': EstadoPago.APPROVED,
                status: { $ne: EstadoPedido.CANCELED },
              },
            },
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

    return {
      totalRecaudado: Number(ventasData.montoTotal.toFixed(2)),
      totalApprovedOrders: ventasData.conteoAprobados,
      pendientesCount: getCountByStatus(EstadoPedido.AWAITING_PAYMENT) + getCountByStatus(EstadoPedido.PROCESSING),
      enProcesoCount: getCountByStatus(EstadoPedido.PROCESSING),
      enviadosCount: getCountByStatus(EstadoPedido.SHIPPED),
      entregadosCount: getCountByStatus(EstadoPedido.DELIVERED),
      canceladosCount: getCountByStatus(EstadoPedido.CANCELED),
    };
  }

  // Nuevas métricas avanzadas para gráficas
  async obtenerReportesAvanzados(filtros: IReporteAvanzadoFiltros = {}): Promise<IReporteAvanzadoResponse> {
    const baseMatch = this.construirFiltroFechasBase(filtros);

    if (filtros.status && filtros.status !== 'all') {
      baseMatch.status = filtros.status;
    } else {
      baseMatch.status = { $ne: EstadoPedido.CANCELED };
    }

    if (filtros.paymentStatus && filtros.paymentStatus !== 'all') {
      baseMatch['payment.status'] = filtros.paymentStatus;
    } else {
      baseMatch['payment.status'] = EstadoPago.APPROVED;
    }

    let dateFormato = '%Y-%m-%d';
    if (filtros.groupBy === 'monthly') dateFormato = '%Y-%m';
    if (filtros.groupBy === 'yearly') dateFormato = '%Y';

    const [
      ventasEnElTiempo,
      ventasPorMetodoPago,
      ventasPorMetodoEnvio,
      productosMasVendidos
    ] = await Promise.all([
      // 1. Tendencia de ventas
      Pedido.aggregate([
        { $match: baseMatch },
        {
          $group: {
            _id: { $dateToString: { format: dateFormato, date: '$createdAt', timezone: 'America/Lima' } },
            totalRecaudado: { $sum: '$totalPrice' },
            cantidadPedidos: { $sum: 1 }
          }
        },
        { $sort: { _id: 1 } },
        {
          $project: {
            periodo: '$_id',
            totalRecaudado: { $round: ['$totalRecaudado', 2] },
            cantidadPedidos: 1,
            _id: 0
          }
        }
      ]),

      // 2. Por Método de Pago
      Pedido.aggregate([
        { $match: baseMatch },
        {
          $group: {
            _id: '$payment.provider',
            totalRecaudado: { $sum: '$totalPrice' },
            cantidad: { $sum: 1 }
          }
        },
        { $project: { _id: 1, totalRecaudado: { $round: ['$totalRecaudado', 2] }, cantidad: 1 } }
      ]),

      // 3. Por Método de Envío
      Pedido.aggregate([
        { $match: baseMatch },
        {
          $group: {
            _id: '$deliveryMethod',
            totalRecaudado: { $sum: '$totalPrice' },
            cantidad: { $sum: 1 }
          }
        },
        { $project: { _id: 1, totalRecaudado: { $round: ['$totalRecaudado', 2] }, cantidad: 1 } }
      ]),

      // 4. Top Productos
      Pedido.aggregate([
        { $match: baseMatch },
        { $unwind: '$items' },
        {
          $group: {
            _id: '$items.productId',
            nombre: { $first: '$items.nombre' },
            cantidadVendida: { $sum: '$items.quantity' },
            ingresosGenerados: { 
              $sum: { $multiply: ['$items.price', '$items.quantity'] } 
            }
          }
        },
        { $sort: { cantidadVendida: -1 } },
        { $limit: 10 },
        {
          $project: {
            productoId: '$_id',
            nombre: 1,
            cantidadVendida: 1,
            ingresosGenerados: { $round: ['$ingresosGenerados', 2] },
            _id: 0
          }
        }
      ])
    ]);

    return { ventasEnElTiempo, ventasPorMetodoPago, ventasPorMetodoEnvio, productosMasVendidos };
  }
}