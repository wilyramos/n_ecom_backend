// File: backend/src/modules/attendance/attendance.routes.ts

import { Router } from 'express';
import { attendanceController } from './attendance.controller';
import { authenticate, isAdmin, isInternalStaff } from '../../middleware/auth.middleware';

const router = Router();

// Garantiza la autenticación por token en todo el módulo
router.use(authenticate);

// ── FLUIDO DE ASISTENCIA INTERNA (Colaboradores, Vendedores, Admins) ─────────
// Bloquea el acceso a clientes externos utilizando el rol del staff interno
router.post('/check-in', isInternalStaff, attendanceController.checkIn);
router.post('/check-out', isInternalStaff, attendanceController.checkOut);
router.get('/my-history', isInternalStaff, attendanceController.getMyHistory);

// ── RUTA EXCLUSIVA PARA EL CMS DE ADMINISTRACIÓN ─────────────────────────────
// Solo accesible para usuarios con rol 'administrador'
router.get('/admin/report', isAdmin, attendanceController.getAllForAdmin);

export default router;