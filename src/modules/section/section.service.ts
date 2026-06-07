import { UpdateQuery } from 'mongoose';
import slugify from 'slugify';
import { Section, ISection, ISectionBlock } from './section.model';
import { AppError } from '../../utils/AppError';
import { Types } from 'mongoose';

export class SectionService {
    /**
     * Obtiene todas las secciones activas ordenadas de manera ascendente.
     * Diseñado para el escaparate público (Storefront) de Next.js 15.
     */
    async getActiveSections(): Promise<ISection[]> {
        return await Section.find({ isActive: true })
            .sort({ order: 1 })
            .populate({
                path: 'blocks.productId',
                select: 'nombre precio imagenes slug stock'
            })
            .lean();
    }

    /**
     * Obtiene el listado completo y paginado de secciones para el CMS administrativo.
     */
    async getAllSections(page: number = 1, limit: number = 10): Promise<{
        data: ISection[];
        meta: { total: number; page: number; pages: number; limit: number }
    }> {
        const skip = (page - 1) * limit;

        // Consultas en paralelo para optimizar tiempos de respuesta e indexación
        const [data, total] = await Promise.all([
            Section.find()
                .sort({ order: 1 })
                .skip(skip)
                .limit(limit)
                .populate({
                    path: 'blocks.productId',
                    select: 'nombre precio imagenes slug stock'
                })
                .lean(),
            Section.countDocuments()
        ]);

        const pages = Math.ceil(total / limit);

        return {
            data: data as ISection[],
            meta: { total, page, pages, limit }
        };
    }

    /**
     * Recupera el detalle de una sección basándose en su ID binario único.
     */
    async getSectionById(id: string): Promise<ISection> {
        const section = await Section.findById(id)
            .populate({
                path: 'blocks.productId',
                select: 'nombre precio imagenes slug stock'
            })
            .lean();

        if (!section) {
            throw new AppError('La sección estructural solicitada no existe.', 404);
        }

        return section as ISection;
    }

    /**
     * Recupera una sección activa filtrando por su identificador slug único.
     */
    async getSectionBySlug(slug: string): Promise<ISection> {
        const section = await Section.findOne({ slug, isActive: true })
            .populate({
                path: 'blocks.productId',
                select: 'nombre precio imagenes slug stock'
            })
            .lean();

        if (!section) {
            throw new AppError(`Sección bajo el identificador '${slug}' no encontrada o inactiva.`, 404);
        }

        return section as ISection;
    }

    /**
     * Registra una nueva sección en el sistema sanitizando las colisiones de ruteo.
     */
    async createSection(sectionData: Partial<ISection>): Promise<ISection> {
        if (!sectionData.title) {
            throw new AppError('El título es requerido para inicializar la sección.', 400);
        }

        // Genera de forma limpia el slug único tolerando registros homónimos
        sectionData.slug = await this.generateUniqueSlug(sectionData.title);

        // Orquestación y limpieza estricta del payload según tipo antes de insertar
        if (sectionData.type === 'rich_text') {
            sectionData.blocks = [];
        } else {
            sectionData.settings = { ...sectionData.settings, bodyText: undefined };
            this.sanitizeAndValidateBlocks(sectionData.type, sectionData.blocks);
        }

        const newSection = new Section(sectionData);
        return await newSection.save();
    }

    /**
     * Actualiza las propiedades o colecciones de bloques de una sección mediante operaciones atómicas.
     */
    async updateSection(id: string, updateData: any): Promise<ISection> {
        // 1. Limpieza inicial: asegúrate de que blocks tenga la estructura esperada
        if (updateData.blocks && Array.isArray(updateData.blocks)) {
            updateData.blocks = updateData.blocks.map((block: any) => {
                const cleanBlock: any = {
                    title: block.title || "",
                    subtitle: block.subtitle || "",
                    imageUrl: block.imageUrl || "",
                    linkTo: block.linkTo || ""
                };

                // Solo añadir productId si es un string de 24 caracteres (ObjectId válido)
                if (block.productId && /^[a-f\d]{24}$/i.test(block.productId)) {
                    cleanBlock.productId = new Types.ObjectId(block.productId);
                }
                return cleanBlock;
            });
        }

        // 2. Ejecutar la actualización de forma atómica y segura
        const updatedSection = await Section.findByIdAndUpdate(
            id,
            { $set: updateData }, // Usamos $set para evitar conflictos con estructuras previas
            { new: true, runValidators: true }
        ).populate({
            path: 'blocks.productId',
            select: 'nombre precio imagenes slug stock'
        });

        if (!updatedSection) {
            throw new AppError('No se encontró la sección para procesar los cambios.', 404);
        }

        return updatedSection;
    }
    /**
     * Remueve de forma definitiva un registro de sección de la base de datos.
     */
    async deleteSection(id: string): Promise<ISection> {
        const deletedSection = await Section.findByIdAndDelete(id);

        if (!deletedSection) {
            throw new AppError('No se localizó la sección requerida para eliminación.', 404);
        }

        return deletedSection;
    }

    /**
     * Actualiza los índices de ordenamiento posicional en lote de múltiples secciones (Drag & Drop).
     */
    async reorderSections(orders: { id: string; order: number }[]): Promise<void> {
        if (!Array.isArray(orders) || orders.length === 0) {
            throw new AppError('El cuerpo de la petición debe contener un lote de órdenes estructural válido.', 400);
        }

        const bulkOps = orders.map((item) => ({
            updateOne: {
                filter: { _id: item.id },
                update: { $set: { order: item.order } },
            },
        }));

        await Section.bulkWrite(bulkOps);
    }

    /**
     * Sanitiza los datos de los bloques e impide errores de conversión BSON de Mongoose.
     */
    private sanitizeAndValidateBlocks(type: string | undefined, blocks: ISectionBlock[] | undefined): void {
        if (!blocks || !Array.isArray(blocks)) return;

        for (const [index, block] of blocks.entries()) {
            // CORRECCIÓN: Si productId viene como string vacío, conviértelo a undefined/null
            const rawProductId = block.productId as unknown as string;
            if (!rawProductId || rawProductId.trim() === "") {
                delete block.productId;
            } else if (typeof rawProductId === "string") {
                // Aseguramos que sea un ObjectId válido para Mongoose
                try {
                    block.productId = new Types.ObjectId(rawProductId) as any;
                } catch (e) {
                    throw new AppError(`El ID de producto en el bloque #${index + 1} no es válido.`, 400);
                }
            }

            // Validación flexible: si no hay producto, la imagen se vuelve estrictamente obligatoria
            if (type === 'product_grid' && !block.productId && !block.imageUrl) {
                throw new AppError(`El bloque #${index + 1} de la cuadrícula requiere un ID de producto o una imagen por lo menos.`, 400);
            }
            if (type === 'featured_collections' && !block.imageUrl) {
                throw new AppError(`El bloque #${index + 1} de la grilla de imágenes requiere subir una miniatura válida.`, 400);
            }
        }
    }

    /**
     * Algoritmo recursivo controlado para garantizar slugs 100% únicos sin colisiones en MongoDB.
     */
    private async generateUniqueSlug(title: string): Promise<string> {
        const baseSlug = slugify(title, { lower: true, strict: true, trim: true, locale: "es" });

        let slug = baseSlug;
        let suffix = 1;
        let isUnique = false;

        while (!isUnique) {
            const existing = await Section.findOne({ slug });
            if (!existing) {
                isUnique = true;
            } else {
                slug = `${baseSlug}-${suffix}`;
                suffix++;
            }
        }
        return slug;
    }
}