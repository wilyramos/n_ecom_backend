// File: backend/src/modules/webhooks/webhook.controller.ts

import { Request, Response } from 'express';
import { WebhookService } from './webhook.service';

export class WebhookController {
    private webhookService: WebhookService;

    constructor() {
        this.webhookService = new WebhookService();
    }

    handle = (req: Request, res: Response): void => {
        const provider = req.params.provider; // Extraído de la URL (e.g. /api/webhooks/culqi)
        const payload = req.body as Record<string, unknown>;
        
        // Extraemos las firmas de los headers comunes
        const signature = (
            req.headers['x-signature'] || 
            req.headers['vads-signature'] || 
            req.headers['izipay-signature']
        ) as string | undefined;

        // 🚀 REGLA DE ORO: Responder 200 OK inmediatamente al proveedor para evitar retries infinitos
        res.status(200).send('OK');

        // Delegar el trabajo a la estrategia en background
        this.webhookService.handleWebhook(provider, payload, signature).catch((err) => {
            console.error(`💥 [Webhook Controller] Error en background procesando ${provider}:`, err);
        });
    }
}