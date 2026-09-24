// File: backend/src/models/User.ts

import mongoose, { Schema, Document } from 'mongoose';

export type UserRole = 'cliente' | 'administrador' | 'vendedor' | 'colaborador';
export type UserTipoDocumento = 'DNI' | 'RUC' | 'CE' | 'PASAPORTE';

export interface IUser extends Document {
    nombre: string;
    apellidos?: string;
    tipoDocumento?: UserTipoDocumento;
    numeroDocumento?: string;
    email: string;
    password?: string;
    telefono?: string;
    rol?: UserRole;
    googleId?: string;
    isActive?: boolean;
    deletedAt?: Date | null;
}

const userSchema = new Schema<IUser>(
    {
        nombre: { type: String, required: true },
        apellidos: { type: String, required: false },
        tipoDocumento: {
            type: String,
            enum: ['DNI', 'RUC', 'CE', 'PASAPORTE'],
            required: false,
        },
        numeroDocumento: { type: String, required: false },
        email: { type: String, required: true, unique: true, lowercase: true, trim: true },
        password: { type: String, select: false },
        telefono: { type: String, required: false },
        rol: {
            type: String,
            enum: ['cliente', 'administrador', 'vendedor', 'colaborador'],
            default: 'cliente',
        },
        googleId: { type: String, required: false, unique: true, sparse: true },
        isActive: {
            type: Boolean,
            required: true,
            default: true,
        },
        deletedAt: {
            type: Date,
            required: false,
            default: null,
        },
    },
    {
        timestamps: true,
    }
);

userSchema.index({ rol: 1, createdAt: -1 });
userSchema.index({ rol: 1, isActive: 1 });
userSchema.index({ numeroDocumento: 1 }, { sparse: true });

const User = mongoose.model<IUser>('User', userSchema);
export default User;