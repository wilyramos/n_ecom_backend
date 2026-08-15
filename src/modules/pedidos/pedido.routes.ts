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

// POST /api/pedidos - Crear pedido inicial (awaiting_payment)
router.post(
  '/',
  authenticateOptional,
  validateSchema(crearPedidoSchema),
  pedidoController.crearPedido
);

// POST /api/pedidos/culqi-charge - Procesar cobro directo en Culqi con Token
router.post('/culqi-charge', authenticateOptional, pedidoController.procesarCargoCulqi);

// GET /api/pedidos/stats - Obtener métricas de recaudación (Debe ir ANTES de /:id)
router.get('/stats', authenticate, isAdminOrVendedor, pedidoController.obtenerEstadisticas);

// GET /api/pedidos/tracking/:orderNumber - Consulta pública por número de orden
router.get('/tracking/:orderNumber', pedidoController.obtenerPedidoPorNumero);

// GET /api/pedidos - Listar pedidos (Admin o Vendedor)
router.get('/', authenticate, isAdminOrVendedor, pedidoController.obtenerPedidos);

// GET /api/pedidos/:id - Obtener pedido por ID
router.get('/:id', authenticateOptional, validateSchema(obtenerPedidoPorIdSchema), pedidoController.obtenerPedidoPorId);

// PATCH /api/pedidos/:id/status - Actualizar estado logístico
router.patch('/:id/status', authenticate, isAdminOrVendedor, validateSchema(actualizarEstadoPedidoSchema), pedidoController.actualizarEstadoPedido);

export default router;