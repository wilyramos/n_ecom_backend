// File: backend/src/modules/webhooks/webhook.routes.ts

import { Router } from 'express';
import { WebhookController } from './webhook.controller';
import { powerpayIpFilter } from '../../middleware/powerpayIpFilter';

const router = Router();
const webhookController = new WebhookController();

// POST /api/webhooks/:provider
router.post('/:provider', powerpayIpFilter, webhookController.handle);

export default router;