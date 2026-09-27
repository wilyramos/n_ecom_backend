// backend/src/index.ts

import colors from 'colors';
import server from './server';
import { CronService } from './services/cron.service';

// Previene caídas por errores síncronos fuera de Express
process.on('uncaughtException', (err) => {
    console.error('ERROR SÍNCRONO NO CAPTURADO 💥:', err);
});

// Previene caídas por promesas rechazadas fuera de Express
process.on('unhandledRejection', (err) => {
    console.error('PROMESA RECHAZADA NO MANEJADA 💥:', err);
});

const port = process.env.PORT || 4000;

server.listen(port, () => {
    CronService.init();
    console.log(colors.bgMagenta.bold(`REST API in the PORT: ${port}`));
});