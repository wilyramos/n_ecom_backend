import cron from 'node-cron';
import { PedidoService } from '../modules/pedidos/pedido.service';

export class CronService {
  private static pedidoService = new PedidoService();
  private static isRunningPowerpay = false;
  private static isRunningGlobal = false;
  private static isRunningPurge = false;

  static init(): void {
    console.log('⏰ [Cron Service] Inicializando tareas programadas...');

    // 1. Cron de Powerpay: Cada 30 minutos (0 y 30)
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

    // 2. Cron Global (24h): Todos los días a las 3:00 AM (Hora Perú)
    cron.schedule('0 3 * * *', async () => {
      if (CronService.isRunningGlobal) {
        console.warn('⚠️ [Cron Service] La limpieza global de 24h ya está en ejecución.');
        return;
      }
      CronService.isRunningGlobal = true;
      try {
        console.log('🧹 [Cron Service] Iniciando expiración de órdenes pendientes (>24h)...');
        await CronService.pedidoService.expirarOrdenesPendientesGlobal();
      } catch (error) {
        console.error('💥 [Cron Error] Fallo al expirar órdenes globales de 24h:', error);
      } finally {
        CronService.isRunningGlobal = false;
      }
    }, {
      timezone: 'America/Lima',
    });

    // 3. Cron Purga: Cada 15 días (días 1 y 16) a las 5:00 AM (Hora Perú)
    cron.schedule('0 5 1,16 * *', async () => {
      if (CronService.isRunningPurge) {
        console.warn('⚠️ [Cron Service] La purga de órdenes canceladas ya está en ejecución.');
        return;
      }
      CronService.isRunningPurge = true;
      try {
        console.log('🧹 [Cron Service] Ejecutando purga quincenal de órdenes canceladas (>1 mes)...');
        await CronService.pedidoService.purgarOrdenesCanceladasAntiguas();
      } catch (error) {
        console.error('💥 [Cron Error] Fallo al purgar órdenes canceladas antiguas:', error);
      } finally {
        CronService.isRunningPurge = false;
      }
    }, {
      timezone: 'America/Lima',
    });

    console.log('✅ [Cron Service] Cron Powerpay (30m), Global (03:00 AM) y Purga Canceladas (Día 1 y 16, 05:00 AM) configurados.');
  }
}