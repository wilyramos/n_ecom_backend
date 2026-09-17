// File: backend/src/modules/reports/reports.schema.ts

import { z } from 'zod';

// Quitamos el .datetime() para permitir fechas YYYY-MM-DD estándar
export const obtenerEstadisticasSchema = z.object({
  query: z.object({
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
  }),
});

export const obtenerReporteAvanzadoSchema = z.object({
  query: z.object({
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
    groupBy: z.enum(['daily', 'monthly', 'yearly']).default('daily'),
    status: z.string().optional(),
    paymentStatus: z.string().optional(),
  }),
});