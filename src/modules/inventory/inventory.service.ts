// File: backend/src/modules/inventory/inventory.service.ts

import { Types } from 'mongoose';
import Product from '../../models/Product';
import { IItemPedido } from '../pedidos/pedido.model';

export class InventoryService {
  /**
   * Descuenta stock usando operadores atómicos ($inc) tras confirmar pago
   */
  static async descontarStockItems(items: IItemPedido[]): Promise<void> {
    for (const item of items) {
      const productId = new Types.ObjectId(item.productId);
      const cantidadADescontar = -Math.abs(item.quantity);

      if (item.variantId) {
        const variantObjectId = new Types.ObjectId(item.variantId);
        
        await Product.updateOne(
          { _id: productId, 'variants._id': variantObjectId },
          {
            $inc: {
              'variants.$.stock': cantidadADescontar,
              stock: cantidadADescontar,
            },
          }
        );
      } else {
        await Product.updateOne(
          { _id: productId },
          { $inc: { stock: cantidadADescontar } }
        );
      }
    }
  }

  /**
   * Restablece/Repone stock cuando se cancela o reembolsa un pedido
   */
  static async reponerStockItems(items: IItemPedido[]): Promise<void> {
    for (const item of items) {
      const productId = new Types.ObjectId(item.productId);
      const cantidadARestaurar = Math.abs(item.quantity);

      if (item.variantId) {
        const variantObjectId = new Types.ObjectId(item.variantId);
        
        await Product.updateOne(
          { _id: productId, 'variants._id': variantObjectId },
          {
            $inc: {
              'variants.$.stock': cantidadARestaurar,
              stock: cantidadARestaurar,
            },
          }
        );
      } else {
        await Product.updateOne(
          { _id: productId },
          { $inc: { stock: cantidadARestaurar } }
        );
      }
    }
  }

  /**
   * Ajuste manual directo de stock desde el panel de administración
   */
  static async ajustarStockManual(
    productId: string, 
    nuevoStock: number, 
    variantId?: string
  ): Promise<void> {
    const pId = new Types.ObjectId(productId);
    const stockVal = Math.max(0, Number(nuevoStock));

    if (variantId) {
      const vId = new Types.ObjectId(variantId);
      await Product.updateOne(
        { _id: pId, 'variants._id': vId },
        { $set: { 'variants.$.stock': stockVal } }
      );

      // Recalcula el stock global del producto sumando sus variantes
      const prod = await Product.findById(pId);
      if (prod && prod.variants) {
        const totalVariantes = prod.variants.reduce((acc, v) => acc + (v.stock || 0), 0);
        await Product.updateOne({ _id: pId }, { $set: { stock: totalVariantes } });
      }
    } else {
      await Product.updateOne({ _id: pId }, { $set: { stock: stockVal } });
    }
  }
}