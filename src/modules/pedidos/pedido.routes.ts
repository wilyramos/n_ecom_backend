//File: backend/src/modules/pedidos/pedido.routes.ts

import { Router } from 'express';
import { PedidoController } from './pedido.controller';
import { validateSchema } from '../../middleware/validate.middleware';
import { authenticate, authenticateOptional, isAdminOrVendedor } from '../../middleware/auth';
import {
  crearPedidoSchema,
  obtenerPedidoPorIdSchema,
  actualizarEstadoPedidoSchema,
} from './pedido.schema';

const router = Router();
const pedidoController = new PedidoController();

// Crear pedido (logueado o invitado)
router.post(
  '/',
  authenticateOptional,
  validateSchema(crearPedidoSchema),
  pedidoController.crearPedido
);

// Procesar cobro directo Culqi con token
router.post('/culqi-charge', authenticateOptional, pedidoController.procesarCargoCulqi);

// Mis pedidos del cliente logueado (incluye históricos por email)
router.get('/mis-pedidos', authenticate, pedidoController.obtenerMisPedidos);

// Métricas para panel admin
router.get('/stats', authenticate, isAdminOrVendedor, pedidoController.obtenerEstadisticas);

// Consulta por número de orden / tracking público
router.get('/tracking/:orderNumber', pedidoController.obtenerPedidoPorNumero);

// Listar todos los pedidos (Admin o Vendedor)
router.get('/', authenticate, isAdminOrVendedor, pedidoController.obtenerPedidos);

// Obtener pedido por ID
router.get('/:id', authenticateOptional, validateSchema(obtenerPedidoPorIdSchema), pedidoController.obtenerPedidoPorId);

// Actualizar estado logístico (Admin o Vendedor)
router.patch(
  '/:id/status',
  authenticate,
  isAdminOrVendedor,
  validateSchema(actualizarEstadoPedidoSchema),
  pedidoController.actualizarEstadoPedido
);

export default router;