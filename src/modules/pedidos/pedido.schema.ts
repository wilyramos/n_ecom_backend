import { z } from 'zod';
import { TipoDocumento, TipoComprobante, EstadoPedido } from './pedido.model';

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

export const crearPedidoSchema = z.object({
  body: z.object({
    customerProfile: z.object({
      nombre: z.string().min(2, { message: 'El nombre debe tener al menos 2 caracteres' }),
      apellidos: z.string().min(2, { message: 'Los apellidos deben tener al menos 2 caracteres' }),
      email: z.string().email({ message: 'Email inválido' }),
      telefono: z.string().min(7, { message: 'Teléfono inválido' }),
      tipoDocumento: z.enum(Object.values(TipoDocumento) as [string, ...string[]], {
        message: 'Tipo de documento no válido',
      }),
      numeroDocumento: z.string().min(8, { message: 'Número de documento inválido' }),
    }),
    deliveryMethod: z.enum(['shipping', 'pickup']).default('shipping'),
    invoiceInfo: z
      .object({
        type: z.enum(Object.values(TipoComprobante) as [string, ...string[]]),
        documentNumber: z.string().min(8, { message: 'RUC/Documento fiscal inválido' }),
        businessName: z.string().optional(),
        address: z.string().optional(),
      })
      .refine(
        (data) => {
          if (data.type === TipoComprobante.FACTURA && !data.businessName?.trim()) {
            return false;
          }
          return true;
        },
        {
          message: 'La razón social es requerida para emitir Factura',
          path: ['businessName'],
        }
      )
      .refine(
        (data) => {
          if (data.type === TipoComprobante.FACTURA && !data.documentNumber?.trim()) {
            return false;
          }
          return true;
        },
        {
          message: 'El RUC es requerido para emitir Factura',
          path: ['documentNumber'],
        }
      )
      .optional(),
    shippingAddress: z.object({
      departamento: z.string().min(1, { message: 'El departamento es requerido' }),
      provincia: z.string().min(1, { message: 'La provincia es requerida' }),
      distrito: z.string().min(1, { message: 'El distrito es requerido' }),
      direccion: z.string().min(3, { message: 'La dirección es requerida' }),
      numero: z.string().optional(),
      pisoDpto: z.string().optional(),
      referencia: z.string().optional(),
    }),
    items: z
      .array(
        z.object({
          productId: z.string().regex(objectIdRegex, { message: 'ID de producto no válido' }),
          variantId: z
            .string()
            .regex(objectIdRegex, { message: 'ID de variante no válido' })
            .optional(),
          variantAttributes: z.record(z.string(), z.string()).optional(),
          quantity: z.number().int().positive({ message: 'La cantidad debe ser mayor a 0' }),
          price: z.number().positive({ message: 'El precio debe ser positivo' }),
          nombre: z.string().min(1, { message: 'Nombre de producto requerido' }),
          imagen: z.string().optional(),
        })
      )
      .min(1, { message: 'Debe incluir al menos un producto' }),
    payment: z.object({
      provider: z.string().min(1, { message: 'El proveedor de pago es requerido' }),
      method: z.string().optional(),
      gatewayOrderId: z.string().optional(),
      paymentCode: z.string().optional(),
    }),
    shippingCost: z.number().nonnegative().default(0),
    currency: z.string().default('PEN'),
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

// 🚀 Exportación de tipos TypeScript extraídos desde Zod
export type CrearPedidoInput = z.infer<typeof crearPedidoSchema>['body'];
export type ActualizarEstadoPedidoInput = z.infer<typeof actualizarEstadoPedidoSchema>;