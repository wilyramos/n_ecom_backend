//File: backend/src/middleware/auth.ts

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import User, { IUser } from '../models/User';

// añadiendo user al Request de express
declare global {
    namespace Express {
        interface Request {
            user?: IUser
        }
    }
} // para que typescript no se queje de que no existe user en Request

export const authenticate = async (req: Request, res: Response, next: NextFunction) => {
    const bearer = req.headers.authorization // Bearer token
    if(!bearer) {
        res.status(401).json({message : 'No autorizado'})
        return
    }

    const [, token] = bearer.split(' ')
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET)
        
        if(typeof decoded === 'object' && decoded.id) {
            const user = await User.findById(decoded.id).select('-password')
            if(!user) {
                res.status(401).json({message : 'No autorizado'})
                return
            }
            req.user = user
            next()
        }
    } catch (error) {
        console.error('Error al verificar el token:', error);
        res.status(500).json({message: 'Token No Válido'})
    }
}

export const isAdmin = (req: Request, res: Response, next: NextFunction) => {
    if(req.user && req.user.rol === 'administrador') {
        next()
    } else {
        res.status(403).json({message: 'No autorizado'})
        return;
    }
}

export const isVendedor = (req: Request, res: Response, next: NextFunction) => {
    if(req.user && req.user.rol === 'vendedor') {
        next()
    } else {
        res.status(403).json({message: 'No autorizado'})
    }
}

export const isAdminOrVendedor = (req: Request, res: Response, next: NextFunction) => {
    if(req.user && (req.user.rol === 'administrador' || req.user.rol === 'vendedor')) {
        next()
    } else {
        res.status(403).json({message: 'No autorizado'})
    }
}


export const authenticateOptional = async (req: Request, res: Response, next: NextFunction) => {
    const bearer = req.headers.authorization; // Bearer token
    
    // Si no hay token, simplemente pasamos al controlador como invitado (req.user será undefined)
    if (!bearer) {
        return next();
    }

    const [, token] = bearer.split(' ');
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET as string);
        
        if (typeof decoded === 'object' && decoded.id) {
            const user = await User.findById(decoded.id).select('-password');
            if (user) {
                req.user = user; // Inyectamos el usuario si el token es válido
            }
        }
        next();
    } catch (error) {
        // Si el token expiró o es inválido, no rompemos la app, solo continuamos como invitado
        console.warn('⚠️ Token opcional inválido o expirado, procediendo como invitado.');
        next();
    }
};