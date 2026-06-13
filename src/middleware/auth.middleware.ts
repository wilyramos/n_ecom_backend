// File: backend/src/middleware/auth.middleware.ts

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import User, { IUser } from '../models/User';

// ─────────────────────────────────────────────────────────────
// AUGMENTACIÓN DE TIPOS — extiende el Request de Express
// ─────────────────────────────────────────────────────────────

declare global {
    namespace Express {
        interface Request {
            user?: IUser;
        }
    }
}

// ─────────────────────────────────────────────────────────────
// TIPOS
// ─────────────────────────────────────────────────────────────

// Se añade 'colaborador' al tipo Role local del middleware
type Role = 'administrador' | 'vendedor' | 'cliente' | 'colaborador';

// ─────────────────────────────────────────────────────────────
// HELPERS PRIVADOS
// ─────────────────────────────────────────────────────────────

const unauthorized = (res: Response, message = 'No autorizado') => {
    res.status(401).json({ success: false, message });
};

const forbidden = (res: Response, message = 'Acceso denegado') => {
    res.status(403).json({ success: false, message });
};

const extractToken = (authHeader: string | undefined): string | null => {
    if (!authHeader?.startsWith('Bearer ')) return null;
    const token = authHeader.split(' ')[1];
    return token?.trim() || null;
};

// ─────────────────────────────────────────────────────────────
// AUTENTICACIÓN
// ─────────────────────────────────────────────────────────────

/**
 * Verifica el JWT del header Authorization.
 * Adjunta el usuario autenticado en req.user.
 */
export const authenticate = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    const token = extractToken(req.headers.authorization);

    if (!token) {
        unauthorized(res);
        return;
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET as string);

        if (typeof decoded !== 'object' || !decoded?.id) {
            unauthorized(res, 'Token inválido');
            return;
        }

        const user = await User.findById(decoded.id).select('-password');

        if (!user) {
            unauthorized(res, 'Usuario no encontrado');
            return;
        }

        req.user = user;
        next();
    } catch (error) {
        if (error instanceof jwt.TokenExpiredError) {
            unauthorized(res, 'Token expirado');
            return;
        }
        if (error instanceof jwt.JsonWebTokenError) {
            unauthorized(res, 'Token inválido');
            return;
        }
        next(error);
    }
};

// ─────────────────────────────────────────────────────────────
// AUTORIZACIÓN — helpers de roles
// ─────────────────────────────────────────────────────────────

/**
 * Factory genérica — genera un middleware que permite
 * uno o más roles. Úsala para crear los middlewares específicos
 * o directamente en las rutas.
 */
export const authorizeRoles = (...roles: Role[]) =>
    (req: Request, res: Response, next: NextFunction): void => {
        if (!req.user) {
            unauthorized(res);
            return;
        }
        if (!roles.includes(req.user.rol as Role)) {
            forbidden(res);
            return;
        }
        next();
    };

// ─────────────────────────────────────────────────────────────
// MIDDLEWARES ESPECÍFICOS — listos para usar en las rutas
// ─────────────────────────────────────────────────────────────

/** Solo administradores */
export const isAdmin = authorizeRoles('administrador');

/** Solo vendedores */
export const isVendedor = authorizeRoles('vendedor');

/** Solo colaboradores */
export const isColaborador = authorizeRoles('colaborador');

/** Administradores y vendedores */
export const isAdminOrVendedor = authorizeRoles('administrador', 'vendedor');

/** Cualquier rol con acceso a la plataforma interna (CMS / Marcaje) */
export const isInternalStaff = authorizeRoles('administrador', 'vendedor', 'colaborador');

/** Cualquier usuario autenticado con rol válido */
export const isAnyRole = authorizeRoles('administrador', 'vendedor', 'cliente', 'colaborador');

// ─────────────────────────────────────────────────────────────
// SHORTHAND — authenticate + autorización en un solo array
// ─────────────────────────────────────────────────────────────

export const authorizeAdmin         = [authenticate, isAdmin];
export const authorizeVendedor      = [authenticate, isVendedor];
export const authorizeColaborador   = [authenticate, isColaborador];
export const authorizeInternalStaff = [authenticate, isInternalStaff];
export const authorizeAdminOrVendedor = [authenticate, isAdminOrVendedor];