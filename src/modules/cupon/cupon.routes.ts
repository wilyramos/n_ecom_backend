// File: backend/src/modules/cupon/cupon.routes.ts

import { Router } from 'express';
import { cuponController } from './cupon.controller';
import {
  actualizarCuponSchema,
  crearCuponSchema,
  cuponIdSchema,
  listarCuponesSchema,
  validarCuponSchema,
} from './cupon.schema';
import { validateSchema } from '../../middleware/validate.middleware';
import { authenticate, isAdmin } from '../../middleware/auth.middleware';
import rateLimit from 'express-rate-limit';

const router = Router();

// Límite por IP para evitar probar códigos en masa (trust proxy ya está activo en server.ts)
const limitarValidacion = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, message: 'Demasiados intentos con cupones. Intenta de nuevo en unos minutos.' },
});

// ── PÚBLICO (checkout) ────────────────────────────────────────────────────────
// Va antes de /:id para que "validar" no se tome como un id
router.post('/validar', limitarValidacion, validateSchema(validarCuponSchema), cuponController.validar);

// ── PRIVADO (panel administrativo) ────────────────────────────────────────────
router.get('/', authenticate, isAdmin, validateSchema(listarCuponesSchema), cuponController.listar);
router.post('/', authenticate, isAdmin, validateSchema(crearCuponSchema), cuponController.crear);
router.get('/:id', authenticate, isAdmin, validateSchema(cuponIdSchema), cuponController.obtener);
router.put(
  '/:id',
  authenticate,
  isAdmin,
  validateSchema(actualizarCuponSchema),
  cuponController.actualizar
);
router.patch(
  '/:id/estado',
  authenticate,
  isAdmin,
  validateSchema(cuponIdSchema),
  cuponController.cambiarEstado
);
router.delete('/:id', authenticate, isAdmin, validateSchema(cuponIdSchema), cuponController.eliminar);

export default router;
