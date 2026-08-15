// File: backend/src/modules/webhooks/webhook.routes.ts

import { Router } from 'express';
import { WebhookController } from './webhook.controller';

const router = Router();
const webhookController = new WebhookController();

// Ruta genérica que absorbe el nombre del proveedor
// POST /api/webhooks/mercadopago
// POST /api/webhooks/culqi
router.post('/:provider', webhookController.handle);

export default router;