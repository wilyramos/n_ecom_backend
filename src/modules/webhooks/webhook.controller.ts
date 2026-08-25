//File: backend/src/modules/webhooks/webhook.controller.ts

import { Request, Response } from 'express';
import { WebhookService } from './webhook.service';

export class WebhookController {
    private webhookService: WebhookService;

    constructor() {
        this.webhookService = new WebhookService();
    }

    handle = (req: Request, res: Response): void => {
        const provider = req.params.provider;
        const payload = req.body as Record<string, unknown>;
        
        const signature = (
            req.headers['x-signature'] || 
            req.headers['vads-signature'] || 
            req.headers['izipay-signature']
        ) as string | undefined;

        console.log(`\n📥 [Webhook Controller] Webhook recibido para [${provider}]`);
        console.log(`🔍 [Webhook Controller] Headers:`, JSON.stringify(req.headers, null, 2));
        console.log(`📦 [Webhook Controller] Body:`, JSON.stringify(payload, null, 2));

        res.status(200).send('OK');

        this.webhookService.handleWebhook(provider, payload, signature).catch((err) => {
            console.error(`💥 [Webhook Controller] Error en background procesando ${provider}:`, err);
        });
    }
}