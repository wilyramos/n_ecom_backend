import { Schema, model, Document } from 'mongoose';

export type AdLayoutType = 'top_bar' | 'modal_popup';

export interface IAdvertisement extends Document {
    title: string;          // Nombre identificador interno o título del aviso
    subtitle?: string;      // Texto secundario o descripción corta
    imageUrl?: string;      // Imagen (Obligatoria para modal_popup, opcional para top_bar)
    linkTo?: string;        // Ruta de redirección (ej: "/shop/ofertas")
    layout: AdLayoutType;   // Formato de renderizado
    isActive: boolean;      // Control de encendido/apagado manual
    startDate?: Date;       // Programación: Cuándo empieza a mostrarse
    endDate?: Date;         // Programación: Cuándo expira automáticamente
    createdAt: Date;
    updatedAt: Date;
}

const AdvertisementSchema = new Schema<IAdvertisement>({
    title: { type: String, required: true, trim: true },
    subtitle: { type: String, trim: true },
    imageUrl: { type: String },
    linkTo: { type: String, trim: true },
    layout: {
        type: String,
        required: true,
        enum: ['top_bar', 'modal_popup'],
        default: 'top_bar'
    },
    isActive: { type: Boolean, default: true },
    startDate: { type: Date },
    endDate: { type: Date }
}, { timestamps: true });

// Índice para recuperar de forma instantánea el aviso vigente y activo
AdvertisementSchema.index({ isActive: 1, layout: 1, startDate: 1, endDate: 1 });

export const Advertisement = model<IAdvertisement>('Advertisement', AdvertisementSchema);