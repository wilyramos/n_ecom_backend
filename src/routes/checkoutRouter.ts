// File: backend/src/routes/checkoutRouter.ts
import { Router } from 'express';
import { body } from 'express-validator';
import { PaymentsController } from '../controllers/PaymentsController';
import { handleInputErrors } from '../middleware/validation';

const router = Router();

// ── CULQI PROCESAMIENTO DIRECTO ──────────────────────────────────────────────
router.post('/process-payment-culqi',
    body('amount').notEmpty().withMessage('Amount is required'),
    body('orderId').notEmpty().withMessage('OrderId is required'),
    body('email').isEmail().withMessage('A valid email is required'),
    handleInputErrors,
    PaymentsController.processPaymentCulqi
);

// ── CULQI WEBHOOK INBOUND ───────────────────────────────────────────────────
router.post('/webhook-culqi', 
    PaymentsController.handleWebHookCulqi
);

export default router;