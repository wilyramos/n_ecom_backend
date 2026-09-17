// File: backend/src/modules/reports/reports.controller.ts

import { Request, Response, NextFunction } from 'express';
import { ReportsService } from './reports.service';

export class ReportsController {
  private reportsService: ReportsService;

  constructor() {
    this.reportsService = new ReportsService();
  }

  // Básicas - KPI Cards
  obtenerEstadisticasPedidos = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { dateFrom, dateTo } = req.query;

      const estadisticas = await this.reportsService.obtenerEstadisticasPedidos({
        dateFrom: dateFrom as string,
        dateTo: dateTo as string,
      });

      res.status(200).json({
        success: true,
        data: estadisticas,
      });
    } catch (error) {
      next(error);
    }
  };

  // Avanzadas - Gráficas
  obtenerReportesAvanzados = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { dateFrom, dateTo, groupBy, status, paymentStatus } = req.query;

      const reportes = await this.reportsService.obtenerReportesAvanzados({
        dateFrom: dateFrom as string,
        dateTo: dateTo as string,
        groupBy: (groupBy as 'daily' | 'monthly' | 'yearly') || 'daily',
        status: status as string,
        paymentStatus: paymentStatus as string,
      });

      res.status(200).json({
        success: true,
        data: reportes,
      });
    } catch (error) {
      next(error);
    }
  };
}