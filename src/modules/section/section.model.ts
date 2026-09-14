// File: backend/src/modules/section/section.model.ts

import { Schema, model, Document, Types } from 'mongoose';

export type SectionType = 'featured_collections' | 'product_grid' | 'rich_text';

export interface ISectionBlock {
    title?: string;
    subtitle?: string;
    imageUrl?: string;
    linkTo?: string;            
    productId?: Types.ObjectId; 
}

export interface ISection extends Document {
    title: string;              
    slug: string;               
    type: SectionType;
    order: number;
    isActive: boolean;
    settings: {
        bodyText?: string;        
        gridColumns?: number;     
        showTitle?: boolean;      // 👈 Nuevo campo añadido
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
        gridColumns: { type: Number, default: 4 },
        showTitle: { type: Boolean, default: true } // 👈 Valor por defecto en la BD
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

SectionSchema.index({ isActive: 1, order: 1 });

export const Section = model<ISection>('Section', SectionSchema);