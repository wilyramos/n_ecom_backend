// File: backend/src/modules/pedidos/pedido.controller.ts

import { Request, Response, NextFunction } from 'express';
import { PedidoService } from './pedido.service';
import { EstadoPedido } from './pedido.model';
import { IPedidoQueryParams } from './pedido.interfaces';

export class PedidoController {
  private pedidoService: PedidoService;

  constructor() {
    this.pedidoService = new PedidoService();
  }

  crearPedido = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?._id?.toString() || req.user?.id;
      const resultado = await this.pedidoService.crearPedido(req.body, userId);

      res.status(201).json({
        success: true,
        message: 'Pedido creado exitosamente',
        data: resultado,
      });
    } catch (error) {
      next(error);
    }
  };

  procesarCargoCulqi = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { orderNumber, culqiToken, parameters3DS, deviceFingerPrintId, installments } = req.body;
      const resultado = await this.pedidoService.procesarCargoCulqi(
        orderNumber,
        culqiToken,
        parameters3DS,
        deviceFingerPrintId,
        installments
      );

      res.status(200).json({
        success: true,
        data: resultado,
      });
    } catch (error: any) {
      const statusCode = error.statusCode || 400;
      res.status(statusCode).json({
        success: false,
        message: error.message || 'Error al procesar el cargo con Culqi.',
      });
    }
  };

  cancelarPedidoManual = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { orderNumber } = req.params;
      await this.pedidoService.cancelarPedidoAbordado(orderNumber);

      res.status(200).json({
        success: true,
        message: 'Pedido cancelado, stock liberado exitosamente.',
      });
    } catch (error) {
      next(error);
    }
  };

  obtenerPedidoPorId = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const userId = req.user?._id?.toString() || req.user?.id;
      const userEmail = req.user?.email;
      const isAdmin = req.user?.rol === 'administrador' || req.user?.rol === 'vendedor';

      const pedido = await this.pedidoService.obtenerPedidoPorId(id, userId, userEmail, isAdmin);

      res.status(200).json({
        success: true,
        data: pedido,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Consulta pública de tracking o éxito:
   * Acepta en `identifier` tanto `codigoPedido` (ej: "10015") como `orderNumber` largo (ej: "260924...").
   */
  obtenerPedidoPorNumero = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { identifier } = req.params;
      const emailOrDoc = req.query.emailOrDoc as string | undefined;

      let pedido;
      if (emailOrDoc) {
        pedido = await this.pedidoService.consultarTrackingPublico(identifier, emailOrDoc);
      } else {
        pedido = await this.pedidoService.obtenerPedidoPorNumero(identifier);
      }

      res.status(200).json({
        success: true,
        data: pedido,
      });
    } catch (error: any) {
      const statusCode = error.statusCode || 404;
      res.status(statusCode).json({
        success: false,
        message: error.message || 'No se encontró el pedido solicitado.',
      });
    }
  };

  obtenerMisPedidos = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?._id?.toString() || req.user?.id;
      const userEmail = req.user?.email;

      if (!userId || !userEmail) {
        res.status(401).json({
          success: false,
          message: 'Usuario no autenticado o sesión expirada.',
        });
        return;
      }

      const pedidos = await this.pedidoService.obtenerMisPedidosCliente(userId, userEmail);

      res.status(200).json({
        success: true,
        data: pedidos,
      });
    } catch (error) {
      next(error);
    }
  };

  obtenerPedidos = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const {
        page,
        limit,
        status,
        paymentStatus,
        userId,
        paymentProvider,
        deliveryMethod,
        dateFrom,
        dateTo,
        search,
      } = req.query;

      const params: IPedidoQueryParams = {
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
        status: status as EstadoPedido,
        paymentStatus: paymentStatus as string,
        userId: userId as string,
        paymentProvider: paymentProvider as string,
        deliveryMethod: deliveryMethod as string,
        dateFrom: dateFrom as string,
        dateTo: dateTo as string,
        search: search as string,
      };

      const resultado = await this.pedidoService.obtenerPedidos(params);

      res.status(200).json({
        success: true,
        ...resultado,
      });
    } catch (error) {
      next(error);
    }
  };

  obtenerEstadisticas = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const estadisticas = await this.pedidoService.obtenerEstadisticasPedidos();

      res.status(200).json({
        success: true,
        data: estadisticas,
      });
    } catch (error) {
      next(error);
    }
  };

 actualizarEstadoPedido = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const { status } = req.body;
      
      // Capturamos el ID del administrador/vendedor desde el token
      const adminId = req.user?._id?.toString() || req.user?.id;

      // Se lo enviamos al servicio
      const pedidoActualizado = await this.pedidoService.actualizarEstadoPedido(id, status as EstadoPedido, adminId);

      res.status(200).json({
        success: true,
        message: 'Estado del pedido actualizado exitosamente.',
        data: pedidoActualizado,
      });
    } catch (error) {
      next(error);
    }
  };
}