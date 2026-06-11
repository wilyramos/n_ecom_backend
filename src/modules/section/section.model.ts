// File: backend/src/modules/section/section.model.ts

import { Schema, model, Document, Types } from 'mongoose';

export type SectionType = 'featured_collections' | 'product_grid' | 'rich_text';

export interface ISectionBlock {
    title?: string;
    subtitle?: string;
    imageUrl?: string;
    linkTo?: string;            // Ruta interna en Next.js 15 (ej: "/category/electronica")
    productId?: Types.ObjectId; // Referencia directa para 'product_grid'
}

export interface ISection extends Document {
    title: string;              // Nombre administrativo interno (ej: "Categorías Populares Verano")
    slug: string;               // Key única para Next.js (ej: "home-categories-grid")
    type: SectionType;
    order: number;
    isActive: boolean;
    settings: {
        bodyText?: string;        // Usado en 'rich_text' para descripciones largas o HTML
        gridColumns?: number;     // Control estructural en Next.js (ej: 2, 3, 4 columnas)
    };
    blocks: ISectionBlock[];
    createdAt: Date;
    updatedAt: Date;
}

const SectionSchema = new Schema<ISection>({
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
    type: {
        type: String,
        required: true,
        enum: ['featured_collections', 'product_grid', 'rich_text']
    },
    order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    settings: {
        bodyText: { type: String },
        gridColumns: { type: Number, default: 4 }
    },
    blocks: {
        type: [{
            title: { type: String, trim: true },
            subtitle: { type: String, trim: true },
            imageUrl: { type: String },
            linkTo: { type: String },
            productId: { type: Schema.Types.ObjectId, ref: 'Product' }
        }],
        validate: {
            validator: function (val: ISectionBlock[]) {
                return val.length <= 8;
            },
            message: 'La sección estructural excede el límite máximo de 8 bloques de contenido.'
        }
    }
}, { timestamps: true });

// Índice compuesto para optimizar las consultas del Home de manera instantánea
SectionSchema.index({ isActive: 1, order: 1 });

export const Section = model<ISection>('Section', SectionSchema);