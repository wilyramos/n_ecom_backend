import { Router } from 'express';
import { WebhookController } from './webhook.controller';
import { powerpayIpFilter } from '../../middleware/powerpayIpFilter';

const router = Router();
const webhookController = new WebhookController();

// 1. Ruta específica para Powerpay (con filtro de IP restrictivo)
router.post('/powerpay', powerpayIpFilter, webhookController.handle);

// 2. Ruta general para el resto de pasarelas (Culqi, MercadoPago, etc.)
router.post('/:provider', webhookController.handle);

export default router;