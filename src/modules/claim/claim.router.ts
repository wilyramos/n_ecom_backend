// File: backend/src/modules/claim/claim.router.ts

import { Router } from 'express';
import { body, param } from 'express-validator';
import { ClaimController } from './claim.controller';
import { handleInputErrors } from '../../middleware/validation';
import { authenticate, isAdminOrVendedor } from '../../middleware/auth';

const router = Router();
const claimController = new ClaimController();

/** * RUTAS PÚBLICAS (sin autenticación)
 */

// Registrar un nuevo reclamo
router.post('/',
    body('nombres')
        .trim().notEmpty().withMessage('El nombre completo es obligatorio.')
        .isLength({ max: 150 }).withMessage('El nombre no puede superar 150 caracteres.'),
    body('tipoDocumento')
        .notEmpty().withMessage('El tipo de documento es obligatorio.')
        .isIn(['DNI', 'CE', 'RUC']).withMessage('El tipo de documento debe ser DNI, CE o RUC.'),
    body('numeroDocumento')
        .trim().notEmpty().withMessage('El número de documento es obligatorio.')
        .isAlphanumeric().withMessage('Solo letras y números.')
        .isLength({ min: 8, max: 15 }).withMessage('Debe tener entre 8 y 15 caracteres.'),
    body('celular')
        .trim().notEmpty().withMessage('El celular es obligatorio.')
        .isMobilePhone('any').withMessage('Formato de celular no válido.'),
    body('email')
        .trim().notEmpty().withMessage('El correo es obligatorio.')
        .isEmail().withMessage('Formato de correo no válido.')
        .normalizeEmail(),
    body('direccion')
        .trim().notEmpty().withMessage('La dirección es obligatoria.')
        .isLength({ max: 250 }).withMessage('Máximo 250 caracteres.'),
    body('ciudad')
        .trim().notEmpty().withMessage('La ciudad es obligatoria.')
        .isLength({ max: 100 }).withMessage('Máximo 100 caracteres.'),
    body('region')
        .trim().notEmpty().withMessage('La región es obligatoria.')
        .isLength({ max: 100 }).withMessage('Máximo 100 caracteres.'),
    body('tipoReclamo')
        .notEmpty().withMessage('El tipo de reclamo es obligatorio.')
        .isIn(['Queja', 'Reclamo']).withMessage('Debe ser Queja o Reclamo.'),
    body('fechaIncidencia')
        .notEmpty().withMessage('La fecha de incidencia es obligatoria.')
        .isISO8601().withMessage('Formato de fecha inválido (YYYY-MM-DD).')
        .toDate(),
    body('detalle')
        .trim().notEmpty().withMessage('El detalle del reclamo es obligatorio.')
        .isLength({ min: 20, max: 2000 }).withMessage('Entre 20 y 2000 caracteres.'),
    body('pedido')
        .trim().notEmpty().withMessage('El pedido es obligatorio.')
        .isLength({ max: 200 }).withMessage('Máximo 200 caracteres.'),
    handleInputErrors,
    (req, res, next) => claimController.create(req, res, next)
);

// Consultar estado de un reclamo por correlativo (acceso del reclamante)
router.get('/track/:correlativo',
    param('correlativo')
        .trim().notEmpty().withMessage('El correlativo es obligatorio.')
        .matches(/^R-\d{4}-\d{5}$/).withMessage('Formato inválido. Ejemplo: R-2026-00001.'),
    handleInputErrors,
    (req, res, next) => claimController.getByCorrelativo(req, res, next)
);

/** * RUTAS DE ADMINISTRACIÓN (solo admin / vendedor)
 */

// Obtener todos los reclamos
router.get('/',
    authenticate,
    isAdminOrVendedor,
    (req, res, next) => claimController.getAll(req, res, next)
);

// Actualizar estado de resolución de un reclamo
router.patch('/:correlativo/resolution',
    authenticate,
    isAdminOrVendedor,
    param('correlativo')
        .trim().notEmpty().withMessage('El correlativo es obligatorio.')
        .matches(/^R-\d{4}-\d{5}$/).withMessage('Formato inválido. Ejemplo: R-2026-00001.'),
    body('estado')
        .notEmpty().withMessage('El estado es obligatorio.')
        .isIn(['Pendiente', 'En Proceso', 'Resuelto']).withMessage('Estado no permitido.'),
    body('respuestaProveedor')
        .optional().trim()
        .isLength({ max: 2000 }).withMessage('Máximo 2000 caracteres.'),
    handleInputErrors,
    (req, res, next) => claimController.updateResolution(req, res, next)
);

export default router;