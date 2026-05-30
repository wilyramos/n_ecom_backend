import mongoose, { Schema, Document } from 'mongoose';

export type UserRole = 'cliente' | 'administrador' | 'vendedor';

export interface IUser extends Document {
    nombre: string;
    apellidos?: string;
    tipoDocumento?: 'DNI' | 'RUC' | 'CE';
    numeroDocumento?: string;
    email: string;
    password?: string;
    telefono?: string;
    rol?: UserRole;
    googleId?: string; // Para autenticación con Google
    // Nuevos campos para Soft Delete (Opcionales para no romper código existente)
    isActive?: boolean;
    deletedAt?: Date | null;
}

const userSchema = new Schema<IUser>({
    nombre: { type: String, required: true },
    apellidos: { type: String, required: false },
    tipoDocumento: { type: String, enum: ['DNI', 'RUC', 'CE'], required: false },
    numeroDocumento: { type: String, required: false },
    email: { type: String, required: true, unique: true, lowercase: true},
    password: { type: String, select: false },
    telefono: { type: String, required: false },
    rol: {
        type: String,
        enum: ['cliente', 'administrador', 'vendedor'],
        default: 'cliente'
    },
    googleId: { type: String, required: false, unique: true, sparse: true }, // <- sparse evita conflictos si es null
    
    // ==========================================
    // NUEVOS CAMPOS CONFIGURADOS SEGUROS
    // ==========================================
    isActive: { 
        type: Boolean, 
        required: true, 
        default: true 
    },
    deletedAt: { 
        type: Date, 
        required: false, 
        default: null 
    }
}, { 
    timestamps: true // timestamps agrega automáticamente createdAt y updatedAt
});

// ==========================================
// ÍNDICES CRÍTICOS PARA PRODUCCIÓN
// ==========================================
// Optimiza el rendimiento de getAllUsers y getAllClients que filtran por rol
userSchema.index({ rol: 1, createdAt: -1 });

// Permite buscar por documento eficientemente si se usa en los filtros
userSchema.index({ numeroDocumento: 1 }, { sparse: true });

const User = mongoose.model<IUser>("User", userSchema);
export default User;