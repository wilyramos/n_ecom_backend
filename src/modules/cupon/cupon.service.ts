// File: backend/src/modules/cupon/cupon.service.ts

import { FilterQuery, Types } from 'mongoose';
import Cupon, { AplicaACupon, ICupon, TipoCupon } from './cupon.model';
import { ActualizarCuponInput, CrearCuponInput } from './cupon.schema';
import Pedido, { EstadoPedido } from '../pedidos/pedido.model';
import Product from '../../models/Product';
import { AppError } from '../../utils/AppError';

export interface ItemCarritoCupon {
  productId: string;
  quantity: number;
  price: number;
}

export interface ResultadoCupon {
  codigo: string;
  tipo: TipoCupon;
  valor: number;
  descuento: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const sumar = (items: ItemCarritoCupon[]) =>
  items.reduce((acc, item) => acc + item.price * item.quantity, 0);

export class CuponService {
  // ── ADMIN: CRUD ───────────────────────────────────────────────────────────

  async listar(params: { page: number; limit: number; search?: string; estado?: 'activo' | 'inactivo' }) {
    const filter: FilterQuery<ICupon> = {};
    if (params.search) {
      filter.codigo = { $regex: escapeRegex(params.search.toUpperCase()) };
    }
    if (params.estado) {
      filter.activo = params.estado === 'activo';
    }

    const [docs, total] = await Promise.all([
      Cupon.find(filter)
        .sort({ createdAt: -1 })
        .skip((params.page - 1) * params.limit)
        .limit(params.limit)
        .lean(),
      Cupon.countDocuments(filter),
    ]);

    const usos = await this.usosPorCodigo(docs.map((d) => d.codigo));
    const data = docs.map((d) => ({ ...d, usos: usos[d.codigo] ?? 0 }));

    return {
      data,
      pagination: {
        total,
        page: params.page,
        limit: params.limit,
        totalPages: Math.ceil(total / params.limit),
      },
    };
  }

  async obtenerPorId(id: string) {
    const cupon = await Cupon.findById(id)
      .populate('categorias', 'nombre')
      .populate('productos', 'nombre sku')
      .lean();
    if (!cupon) throw new AppError('Cupón no encontrado', 404);
    const usos = await this.contarUsos(cupon.codigo);
    return { ...cupon, usos };
  }

  async crear(data: CrearCuponInput) {
    const existe = await Cupon.exists({ codigo: data.codigo });
    if (existe) throw new AppError('Ya existe un cupón con ese código', 409);

    const campos = this.prepararCampos(data);
    const cupon = new Cupon(
      this.limpiarAlcance({ ...campos, aplicaA: data.aplicaA as AplicaACupon })
    );
    await cupon.save();
    return cupon;
  }

  async actualizar(id: string, data: ActualizarCuponInput) {
    const cupon = await Cupon.findById(id);
    if (!cupon) throw new AppError('Cupón no encontrado', 404);

    if (data.codigo && data.codigo !== cupon.codigo) {
      const existe = await Cupon.exists({ codigo: data.codigo, _id: { $ne: cupon._id } });
      if (existe) throw new AppError('Ya existe un cupón con ese código', 409);
    }

    const campos = this.prepararCampos(data);
    Object.assign(cupon, campos);

    // Reglas sobre el estado final (no solo sobre lo que llegó en el body)
    if (cupon.tipo === TipoCupon.PORCENTAJE && cupon.valor > 100) {
      throw new AppError('El porcentaje no puede superar 100', 400);
    }
    const aplicaA = (data.aplicaA ?? cupon.aplicaA) as AplicaACupon;
    if (aplicaA === AplicaACupon.CATEGORIAS && cupon.categorias.length === 0) {
      throw new AppError('Selecciona al menos una categoría', 400);
    }
    if (aplicaA === AplicaACupon.PRODUCTOS && cupon.productos.length === 0) {
      throw new AppError('Selecciona al menos un producto', 400);
    }
    cupon.aplicaA = aplicaA;
    Object.assign(cupon, this.limpiarAlcance({ aplicaA, categorias: cupon.categorias, productos: cupon.productos }));

    await cupon.save();
    return cupon;
  }

  async cambiarEstado(id: string) {
    const cupon = await Cupon.findById(id);
    if (!cupon) throw new AppError('Cupón no encontrado', 404);
    cupon.activo = !cupon.activo;
    await cupon.save();
    return cupon;
  }

  async eliminar(id: string) {
    const cupon = await Cupon.findById(id);
    if (!cupon) throw new AppError('Cupón no encontrado', 404);

    // Si ya se usó en pedidos se conserva el historial: solo se puede desactivar
    const usos = await this.contarUsos(cupon.codigo);
    if (usos > 0) {
      throw new AppError(
        `Este cupón tiene ${usos} pedido(s) asociados. Desactívalo en lugar de eliminarlo.`,
        409
      );
    }
    await cupon.deleteOne();
  }

  // ── VALIDACIÓN Y CÁLCULO (checkout y creación de pedidos) ─────────────────

  /**
   * Valida el cupón contra el carrito y devuelve el descuento en soles.
   * Lanza AppError 400 con un mensaje apto para mostrar al cliente.
   * El monto siempre se recalcula en servidor; nunca se confía en el cliente.
   */
  async calcularDescuento(input: {
    codigo: string;
    items: ItemCarritoCupon[];
    email?: string;
  }): Promise<ResultadoCupon> {
    const codigo = input.codigo.trim().toUpperCase();
    const cupon = await Cupon.findOne({ codigo }).lean();
    if (!cupon) throw new AppError('El cupón ingresado no es válido', 400);
    if (!cupon.activo) throw new AppError('El cupón no está activo', 400);

    const ahora = new Date();
    if (cupon.fechaInicio && ahora < cupon.fechaInicio) {
      throw new AppError('El cupón todavía no está vigente', 400);
    }
    if (cupon.fechaFin && ahora > cupon.fechaFin) {
      throw new AppError('El cupón ya venció', 400);
    }

    const montoTotal = sumar(input.items);
    if (cupon.montoMinimo > 0 && montoTotal < cupon.montoMinimo) {
      throw new AppError(
        `Este cupón requiere una compra mínima de S/ ${cupon.montoMinimo.toFixed(2)}`,
        400
      );
    }

    const base = await this.baseElegible(cupon, input.items);
    if (base <= 0) {
      throw new AppError('El cupón no aplica a los productos de tu carrito', 400);
    }

    if (cupon.usosMaximos) {
      const usos = await this.contarUsos(cupon.codigo);
      if (usos >= cupon.usosMaximos) {
        throw new AppError('Este cupón ya alcanzó su límite de usos', 400);
      }
    }
    if (cupon.usosPorCliente && input.email) {
      const usosCliente = await this.contarUsos(cupon.codigo, input.email);
      if (usosCliente >= cupon.usosPorCliente) {
        throw new AppError('Ya usaste este cupón el máximo de veces permitido', 400);
      }
    }

    const descuento =
      cupon.tipo === TipoCupon.PORCENTAJE
        ? round2((base * cupon.valor) / 100)
        : Math.min(cupon.valor, base);

    return {
      codigo: cupon.codigo,
      tipo: cupon.tipo,
      valor: cupon.valor,
      descuento: round2(Math.min(descuento, base)),
    };
  }

  /**
   * Se llama DESPUÉS de guardar el pedido. Recuenta los usos incluyendo el propio pedido:
   * si otro pedido simultáneo también entró, los dos cuentan y el límite nunca se supera.
   * Lanza AppError si el límite se superó; el llamador debe eliminar ese pedido.
   */
  async confirmarUsoTrasGuardar(codigo: string, email: string): Promise<void> {
    const cupon = await Cupon.findOne({ codigo: codigo.trim().toUpperCase() }).lean();
    if (!cupon) return;

    if (cupon.usosMaximos) {
      const usos = await this.contarUsos(cupon.codigo);
      if (usos > cupon.usosMaximos) {
        throw new AppError('Este cupón ya alcanzó su límite de usos', 400);
      }
    }
    if (cupon.usosPorCliente) {
      const usosCliente = await this.contarUsos(cupon.codigo, email);
      if (usosCliente > cupon.usosPorCliente) {
        throw new AppError('Ya usaste este cupón el máximo de veces permitido', 400);
      }
    }
  }

  // ── HELPERS PRIVADOS ──────────────────────────────────────────────────────

  /** Suma de los ítems a los que aplica el cupón (según alcance) */
  private async baseElegible(
    cupon: Pick<ICupon, 'aplicaA' | 'productos' | 'categorias'>,
    items: ItemCarritoCupon[]
  ): Promise<number> {
    if (cupon.aplicaA === AplicaACupon.TODOS) return sumar(items);

    if (cupon.aplicaA === AplicaACupon.PRODUCTOS) {
      const ids = new Set((cupon.productos as Types.ObjectId[]).map(String));
      return sumar(items.filter((i) => ids.has(i.productId)));
    }

    // CATEGORIAS: hay que consultar la categoría real de cada producto
    const ids = [...new Set(items.map((i) => i.productId))].map((id) => new Types.ObjectId(id));
    const productos = await Product.find({ _id: { $in: ids } }).select('_id categoria').lean();
    const categoriasPorProducto = new Map(
      productos.map((p: any) => [String(p._id), String(p.categoria)])
    );
    const categoriasCupon = new Set((cupon.categorias as Types.ObjectId[]).map(String));

    return sumar(
      items.filter((i) => {
        const categoria = categoriasPorProducto.get(i.productId);
        return !!categoria && categoriasCupon.has(categoria);
      })
    );
  }

  /** Pedidos que usan el cupón, sin contar los cancelados (cancelar libera el uso) */
  private async contarUsos(codigo: string, email?: string): Promise<number> {
    const filter: FilterQuery<any> = {
      'cupon.codigo': codigo,
      status: { $ne: EstadoPedido.CANCELED },
    };
    if (email) filter['customerProfile.email'] = email.trim().toLowerCase();
    return Pedido.countDocuments(filter);
  }

  private async usosPorCodigo(codigos: string[]): Promise<Record<string, number>> {
    if (codigos.length === 0) return {};
    const rows = await Pedido.aggregate([
      { $match: { 'cupon.codigo': { $in: codigos }, status: { $ne: EstadoPedido.CANCELED } } },
      { $group: { _id: '$cupon.codigo', count: { $sum: 1 } } },
    ]);
    return Object.fromEntries(rows.map((r) => [r._id, r.count]));
  }

  /** Convierte strings a ObjectId y fechas a Date, sin tocar campos que no llegaron */
  private prepararCampos(data: Partial<CrearCuponInput>) {
    const out: Record<string, unknown> = { ...data };
    if ('fechaInicio' in data) out.fechaInicio = data.fechaInicio ? new Date(data.fechaInicio) : null;
    if ('fechaFin' in data) out.fechaFin = data.fechaFin ? new Date(data.fechaFin) : null;
    if (data.categorias) out.categorias = data.categorias.map((id) => new Types.ObjectId(id));
    if (data.productos) out.productos = data.productos.map((id) => new Types.ObjectId(id));
    return out;
  }

  /** Deja solo la lista que corresponde al alcance elegido */
  private limpiarAlcance<T extends { aplicaA?: AplicaACupon; categorias?: any; productos?: any }>(campos: T): T {
    const out = { ...campos };
    if (out.aplicaA === AplicaACupon.TODOS) {
      out.categorias = [];
      out.productos = [];
    } else if (out.aplicaA === AplicaACupon.CATEGORIAS) {
      out.productos = [];
    } else if (out.aplicaA === AplicaACupon.PRODUCTOS) {
      out.categorias = [];
    }
    return out;
  }
}

export const cuponService = new CuponService();
