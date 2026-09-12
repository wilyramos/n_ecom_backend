import cron from 'node-cron';
import { PedidoService } from '../modules/pedidos/pedido.service';

export class CronService {
  private static pedidoService = new PedidoService();
  private static isRunningPowerpay = false;
  private static isRunningGlobal = false;

  static init(): void {
    console.log('⏰ [Cron Service] Inicializando tareas programadas...');

    // 1. Cron de Powerpay: Ejecutar cada 30 minutos (0 y 30)
    cron.schedule('*/30 * * * *', async () => {
      if (CronService.isRunningPowerpay) return;
      CronService.isRunningPowerpay = true;
      try {
        await CronService.pedidoService.expirarOrdenesPendientesPowerpay();
      } catch (error) {
        console.error('💥 [Cron Error] Fallo al expirar órdenes de Powerpay:', error);
      } finally {
        CronService.isRunningPowerpay = false;
      }
    });

    // 2. Cron Global (24h): Ejecutar todos los días a las 3:00 AM (Hora Perú GMT-5)
    cron.schedule('0 3 * * *', async () => {
      if (CronService.isRunningGlobal) {
        console.warn('⚠️ [Cron Service] La limpieza global de 24h ya está en ejecución.');
        return;
      }
      CronService.isRunningGlobal = true;
      try {
        console.log('🧹 [Cron Service] Iniciando limpieza nocturna de órdenes expiradas (>24h)...');
        await CronService.pedidoService.expirarOrdenesPendientesGlobal();
      } catch (error) {
        console.error('💥 [Cron Error] Fallo al expirar órdenes globales de 24h:', error);
      } finally {
        CronService.isRunningGlobal = false;
      }
    }, {
      timezone: "America/Lima" // Se eliminó scheduled: true para respetar el tipado estricto
    });

    console.log('✅ [Cron Service] Cron Powerpay (30min) y Cron Global (03:00 AM Perú) configurados.');
  }
}