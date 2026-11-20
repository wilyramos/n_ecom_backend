// File: backend/src/modules/cupon/cupon.schema.ts

import { z } from 'zod';
import { AplicaACupon, TipoCupon } from './cupon.model';

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

const objectIdList = z
  .array(z.string().regex(objectIdRegex, { message: 'ID no válido' }))
  .default([]);

const fechaOpcional = z
  .string()
  .trim()
  .optional()
  .nullable()
  .refine((v) => !v || !Number.isNaN(new Date(v).getTime()), { message: 'Fecha no válida' });

const usoOpcional = z.number().int().positive({ message: 'Debe ser mayor a 0' }).nullable().optional();

const cuponBase = z.object({
  codigo: z
    .string()
    .trim()
    .min(3, { message: 'El código debe tener al menos 3 caracteres' })
    .max(30, { message: 'El código no puede superar 30 caracteres' })
    .regex(/^[A-Za-z0-9_-]+$/, { message: 'Solo letras, números, guion y guion bajo' })
    .transform((v) => v.toUpperCase()),
  descripcion: z.string().trim().max(200).optional(),
  tipo: z.enum(Object.values(TipoCupon) as [string, ...string[]], {
    message: 'Tipo de cupón no válido',
  }),
  valor: z.number().positive({ message: 'El valor debe ser mayor a 0' }),
  montoMinimo: z.number().nonnegative({ message: 'El monto mínimo no puede ser negativo' }).default(0),
  aplicaA: z
    .enum(Object.values(AplicaACupon) as [string, ...string[]], { message: 'Alcance no válido' })
    .default(AplicaACupon.TODOS),
  categorias: objectIdList,
  productos: objectIdList,
  usosMaximos: usoOpcional,
  usosPorCliente: usoOpcional,
  fechaInicio: fechaOpcional,
  fechaFin: fechaOpcional,
  activo: z.boolean().default(true),
});

/** Reglas cruzadas: porcentaje ≤ 100, alcance con su lista, y fechas coherentes */
const reglasCupon = (data: z.infer<typeof cuponBase>, ctx: z.RefinementCtx) => {
  if (data.tipo === TipoCupon.PORCENTAJE && data.valor > 100) {
    ctx.addIssue({ code: 'custom', path: ['valor'], message: 'El porcentaje no puede superar 100' });
  }
  if (data.aplicaA === AplicaACupon.CATEGORIAS && data.categorias.length === 0) {
    ctx.addIssue({ code: 'custom', path: ['categorias'], message: 'Selecciona al menos una categoría' });
  }
  if (data.aplicaA === AplicaACupon.PRODUCTOS && data.productos.length === 0) {
    ctx.addIssue({ code: 'custom', path: ['productos'], message: 'Selecciona al menos un producto' });
  }
  if (data.fechaInicio && data.fechaFin && new Date(data.fechaFin) < new Date(data.fechaInicio)) {
    ctx.addIssue({
      code: 'custom',
      path: ['fechaFin'],
      message: 'La fecha de fin debe ser posterior a la de inicio',
    });
  }
};

export const crearCuponSchema = z.object({
  body: cuponBase.superRefine(reglasCupon),
});

export const actualizarCuponSchema = z.object({
  params: z.object({ id: z.string().regex(objectIdRegex, { message: 'ID no válido' }) }),
  body: cuponBase.partial().superRefine((data, ctx) => {
    // En actualización solo se validan las reglas cruzadas si llegan los campos implicados
    if (data.tipo === TipoCupon.PORCENTAJE && data.valor !== undefined && data.valor > 100) {
      ctx.addIssue({ code: 'custom', path: ['valor'], message: 'El porcentaje no puede superar 100' });
    }
    if (data.fechaInicio && data.fechaFin && new Date(data.fechaFin) < new Date(data.fechaInicio)) {
      ctx.addIssue({
        code: 'custom',
        path: ['fechaFin'],
        message: 'La fecha de fin debe ser posterior a la de inicio',
      });
    }
  }),
});

export const cuponIdSchema = z.object({
  params: z.object({ id: z.string().regex(objectIdRegex, { message: 'ID no válido' }) }),
});

export const listarCuponesSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(10),
    search: z.string().trim().optional(),
    estado: z.enum(['activo', 'inactivo']).optional(),
  }),
});

export const validarCuponSchema = z.object({
  body: z.object({
    codigo: z.string().trim().min(1, { message: 'Ingresa el código del cupón' }),
    email: z.string().trim().optional(),
    items: z
      .array(
        z.object({
          productId: z.string().regex(objectIdRegex, { message: 'ID de producto no válido' }),
          quantity: z.number().int().positive(),
          price: z.number().nonnegative(),
        })
      )
      .min(1, { message: 'El carrito está vacío' }),
  }),
});

export type CrearCuponInput = z.infer<typeof crearCuponSchema>['body'];
export type ActualizarCuponInput = z.infer<typeof actualizarCuponSchema>['body'];
export type ValidarCuponInput = z.infer<typeof validarCuponSchema>['body'];
