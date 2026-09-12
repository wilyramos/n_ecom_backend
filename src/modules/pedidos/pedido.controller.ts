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
      // Extraemos los parameters3DS si existen
      const { orderNumber, culqiToken, parameters3DS } = req.body;
      const resultado = await this.pedidoService.procesarCargoCulqi(orderNumber, culqiToken, parameters3DS);

      res.status(200).json({
        success: true,
        message: 'Pago con Culqi procesado exitosamente',
        data: resultado,
      });
    } catch (error: any) {
      const statusCode = error.statusCode || 500;
      res.status(statusCode).json({
        success: false,
        message: error.message || 'Error interno al procesar el pago'
      });
    }
  };
  obtenerPedidoPorId = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const userId = req.user?._id?.toString();
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
   * Devuelve las compras del usuario logueado (incluye las compras como invitado con el mismo correo)
   */
  obtenerMisPedidos = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?._id?.toString();
      const userEmail = req.user?.email;

      if (!userId || !userEmail) {
        res.status(401).json({ success: false, message: 'Usuario no autenticado' });
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
      const emailOrDoc = req.query.emailOrDoc as string | undefined;

      let pedido;
      if (emailOrDoc) {
        pedido = await this.pedidoService.consultarTrackingPublico(orderNumber, emailOrDoc);
      } else {
        pedido = await this.pedidoService.obtenerPedidoPorNumero(orderNumber);
      }

      res.status(200).json({
        success: true,
        data: pedido,
      });
    } catch (error: any) {
      const statusCode = error.statusCode || 404;
      res.status(statusCode).json({
        success: false,
        message: error.message || 'No se encontró el pedido solicitado',
      });
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