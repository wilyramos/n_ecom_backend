// File: backend/src/modules/cupon/cupon.controller.ts

import { Request, Response, NextFunction } from 'express';
import { cuponService } from './cupon.service';
import { verificarPreciosContraBD } from '../pedidos/pedido-precios';

export class CuponController {
  // ── PÚBLICO (checkout) ────────────────────────────────────────────────────

  validar = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // El descuento se calcula con los precios reales de BD, igual que al crear el pedido
      await verificarPreciosContraBD(req.body.items);
      const resultado = await cuponService.calcularDescuento({
        codigo: req.body.codigo,
        email: req.body.email,
        items: req.body.items,
      });
      res.status(200).json({ success: true, data: resultado });
    } catch (error) {
      next(error);
    }
  };

  // ── ADMIN ─────────────────────────────────────────────────────────────────

  listar = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // En Express 5 req.query llega como string: se parsea aquí (el schema ya lo validó)
      const estado = req.query.estado === 'activo' || req.query.estado === 'inactivo' ? req.query.estado : undefined;
      const result = await cuponService.listar({
        page: Math.max(Number(req.query.page) || 1, 1),
        limit: Math.min(Math.max(Number(req.query.limit) || 10, 1), 100),
        search: typeof req.query.search === 'string' && req.query.search.trim() ? req.query.search.trim() : undefined,
        estado,
      });
      res.status(200).json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  };

  obtener = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const cupon = await cuponService.obtenerPorId(req.params.id as string);
      res.status(200).json({ success: true, data: cupon });
    } catch (error) {
      next(error);
    }
  };

  crear = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const cupon = await cuponService.crear(req.body);
      res.status(201).json({ success: true, data: cupon, message: 'Cupón creado correctamente' });
    } catch (error) {
      next(error);
    }
  };

  actualizar = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const cupon = await cuponService.actualizar(req.params.id as string, req.body);
      res.status(200).json({ success: true, data: cupon, message: 'Cupón actualizado correctamente' });
    } catch (error) {
      next(error);
    }
  };

  cambiarEstado = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const cupon = await cuponService.cambiarEstado(req.params.id as string);
      res.status(200).json({ success: true, data: cupon });
    } catch (error) {
      next(error);
    }
  };

  eliminar = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await cuponService.eliminar(req.params.id as string);
      res.status(200).json({ success: true, message: 'Cupón eliminado correctamente' });
    } catch (error) {
      next(error);
    }
  };
}

export const cuponController = new CuponController();
