// File: backend/src/routes/checkoutRouter.ts  (VERSIÓN ACTUALIZADA)
import { Router } from 'express';
import { body } from 'express-validator';
import { PaymentsController } from '../controllers/PaymentsController';
import { MercadoPagoController } from '../controllers/MercadoPagoController';
import { handleInputErrors } from '../middleware/validation';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// CULQI
// ─────────────────────────────────────────────────────────────────────────────

router.post('/process-payment-culqi',
    body('amount').notEmpty().withMessage('Amount is required'),
    body('orderId').notEmpty().withMessage('OrderId is required'),
    body('email').isEmail().withMessage('A valid email is required'),
    handleInputErrors,
    PaymentsController.processPaymentCulqi
);

router.post('/webhook-culqi',
    PaymentsController.handleWebHookCulqi
);

// ─────────────────────────────────────────────────────────────────────────────
// MERCADOPAGO
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Crea una preferencia de pago en MercadoPago.
 * El frontend llama a este endpoint y recibe el init_point para redirigir al usuario.
 */
router.post('/create-preference-mp',
    body('orderId').notEmpty().withMessage('orderId es obligatorio'),
    handleInputErrors,
    MercadoPagoController.createPreference
);

/**
 * Webhook de MercadoPago.
 * IMPORTANTE: Registrar esta URL en el panel de MercadoPago (Tus integraciones > Webhooks).
 * URL ejemplo: https://tu-dominio.com/api/checkout/webhook-mp
 */
router.post('/webhook-mp',
    MercadoPagoController.handleWebhook
);

export default router;