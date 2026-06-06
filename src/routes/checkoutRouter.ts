// backend/src/routes/checkoutRouter.ts
import { Router } from 'express';
import { body } from 'express-validator';
import { PaymentsController } from '../controllers/PaymentsController';
import { authenticate } from '../middleware/auth';

const router = Router();

// ── MERCADO PAGO ─────────────────────────────────────────────────────────────
router.post('/create-preference',
    body('items').isArray().withMessage('Items must be an array'),
    body('orderId').notEmpty().withMessage('Order ID is required'),
    PaymentsController.createPreference
);

router.post('/create-preference-orderid',
    body('orderId').notEmpty().withMessage('Order ID is required'),
    PaymentsController.createPreferenceWithOrderId
);

router.post('/process-payment',
    body('formData').notEmpty().withMessage('Form data is required'),
    PaymentsController.processPayment
);

router.post('/mercadopago/yape',
    body('orderId').notEmpty().withMessage('Order ID is required'),
    PaymentsController.processPaymentYape
);

// ── IZIPAY ───────────────────────────────────────────────────────────────────
router.post('/izipay/create-payment',
    body('orderId').notEmpty().withMessage('Order ID is required'),
    PaymentsController.createPaymentIzipay
);

// ── CULQI PROCESAMIENTO DIRECTO ──────────────────────────────────────────────
router.post('/process-payment-culqi',
    // Se comenta o flexibiliza para permitir compras directas tipo 'Guest' sin token JWT mandatorio
    // authenticate, 
    body('amount').notEmpty().withMessage('Amount is required'),
    body('orderId').notEmpty().withMessage('OrderId is required'),
    body('email').isEmail().withMessage('A valid email is required'),
    PaymentsController.processPaymentCulqi
);

// ── CULQI WEBHOOK INBOUND (Registrar en el Panel) ───────────────────────────
router.post('/webhook-culqi', 
    PaymentsController.handleWebHookCulqi
);

export default router;