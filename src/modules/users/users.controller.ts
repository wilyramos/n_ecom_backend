//File: backend/src/modules/users/users.controller.ts

import { Request, Response, NextFunction } from 'express';
import { UsersService } from './users.service';
import { UserRole } from '../../models/User';

export class UsersController {

    static async getAllUsers(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 25;
            const nombre = req.query.nombre as string;
            const email = req.query.email as string;
            const telefono = req.query.telefono as string;
            const numeroDocumento = req.query.numeroDocumento as string;

            const result = await UsersService.getAllActive({
                page,
                limit,
                nombre,
                email,
                telefono,
                numeroDocumento
            });

            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }

    static async getUserById(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { id } = req.params;
            const user = await UsersService.findActiveById(id);
            res.status(200).json(user);
        } catch (error) {
            next(error);
        }
    }

    static async createClient(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const client = await UsersService.createClientByStaff(req.body);
            res.status(201).json({
                message: 'Cliente registrado con éxito',
                userId: client.id
            });
        } catch (error) {
            next(error);
        }
    }

    static async updateMyProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user.id;
            const updatedUser = await UsersService.updateProfile(userId, req.body);
            res.status(200).json({
                message: 'Perfil actualizado correctamente',
                user: updatedUser
            });
        } catch (error) {
            next(error);
        }
    }

    static async changeUserRole(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { id } = req.params;
            const { rol } = req.body as { rol: UserRole };
            const updatedUser = await UsersService.updateRole(id, rol);

            res.status(200).json({
                message: 'Rol de usuario actualizado correctamente',
                user: updatedUser
            });
        } catch (error) {
            next(error);
        }
    }

    static async removeUser(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { id } = req.params;
            await UsersService.softDeleteUser(id);
            res.status(200).json({ message: 'Usuario eliminado lógicamente de forma correcta' });
        } catch (error) {
            next(error);
        }
    }

    static async changeMyPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user!.id;
            const { currentPassword, newPassword } = req.body;

            await UsersService.updatePassword(userId, currentPassword, newPassword);

            res.status(200).json({
                message: 'Contraseña actualizada correctamente'
            });
        } catch (error) {
            next(error);
        }
    }

    // backend/src/modules/users/users.controller.ts

static async updateUserById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const { id } = req.params; // <--- ID del usuario a editar recibido por URL
        const updatedUser = await UsersService.updateProfile(id, req.body);
        res.status(200).json({
            message: 'Usuario actualizado correctamente',
            user: updatedUser
        });
    } catch (error) {
        next(error);
    }
}
}