// File: backend/src/services/cron.service.ts

import cron from 'node-cron';
import { PedidoService } from '../modules/pedidos/pedido.service';

export class CronService {
    private static pedidoService = new PedidoService();

    static init(): void {
        console.log('⏰ [Cron Service] Inicializando tareas programadas...');

        // Ejecutar cada 10 minutos: '*/10 * * * *'
        cron.schedule('*/10 * * * *', async () => {
            try {
                await CronService.pedidoService.expirarOrdenesPendientesPowerpay();
            } catch (error) {
                console.error('💥 [Cron Error] Fallo al expirar órdenes:', error);
            }
        });

        console.log('✅ [Cron Service] Tarea de expiración Powerpay activa (cada 10 min).');
    }
}