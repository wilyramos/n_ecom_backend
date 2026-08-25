// File: backend/src/middleware/powerpayIpFilter.ts

import { Request, Response, NextFunction } from 'express';

// IPs oficiales de Powerpay (Green y Producción)
const POWERPAY_WHITELIST_IPS = [
    '44.194.144.33',  // Integraciones (Green)
    '54.161.123.225', // Producción
];

export const powerpayIpFilter = (req: Request, res: Response, next: NextFunction): void => {
    const provider = req.params.provider?.toLowerCase();

    // Solo se evalúa si el webhook entrante es para powerpay
    if (provider === 'powerpay') {
        const isFilterEnabled = process.env.POWERPAY_IP_FILTER_ENABLED === 'true';

        // Permite desactivarlo para pruebas locales o herramientas de simulación
        if (!isFilterEnabled) {
            return next();
        }

        // Extracción de IP real detrás de los balanceadores de Render
        const forwarded = req.headers['x-forwarded-for'];
        const clientIp = typeof forwarded === 'string'
            ? forwarded.split(',')[0].trim()
            : (req.ip || req.socket.remoteAddress || '');

        const isIpAllowed = POWERPAY_WHITELIST_IPS.some(
            (allowedIp) => clientIp.includes(allowedIp)
        );

        if (!isIpAllowed) {
            console.warn(` [Powerpay Security Render] Webhook bloqueado. IP no autorizada: ${clientIp}`);
            res.status(403).json({ success: false, message: 'Origen no autorizado' });
            return;
        }

        console.log(` [Powerpay Security Render] Webhook recibido desde IP autorizada: ${clientIp}`);
    }

    next();
};