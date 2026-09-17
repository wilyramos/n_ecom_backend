// File: backend/src/modules/reports/reports.routes.ts

import { Router } from 'express';
import { ReportsController } from './reports.controller';
import { authenticate, isAdminOrVendedor } from '../../middleware/auth';
import { validateSchema } from '../../middleware/validate.middleware';
import { obtenerEstadisticasSchema, obtenerReporteAvanzadoSchema } from './reports.schema';

const router = Router();
const reportsController = new ReportsController();

// Métricas básicas para KPI topbar
router.get(
    '/pedidos',
    authenticate,
    isAdminOrVendedor,
    validateSchema(obtenerEstadisticasSchema),
    reportsController.obtenerEstadisticasPedidos
);

// Métricas avanzadas para gráficas (NUEVO)
router.get(
    '/pedidos/avanzado',
    authenticate,
    isAdminOrVendedor,
    validateSchema(obtenerReporteAvanzadoSchema),
    reportsController.obtenerReportesAvanzados
);

export default router;