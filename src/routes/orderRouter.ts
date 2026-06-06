import { Router } from 'express';
import { body, param } from 'express-validator';
import { OrderController } from '../controllers/OrderController';
import { handleInputErrors } from '../middleware/validation';
// CAMBIO: Importar authenticateOptional
import { authenticate, authenticateOptional, isAdmin } from '../middleware/auth';
import { OrderStatus } from '../models/Order';

const router = Router();

/**
 * RUTAS PÚBLICAS / CONTROL DE RESPUESTAS CHECKOUT
 */
router.get('/number/:orderNumber',
    param('orderNumber').notEmpty().withMessage('El número de orden es obligatorio'),
    handleInputErrors,
    OrderController.getOrderByOrderNumber
);

/**
 * RUTAS PARA CLIENTES (AUTENTICADOS O INVITADOS)
 */

// CAMBIO: Inyectar el middleware opcional aquí
router.post('/',
    authenticateOptional,
    OrderController.createOrder
);

// Obtener mis órdenes (Historial del cliente)
router.get('/user/me',
    authenticate,
    OrderController.getOrdersByUser
);
// Obtener detalle de una orden por ID (Admin o Dueño de la orden)
router.get('/:id',
    param('id').isMongoId().withMessage('ID no válido'),
    handleInputErrors,
    OrderController.getOrderById
);

/** * RUTAS DE ADMINISTRACIÓN (SOLO ADMIN) 
 */

// Obtener todas las órdenes con filtros y paginación
router.get('/',
    authenticate,
    isAdmin,
    OrderController.getOrders
);

// Actualizar Estado de la Orden
// Usamos PATCH para actualizar solo el campo status e historial
router.patch('/:id/status',
    authenticate,
    isAdmin,
    param('id').isMongoId().withMessage('ID no válido'),
    body('status')
        .notEmpty().withMessage('El estado es obligatorio')
        .isIn(Object.values(OrderStatus)).withMessage('Estado de orden no permitido'),
    handleInputErrors,
    OrderController.updateOrderStatus
);

/** * REPORTES Y ANALÍTICA (SOLO ADMIN) 
 */

router.get('/reports/sales-summary',
    authenticate,
    isAdmin,
    OrderController.getSummaryOrders
);

router.get('/reports/sales-over-time',
    authenticate,
    isAdmin,
    OrderController.getOrdersOverTime
);

router.get('/reports/orders-by-status',
    authenticate,
    isAdmin,
    OrderController.getReportOrdersByStatus
);

router.get('/reports/orders-by-payment-method',
    authenticate,
    isAdmin,
    OrderController.getReportOrdersByMethodPayment
);

router.get('/reports/orders-by-city',
    authenticate,
    isAdmin,
    OrderController.getReportOrdersByCity
);

/** * DOCUMENTOS Y COMPROBANTES PDF 
 */

router.get('/:id/pdf',
    // authenticate,
    param('id').isMongoId().withMessage('ID no válido'),
    handleInputErrors,
    OrderController.generateOrderPDF
);

router.get('/:id/shipping-label',
    // authenticate,
    // isAdmin,
    param('id').isMongoId().withMessage('ID no válido'),
    handleInputErrors,
    OrderController.generateShippingLabelPDF
);

export default router;