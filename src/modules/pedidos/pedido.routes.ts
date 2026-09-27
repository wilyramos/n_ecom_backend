// File: backend/src/modules/pedidos/pedido.routes.ts

import { Router } from 'express';
import { PedidoController } from './pedido.controller';
import { validateSchema } from '../../middleware/validate.middleware';
import { authenticate, authenticateOptional, isAdminOrVendedor } from '../../middleware/auth.middleware';
import {
  crearPedidoSchema,
  obtenerPedidoPorIdSchema,
  actualizarEstadoPedidoSchema,
  procesarCargoCulqiSchema,
} from './pedido.schema';

const router = Router();
const pedidoController = new PedidoController();

// ─── 1. Endpoints estáticos de Colección y Acciones Especiales ────────────────

// Listar pedidos filtrados con paginación (Panel Admin / Vendedor)
router.get(
  '/',
  authenticate,
  isAdminOrVendedor,
  pedidoController.obtenerPedidos
);

// Crear nuevo pedido (Checkout usuario logueado o invitado)
router.post(
  '/',
  authenticateOptional,
  validateSchema(crearPedidoSchema),
  pedidoController.crearPedido
);

// Procesar cobro directo Culqi con token / 3DS
router.post(
  '/culqi-charge',
  authenticateOptional,
  validateSchema(procesarCargoCulqiSchema),
  pedidoController.procesarCargoCulqi
);

// Compras del cliente autenticado
router.get(
  '/mis-pedidos',
  authenticate,
  pedidoController.obtenerMisPedidos
);

// Métricas de ventas y estados de pedidos (Dashboard Admin)
router.get(
  '/stats',
  authenticate,
  isAdminOrVendedor,
  pedidoController.obtenerEstadisticas
);

// ─── 2. Endpoints de Búsqueda por Código o Tracking ──────────────────────────

// Tracking o verificación (recibe tanto "10015" como el "orderNumber" largo)
router.get(
  '/tracking/:identifier',
  pedidoController.obtenerPedidoPorNumero
);

// Cancelar pedido pendiente / abordado por el cliente
router.post(
  '/:orderNumber/cancel',
  authenticateOptional,
  pedidoController.cancelarPedidoManual
);

// ─── 3. Endpoints por Mongo ObjectId (_id) ───────────────────────────────────

// Obtener detalle de pedido por ObjectId
router.get(
  '/:id',
  authenticateOptional,
  validateSchema(obtenerPedidoPorIdSchema),
  pedidoController.obtenerPedidoPorId
);

// Actualizar estado logístico de un pedido (Admin / Vendedor)
router.patch(
  '/:id/status',
  authenticate,
  isAdminOrVendedor,
  validateSchema(actualizarEstadoPedidoSchema),
  pedidoController.actualizarEstadoPedido
);

export default router;