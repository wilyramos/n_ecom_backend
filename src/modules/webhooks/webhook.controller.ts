import { Request, Response } from 'express';
import { WebhookService } from './webhook.service';

export class WebhookController {
  private webhookService = new WebhookService();

  handle = async (req: Request, res: Response): Promise<void> => {
    const { provider } = req.params;
    
    try {
      // Extraer firmas de seguridad si la pasarela las envía en los headers
      const signature = (req.headers['webhook-signature'] || req.headers['x-signature'] || req.headers['culqi-signature']) as string;

      // REGLA CRÍTICA: Responder HTTP 200 rápido a la pasarela
      res.status(200).send('Webhook recibido');

      // Delegar la validación y actualización a la estrategia correspondiente vía API interna
      await this.webhookService.handleWebhook(provider, req.body, signature);
    } catch (error) {
      console.error(`💥 [Webhook Controller] Error procesando webhook de ${provider}:`, error);
    }
  };
}