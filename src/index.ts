// File: backend/src/index.ts

import colors from 'colors';
import server from './server';
import { CronService } from './services/cron.service';

const port = process.env.PORT || 4000;

server.listen(port, () => {
    // Inicializar el cron de expiración de órdenes Powerpay
    CronService.init();
    console.log(colors.bgMagenta.bold(`REST API in the PORT: ${port}`));
});