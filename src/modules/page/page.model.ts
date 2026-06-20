//File: backend/src/modules/page/page.model.ts

import { Schema, model, Document } from 'mongoose';

export interface IPage extends Document {
  title: string;             // Nombre visible de la página (ej: "Cambios y Devoluciones")
  slug: string;              // Ruta limpia para la URL en Next.js (ej: "cambios-y-devoluciones")
  content: string;           // Todo el HTML enriquecido generado por tu editor de texto del Admin
  isActive: boolean;         // Permite ocultar o despublicar la página temporalmente
  seo?: {
    metaTitle?: string;      // Título personalizado para Google (opcional)
    metaDescription?: string; // Descripción corta para los buscadores (opcional)
  };
  createdAt: Date;
  updatedAt: Date;
}

const PageSchema = new Schema<IPage>(
  {
    title: { 
      type: String, 
      required: true, 
      trim: true 
    },
    slug: { 
      type: String, 
      required: true, 
      unique: true, 
      trim: true, 
      lowercase: true,
      index: true // Optimiza las búsquedas por URL desde Next.js
    },
    content: { 
      type: String, 
      required: true 
    },
    isActive: { 
      type: Boolean, 
      default: true 
    },
    seo: {
      metaTitle: { type: String, trim: true },
      metaDescription: { type: String, trim: true }
    }
  },
  { 
    timestamps: true // Genera automáticamente createdAt y updatedAt
  }
);

// Índice compuesto para acelerar consultas públicas filtrando solo las activas
PageSchema.index({ slug: 1, isActive: 1 });

export const Page = model<IPage>('Page', PageSchema);