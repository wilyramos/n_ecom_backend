// File: backend/src/modules/claim/claim.model.ts
import mongoose, { Schema, Document } from 'mongoose';

export type ClaimDocumentType = 'DNI' | 'CE' | 'RUC';
export type ClaimType = 'Queja' | 'Reclamo';
export type ClaimStatus = 'Pendiente' | 'En Proceso' | 'Resuelto';

export interface IClaimConsumer {
    nombres: string;
    tipoDocumento: ClaimDocumentType;
    numeroDocumento: string;
    celular: string;
    email: string;
    direccion: string;
    ciudad: string;
    region: string;
}

export interface IClaimDetail {
    tipoReclamo: ClaimType;
    fechaIncidencia: Date;
    detalle: string;
    pedido: string;
}

export interface IClaimAdminResolution {
    estado: ClaimStatus;
    respuestaProveedor?: string;
    fechaRespuesta?: Date;
}

export interface IClaim extends Document {
    correlativo: string;
    consumer: IClaimConsumer;
    detail: IClaimDetail;
    resolution: IClaimAdminResolution;
    createdAt: Date;
    updatedAt: Date;
}

const claimSchema = new Schema<IClaim>(
    {
        correlativo: {
            type: String,
            required: true,
            unique: true,
            trim: true
        },
        consumer: {
            nombres: { type: String, required: true, trim: true },
            tipoDocumento: { type: String, required: true, enum: ['DNI', 'CE', 'RUC'] },
            numeroDocumento: { type: String, required: true, trim: true },
            celular: { type: String, required: true, trim: true },
            email: { type: String, required: true, trim: true, lowercase: true },
            direccion: { type: String, required: true, trim: true },
            ciudad: { type: String, required: true, trim: true },
            region: { type: String, required: true, trim: true }
        },
        detail: {
            tipoReclamo: { type: String, required: true, enum: ['Queja', 'Reclamo'] },
            fechaIncidencia: { type: Date, required: true },
            detalle: { type: String, required: true, trim: true },
            pedido: { type: String, required: true, trim: true }
        },
        resolution: {
            estado: { type: String, enum: ['Pendiente', 'En Proceso', 'Resuelto'], default: 'Pendiente' },
            respuestaProveedor: { type: String, trim: true, default: '' },
            fechaRespuesta: { type: Date }
        }
    },
    { timestamps: true }
);

claimSchema.index({ correlativo: 1 }, { unique: true });
claimSchema.index({ 'consumer.email': 1 });
claimSchema.index({ 'consumer.numeroDocumento': 1 });
claimSchema.index({ 'resolution.estado': 1, createdAt: -1 });

export default mongoose.model<IClaim>('Claim', claimSchema);