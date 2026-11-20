// File: backend/src/modules/pedidos/pedido-precios.ts

import { Types } from 'mongoose';
import Product from '../../models/Product';
import { AppError } from '../../utils/AppError';

export interface ItemPrecioCliente {
  productId: string;
  variantId?: string;
  quantity: number;
  price: number;
  nombre?: string;
}

/**
 * Verifica que el precio que envía el cliente coincida con el precio real en BD.
 * Usa la misma regla que el carrito del frontend: precio de la variante si existe,
 * si no el precio del producto.
 *
 * - Si coincide, devuelve los ítems sin cambios (los cobros de Culqi, PowerPay y
 *   Mercado Pago no cambian para carritos válidos).
 * - Si no coincide (carrito desactualizado o precio manipulado), lanza 409 y no
 *   se crea ningún pedido.
 */
export async function verificarPreciosContraBD<T extends ItemPrecioCliente>(items: T[]): Promise<T[]> {
  const ids = [...new Set(items.map((i) => i.productId))].map((id) => new Types.ObjectId(id));
  const productos = await Product.find({ _id: { $in: ids } })
    .select('_id precio variants._id variants.precio')
    .lean();

  const porId = new Map(productos.map((p: any) => [String(p._id), p]));
  const desactualizados: string[] = [];

  for (const item of items) {
    const producto: any = porId.get(item.productId);
    if (!producto) {
      throw new AppError(`El producto "${item.nombre ?? 'este producto'}" ya no está disponible. Actualiza tu carrito.`, 409);
    }

    let precioReal: number = producto.precio ?? 0;
    if (item.variantId) {
      const variante = (producto.variants ?? []).find((v: any) => String(v._id) === item.variantId);
      if (!variante) {
        throw new AppError(`La variante de "${item.nombre ?? 'este producto'}" ya no existe. Actualiza tu carrito.`, 409);
      }
      precioReal = variante.precio ?? precioReal;
    }

    if (Math.abs(precioReal - Number(item.price)) > 0.005) {
      desactualizados.push(item.nombre ?? item.productId);
    }
  }

  if (desactualizados.length > 0) {
    throw new AppError(
      `Los precios cambiaron para: ${desactualizados.join(', ')}. Actualiza tu carrito e intenta de nuevo.`,
      409
    );
  }

  return items;
}
