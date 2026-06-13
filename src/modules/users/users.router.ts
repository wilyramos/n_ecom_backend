import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { UsersController } from './users.controller';
import { handleInputErrors } from '../../middleware/validation';
import { authenticate, isAdmin, isAdminOrVendedor } from '../../middleware/auth';

const router = Router();

router.get('/',
    authenticate,
    isAdminOrVendedor,
    query('page').optional().isInt({ min: 1 }).withMessage('Página inválida'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Límite inválido'),
    handleInputErrors,
    UsersController.getAllUsers
);

router.post('/clients',
    authenticate,
    isAdminOrVendedor,
    body('email').isEmail().withMessage('El correo electrónico provisto no es válido'),
    body('nombre').notEmpty().withMessage('El nombre es un campo requerido'),
    body('tipoDocumento').optional().isIn(['DNI', 'RUC', 'CE']).withMessage('Tipo de documento no soportado'),
    body('numeroDocumento').optional().notEmpty().withMessage('El número de documento no puede estar vacío'),
    handleInputErrors,
    UsersController.createClient
);

router.put('/profile/update',
    authenticate,
    body('nombre').optional().notEmpty().withMessage('El nombre no puede quedar vacío'),
    body('apellidos').optional().isString(),
    body('telefono').optional().isString(),
    handleInputErrors,
    UsersController.updateMyProfile
);

router.put('/profile/change-password',
    authenticate,
    body('currentPassword').notEmpty().withMessage('La contraseña actual es requerida'),
    body('newPassword').isLength({ min: 6 }).withMessage('La nueva contraseña debe tener al menos 6 caracteres'),
    handleInputErrors,
    UsersController.changeMyPassword
);


router.get('/:id',
    authenticate,
    isAdminOrVendedor,
    param('id').isMongoId().withMessage('El formato del ID de usuario es inválido'),
    handleInputErrors,
    UsersController.getUserById
);

router.put('/:id',
    authenticate,
    isAdmin, // Solo los administradores pueden editar datos de otros usuarios
    param('id').isMongoId().withMessage('El formato del ID de usuario es inválido'),
    body('nombre').optional().notEmpty().withMessage('El nombre no puede quedar vacío'),
    body('apellidos').optional().isString(),
    body('telefono').optional().isString(),
    handleInputErrors,
    UsersController.updateUserById
);

router.put('/:id/role',
    authenticate,
    isAdmin, 
    param('id').isMongoId().withMessage('El formato del ID de usuario es inválido'),
    body('rol').isIn(['cliente', 'administrador', 'vendedor', 'colaborador']).withMessage('El rol proporcionado no es válido'),
    handleInputErrors,
    UsersController.changeUserRole
);

router.delete('/:id',
    authenticate,
    isAdmin,
    param('id').isMongoId().withMessage('El formato del ID de usuario es inválido'),
    handleInputErrors,
    UsersController.removeUser
);


export default router;