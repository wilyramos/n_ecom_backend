import { z } from 'zod'

export const ticketItemSchema = z.object({
  descripcion: z.string().min(1, 'La descripción es obligatoria'),
  unidadMedida: z.string().default('NIU'),
  cantidad: z.coerce.number().min(1),
  precioUnitario: z.coerce.number().min(0),
  total: z.coerce.number().min(0),
})

export const convertirTicketSchema = z.object({
  body: z.object({
    filename: z.string().optional(),
    tipoComprobante: z.string().optional(),
    numeroNota: z.string().min(1, 'El número de comprobante es requerido'),
    empresa: z.string().optional().default(''),
    rucEmpresa: z.string().optional().default(''),
    telefonoEmpresa: z.string().optional().default(''),
    direccionEmpresa: z.string().optional().default(''),
    cliente: z.string().min(1, 'El nombre del cliente es requerido'),
    documentoCliente: z.string().optional().default(''),
    telefonoCliente: z.string().optional().default(''),
    direccionCliente: z.string().optional().default(''),
    fecha: z.string().optional().default(''),
    hora: z.string().optional().default(''),
    cajero: z.string().optional().default(''),
    caja: z.string().optional().default(''),
    items: z.array(ticketItemSchema).min(1, 'Debe contener al menos un producto'),
    subtotal: z.coerce.number().optional().default(0),
    igv: z.coerce.number().optional().default(0),
    monto: z.coerce.number().min(0),
  }),
})