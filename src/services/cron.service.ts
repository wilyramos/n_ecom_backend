// File: backend/src/services/cron.service.ts

import cron from 'node-cron';
import { PedidoService } from '../modules/pedidos/pedido.service';

export class CronService {
  private static pedidoService = new PedidoService();
  private static isRunning = false;

  static init(): void {
    console.log('⏰ [Cron Service] Inicializando tareas programadas...');

    // Ejecutar cada 30 minutos en el minuto 0 y 30 ('*/30 * * * *')
    cron.schedule('*/30 * * * *', async () => {
      if (CronService.isRunning) {
        console.warn('⚠️ [Cron Service] La tarea anterior aún está en ejecución. Omitiendo ciclo.');
        return;
      }

      CronService.isRunning = true;
      try {
        await CronService.pedidoService.expirarOrdenesPendientesPowerpay();
      } catch (error) {
        console.error('💥 [Cron Error] Fallo al procesar la expiración de órdenes:', error);
      } finally {
        CronService.isRunning = false;
      }
    });

    console.log('✅ [Cron Service] Tarea de expiración Powerpay configurada cada 30 minutos.');
  }
}