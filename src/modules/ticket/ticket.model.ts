// backend/src/modules/ticket/ticket.model.ts
import { Schema, model } from 'mongoose'

const ticketItemSchema = new Schema({
  descripcion: { type: String, required: true },
  unidadMedida: { type: String, default: 'NIU' },
  cantidad: { type: Number, required: true, default: 1 },
  precioUnitario: { type: Number, required: true },
  total: { type: Number, required: true },
})

const ticketSchema = new Schema(
  {
    tipoComprobante: { type: String, default: 'NOTA DE VENTA' }, // NOTA DE VENTA o BOLETA ELECTRÓNICA
    numeroNota: { type: String, required: true },
    empresa: { type: String },
    rucEmpresa: { type: String },
    telefonoEmpresa: { type: String },
    direccionEmpresa: { type: String },
    cliente: { type: String, required: true },
    documentoCliente: { type: String },
    telefonoCliente: { type: String },
    direccionCliente: { type: String },
    fecha: { type: String },
    hora: { type: String },
    cajero: { type: String },
    caja: { type: String },
    items: [ticketItemSchema],
    subtotal: { type: Number },
    igv: { type: Number },
    monto: { type: Number, required: true },
    fechaDigitalizacion: { type: Date, default: Date.now },
  },
  { timestamps: true }
)

export const TicketModel = model('Ticket', ticketSchema)