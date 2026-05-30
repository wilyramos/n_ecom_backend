import { Types } from 'mongoose';
import User, { IUser, UserRole } from '../../models/User';
import { AppError } from '../../utils/AppError';
import { checkPassword, hashPassword } from '../../utils/auth';

interface IGetUsersQuery {
    page?: number;
    limit?: number;
    nombre?: string;
    email?: string;
    telefono?: string;
    numeroDocumento?: string;
}

interface IPaginatedUsersResponse {
    totalUsers: number;
    currentPage: number;
    totalPages: number;
    users: IUser[];
}

export class UsersService {

    static async getAllActive(query: IGetUsersQuery): Promise<IPaginatedUsersResponse> {
        const page = Math.max(1, query.page || 1);
        const limit = Math.min(100, Math.max(1, query.limit || 25));
        const skip = (page - 1) * limit;

        // Forzar que solo traiga usuarios activos (no eliminados lógicamente)
        const searchConditions: any = {
            isActive: true,
            deletedAt: null
        };

        if (query.nombre) {
            searchConditions.nombre = { $regex: new RegExp(query.nombre, 'i') };
        }

        if (query.email) {
            searchConditions.email = { $regex: new RegExp(query.email, 'i') };
        }

        if (query.telefono) {
            searchConditions.telefono = { $regex: new RegExp(query.telefono, 'i') };
        }

        if (query.numeroDocumento) {
            searchConditions.numeroDocumento = { $regex: new RegExp(query.numeroDocumento, 'i') };
        }

        const [totalUsers, users] = await Promise.all([
            User.countDocuments(searchConditions),
            User.find(searchConditions)
                .skip(skip)
                .limit(limit)
                .select('-password')
                .sort({ createdAt: -1 })
                .lean()
        ]);

        return {
            totalUsers,
            currentPage: page,
            totalPages: Math.ceil(totalUsers / limit),
            users: users as IUser[]
        };
    }

    static async findActiveById(id: string): Promise<IUser> {
        if (!Types.ObjectId.isValid(id)) {
            throw new AppError('El formato del ID de usuario es inválido', 400);
        }

        const user = await User.findOne({ _id: id, isActive: true, deletedAt: null })
            .select('-password')
            .lean();

        if (!user) {
            throw new AppError('Usuario no encontrado o dado de baja', 404);
        }

        return user as IUser;
    }

    static async createClientByStaff(data: Partial<IUser>): Promise<IUser> {
        const emailLower = data.email?.toLowerCase();

        const activeUserExists = await User.findOne({ email: emailLower, isActive: true });
        if (activeUserExists) {
            throw new AppError('El correo electrónico ya se encuentra registrado y activo', 400);
        }

        const newUser = new User({
            ...data,
            rol: 'cliente',
            isActive: true,
            deletedAt: null
        });

        await newUser.save();
        return await User.findById(newUser._id).select('-password').lean() as IUser;
    }

    static async updateProfile(id: string, updateData: Partial<IUser>): Promise<IUser> {
        if (updateData.email) {
            const emailExists = await User.findOne({
                email: updateData.email.toLowerCase(),
                _id: { $ne: id },
                isActive: true
            });
            if (emailExists) {
                throw new AppError('El correo electrónico ya pertenece a otro usuario activo', 400);
            }
        }

        delete updateData.rol;
        delete updateData.password;
        delete updateData.googleId;
        delete updateData.isActive;
        delete updateData.deletedAt;

        const updatedUser = await User.findOneAndUpdate(
            { _id: id, isActive: true },
            { $set: updateData },
            { new: true, runValidators: true }
        ).select('-password');

        if (!updatedUser) {
            throw new AppError('Usuario no encontrado o inactivo', 404);
        }

        return updatedUser;
    }

    static async updateRole(id: string, newRole: UserRole): Promise<IUser> {
        if (!Types.ObjectId.isValid(id)) {
            throw new AppError('El formato del ID de usuario es inválido', 400);
        }

        const updatedUser = await User.findOneAndUpdate(
            { _id: id, isActive: true },
            { $set: { rol: newRole } },
            { new: true, runValidators: true }
        ).select('-password');

        if (!updatedUser) {
            throw new AppError('Usuario no encontrado, inactivo o ID inválido', 404);
        }

        return updatedUser;
    }

    static async softDeleteUser(id: string): Promise<void> {
        if (!Types.ObjectId.isValid(id)) {
            throw new AppError('El formato del ID de usuario es inválido', 400);
        }

        const result = await User.updateOne(
            { _id: id, isActive: true },
            {
                $set: {
                    isActive: false,
                    deletedAt: new Date()
                }
            }
        );

        if (result.modifiedCount === 0) {
            throw new AppError('Usuario no encontrado, ID inválido o ya eliminado', 404);
        }
    }

    static async updatePassword(id: string, currentPassword: string, newPassword: string): Promise<void> {
        // Necesitamos traer explícitamente el password que está oculto por defecto (select: false)
        const user = await User.findOne({ _id: id, isActive: true }).select('+password');

        if (!user) {
            throw new AppError('Usuario no encontrado o inactivo', 404);
        }

        // Si el usuario se registró únicamente con Google, podría no tener password
        if (user.password) {
            const isPasswordValid = await checkPassword(currentPassword, user.password);
            if (!isPasswordValid) {
                throw new AppError('La contraseña actual es incorrecta', 400);
            }
        }

        // Hashear e inyectar la nueva clave
        user.password = await hashPassword(newPassword);
        await user.save();
    }
}