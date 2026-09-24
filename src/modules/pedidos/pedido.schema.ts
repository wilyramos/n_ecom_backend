// File: backend/src/modules/pedidos/pedido.schema.ts

import { z } from 'zod';
import { TipoDocumento, TipoComprobante, EstadoPedido } from './pedido.model';

const objectIdRegex = /^[0-9a-fA-F]{24}$/;
const celularPeruRegex = /^9\d{8}$/;
const dniRegex = /^\d{8}$/;
const rucRegex = /^(10|20)\d{9}$/;

export const crearPedidoSchema = z.object({
  body: z.object({
    customerProfile: z.object({
      nombre: z
        .string()
        .trim()
        .min(1, { message: 'El nombre es obligatorio' })
        .min(2, { message: 'El nombre debe tener al menos 2 caracteres' }),
      apellidos: z
        .string()
        .trim()
        .min(1, { message: 'Los apellidos son obligatorios' })
        .min(2, { message: 'Los apellidos deben tener al menos 2 caracteres' }),
      email: z
        .string()
        .trim()
        .min(1, { message: 'El correo electrónico es obligatorio' })
        .email({ message: 'Email inválido' }),
      telefono: z
        .string()
        .trim()
        .min(1, { message: 'El número de celular es obligatorio' })
        .regex(celularPeruRegex, { message: 'Debe ser un celular válido de 9 dígitos que empiece con 9' }),
      tipoDocumento: z.enum(Object.values(TipoDocumento) as [string, ...string[]], {
        message: 'Tipo de documento no válido',
      }),
      numeroDocumento: z
        .string()
        .trim()
        .min(1, { message: 'El número de documento es obligatorio' }),
    }),
    receiverInfo: z
      .object({
        nombre: z.string().trim().min(2, { message: 'Nombre del receptor requerido' }),
        apellidos: z.string().trim().min(2, { message: 'Apellidos del receptor requeridos' }),
        telefono: z
          .string()
          .trim()
          .regex(celularPeruRegex, { message: 'El celular del receptor debe tener 9 dígitos y empezar con 9' }),
        tipoDocumento: z.enum(Object.values(TipoDocumento) as [string, ...string[]]).optional(),
        numeroDocumento: z.string().trim().optional(),
      })
      .optional(),
    deliveryNotes: z.string().max(300, { message: 'Las notas no pueden superar 300 caracteres' }).optional(),
    deliveryMethod: z.enum(['shipping', 'pickup']).default('shipping'),
    invoiceInfo: z
      .object({
        type: z.enum(Object.values(TipoComprobante) as [string, ...string[]]),
        documentNumber: z.string().trim().min(1, { message: 'Documento fiscal requerido' }),
        businessName: z.string().trim().optional(),
        address: z.string().trim().optional(),
      })
      .refine(
        (data) => {
          if (data.type === TipoComprobante.FACTURA && !data.documentNumber) return false;
          return true;
        },
        { message: 'El RUC es requerido para emitir Factura', path: ['documentNumber'] }
      )
      .refine(
        (data) => {
          if (data.type === TipoComprobante.FACTURA && data.documentNumber) {
            return rucRegex.test(data.documentNumber);
          }
          return true;
        },
        { message: 'El RUC debe tener 11 dígitos y empezar con 10 o 20', path: ['documentNumber'] }
      )
      .refine(
        (data) => {
          if (data.type === TipoComprobante.FACTURA && !data.businessName) return false;
          return true;
        },
        { message: 'La razón social es requerida para emitir Factura', path: ['businessName'] }
      )
      .optional(),
    shippingAddress: z.object({
      departamento: z.string().trim().min(1, { message: 'El departamento es requerido' }),
      provincia: z.string().trim().min(1, { message: 'La provincia es requerida' }),
      distrito: z.string().trim().min(1, { message: 'El distrito es requerido' }),
      direccion: z.string().trim().min(3, { message: 'La dirección es requerida' }),
      numero: z.string().trim().optional(),
      pisoDpto: z.string().trim().optional(),
      referencia: z.string().trim().optional(),
    }),
    items: z
      .array(
        z.object({
          productId: z.string().regex(objectIdRegex, { message: 'ID de producto no válido' }),
          variantId: z.string().regex(objectIdRegex, { message: 'ID de variante no válido' }).optional(),
          variantAttributes: z.record(z.string(), z.string()).optional(),
          quantity: z.number().int().positive({ message: 'La cantidad debe ser mayor a 0' }),
          price: z.number().positive({ message: 'El precio debe ser positivo' }),
          nombre: z.string().trim().min(1, { message: 'Nombre de producto requerido' }),
          imagen: z.string().optional(),
        })
      )
      .min(1, { message: 'Debe incluir al menos un producto' }),
    payment: z.object({
      provider: z.string().trim().min(1, { message: 'El proveedor de pago es requerido' }),
      method: z.string().optional(),
      gatewayOrderId: z.string().optional(),
      paymentCode: z.string().optional(),
    }),
    shippingCost: z.number().nonnegative().default(0),
    currency: z.string().default('PEN'),
  }).superRefine((body, ctx) => {
    const doc = body.customerProfile.numeroDocumento;
    if (body.customerProfile.tipoDocumento === TipoDocumento.DNI && !dniRegex.test(doc)) {
      ctx.addIssue({
        path: ['customerProfile', 'numeroDocumento'],
        message: 'El DNI debe tener exactamente 8 dígitos',
        code: z.ZodIssueCode.custom,
      });
    } else if (body.customerProfile.tipoDocumento === TipoDocumento.RUC && !rucRegex.test(doc)) {
      ctx.addIssue({
        path: ['customerProfile', 'numeroDocumento'],
        message: 'El RUC debe tener 11 dígitos y empezar con 10 o 20',
        code: z.ZodIssueCode.custom,
      });
    }

    if (body.deliveryMethod === 'pickup' && body.receiverInfo && !body.receiverInfo.numeroDocumento) {
      ctx.addIssue({
        path: ['receiverInfo', 'numeroDocumento'],
        message: 'El documento de quien recoge es obligatorio para recojo en tienda',
        code: z.ZodIssueCode.custom,
      });
    }
  }),
});

export const procesarCargoCulqiSchema = z.object({
  body: z.object({
    orderNumber: z.string().trim().min(1, { message: 'El número de orden es requerido' }),
    culqiToken: z.string().trim().min(1, { message: 'El token de pago es requerido' }),
    deviceFingerPrintId: z.string().optional(),
    installments: z.number().int().min(1).max(36).default(1),
    parameters3DS: z
      .object({
        eci: z.string().optional(),
        xid: z.string().optional(),
        cavv: z.string().optional(),
        protocolVersion: z.string().optional(),
        directoryServerTransactionId: z.string().optional(),
      })
      .optional(),
  }),
});

export const actualizarEstadoPedidoSchema = z.object({
  params: z.object({
    id: z.string().regex(objectIdRegex, { message: 'ID de pedido no válido' }),
  }),
  body: z.object({
    status: z.enum(Object.values(EstadoPedido) as [string, ...string[]]),
  }),
});

export const obtenerPedidoPorIdSchema = z.object({
  params: z.object({
    id: z.string().regex(objectIdRegex, { message: 'ID de pedido no válido' }),
  }),
});

export type CrearPedidoInput = z.infer<typeof crearPedidoSchema>['body'];
export type ActualizarEstadoPedidoInput = z.infer<typeof actualizarEstadoPedidoSchema>;