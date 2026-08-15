import { Request, Response, NextFunction } from 'express';
import { PedidoService } from './pedido.service';
import { EstadoPedido } from './pedido.model';

export class PedidoController {
  private pedidoService: PedidoService;

  constructor() {
    this.pedidoService = new PedidoService();
  }

  crearPedido = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?._id?.toString();
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
      const { orderNumber, culqiToken } = req.body;
      const resultado = await this.pedidoService.procesarCargoCulqi(orderNumber, culqiToken);

      res.status(200).json({
        success: true,
        message: 'Pago con Culqi procesado exitosamente',
        data: resultado,
      });
    } catch (error) {
      next(error);
    }
  };

  obtenerPedidoPorId = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const pedido = await this.pedidoService.obtenerPedidoPorId(id);

      res.status(200).json({
        success: true,
        data: pedido,
      });
    } catch (error) {
      next(error);
    }
  };

  obtenerPedidos = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { page, limit, status, userId, paymentProvider, deliveryMethod, dateFrom, dateTo, search } = req.query;

      const resultado = await this.pedidoService.obtenerPedidos({
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
        status: status as EstadoPedido,
        userId: userId as string,
        paymentProvider: paymentProvider as string,
        deliveryMethod: deliveryMethod as string,
        dateFrom: dateFrom as string,
        dateTo: dateTo as string,
        search: search as string,
      });

      res.status(200).json({
        success: true,
        ...resultado,
      });
    } catch (error) {
      next(error);
    }
  };

  actualizarEstadoPedido = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const { status } = req.body;

      const pedidoActualizado = await this.pedidoService.actualizarEstadoPedido(id, status as EstadoPedido);

      res.status(200).json({
        success: true,
        message: 'Estado del pedido actualizado exitosamente',
        data: pedidoActualizado,
      });
    } catch (error) {
      next(error);
    }
  };

  obtenerPedidoPorNumero = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { orderNumber } = req.params;
      const pedido = await this.pedidoService.obtenerPedidoPorNumero(orderNumber);

      res.status(200).json({
        success: true,
        data: pedido,
      });
    } catch (error) {
      next(error);
    }
  };

  obtenerEstadisticas = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
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
}