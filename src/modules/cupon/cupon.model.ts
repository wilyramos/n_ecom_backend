// File: backend/src/modules/cupon/cupon.model.ts

import mongoose, { Schema, Document, Types } from 'mongoose';

export enum TipoCupon {
  PORCENTAJE = 'porcentaje',
  MONTO = 'monto',
}

export enum AplicaACupon {
  TODOS = 'todos',
  CATEGORIAS = 'categorias',
  PRODUCTOS = 'productos',
}

export interface ICupon extends Document {
  codigo: string;
  descripcion?: string;
  tipo: TipoCupon;
  valor: number;
  montoMinimo: number;
  aplicaA: AplicaACupon;
  categorias: Types.ObjectId[];
  productos: Types.ObjectId[];
  usosMaximos: number | null;
  usosPorCliente: number | null;
  fechaInicio: Date | null;
  fechaFin: Date | null;
  activo: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const cuponSchema = new Schema<ICupon>(
  {
    codigo: { type: String, required: true, unique: true, uppercase: true, trim: true },
    descripcion: { type: String, trim: true, maxlength: 200 },
    tipo: { type: String, enum: Object.values(TipoCupon), required: true },
    valor: { type: Number, required: true, min: 0 },
    montoMinimo: { type: Number, default: 0, min: 0 },
    aplicaA: { type: String, enum: Object.values(AplicaACupon), default: AplicaACupon.TODOS },
    categorias: [{ type: Schema.Types.ObjectId, ref: 'Category' }],
    productos: [{ type: Schema.Types.ObjectId, ref: 'Product' }],
    usosMaximos: { type: Number, default: null, min: 1 },
    usosPorCliente: { type: Number, default: null, min: 1 },
    fechaInicio: { type: Date, default: null },
    fechaFin: { type: Date, default: null },
    activo: { type: Boolean, default: true },
  },
  { timestamps: true }
);

cuponSchema.index({ activo: 1 });

const Cupon = mongoose.model<ICupon>('Cupon', cuponSchema);
export default Cupon;
