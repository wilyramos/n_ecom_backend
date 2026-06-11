// File: backend/src/modules/section/section.service.ts

import { UpdateQuery, Types } from 'mongoose';
import slugify from 'slugify';
import { Section, ISection, ISectionBlock } from './section.model';
import { AppError } from '../../utils/AppError';

export class SectionService {
    /**
     * Obtiene todas las secciones activas ordenadas de manera ascendente.
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
        if (!Types.ObjectId.isValid(id)) {
            throw new AppError('El identificador de sección provisto es inválido.', 400);
        }

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
            .then(res => res ? res.toObject() : null); // Lean alternativo compatible con hooks pre-save si fueran necesarios

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

        sectionData.slug = await this.generateUniqueSlug(sectionData.title);

        if (sectionData.type === 'rich_text') {
            sectionData.blocks = [];
        } else {
            if (sectionData.settings) {
                sectionData.settings = { ...sectionData.settings, bodyText: undefined };
            }
            this.sanitizeAndValidateBlocks(sectionData.type, sectionData.blocks);
        }

        const newSection = new Section(sectionData);
        return await newSection.save();
    }

    /**
     * Actualiza las propiedades o colecciones de bloques de una sección mediante operaciones atómicas.
     */
    // File: backend/src/modules/section/section.service.ts

    async updateSection(id: string, updateData: UpdateQuery<ISection>): Promise<ISection> {
        if (!Types.ObjectId.isValid(id)) {
            throw new AppError('El identificador de sección provisto es inválido.', 400);
        }

        if (updateData.title) {
            const generatedSlug = slugify(updateData.title, { lower: true, strict: true, trim: true, locale: "es" });

            const colision = await Section.findOne({ slug: generatedSlug, _id: { $ne: id } });
            if (colision) {
                throw new AppError(`El título ingresado genera un slug '${generatedSlug}' ya utilizado en otra sección.`, 400);
            }
            updateData.slug = generatedSlug;
        }

        // Aseguramos la existencia de los operadores atómicos para evitar colisiones
        if (!updateData.$unset) updateData.$unset = {};

        if (updateData.type === 'rich_text') {
            updateData.blocks = [];
            updateData.$unset.blocks = "";
        } else {
            this.sanitizeAndValidateBlocks(updateData.type, updateData.blocks);

            // Si el cliente envía el objeto "settings", lo aplanamos a la raíz usando notación de puntos
            // Esto evita el conflicto atómico de modificar "settings" y hacer $unset en "settings.bodyText"
            if (updateData.settings) {
                if (updateData.settings.gridColumns !== undefined) {
                    updateData["settings.gridColumns"] = updateData.settings.gridColumns;
                }
                delete updateData.settings; // Eliminamos el objeto agrupado para evitar colisiones
            }

            // Removemos de forma segura la propiedad obsoleta en la base de datos
            updateData.$unset["settings.bodyText"] = "";
        }

        const updatedSection = await Section.findByIdAndUpdate(
            id,
            updateData,
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

    private sanitizeAndValidateBlocks(type: string | undefined, blocks: ISectionBlock[] | undefined): void {
        console.log("-> Dentro de sanitizeAndValidateBlocks. Bloques recibidos:", blocks?.length || 0);
        if (!blocks || !Array.isArray(blocks)) return;

        if (blocks.length > 8) {
            console.log("❌ Error: Exceso de bloques detectado en service:", blocks.length);
            throw new AppError('Operación denegada. La sección no puede contener más de 8 bloques de contenido.', 400);
        }

        for (const [index, block] of blocks.entries()) {
            const rawProductId = block.productId as unknown as string | undefined;

            if (rawProductId === "" || (typeof rawProductId === "string" && rawProductId.trim() === "")) {
                delete block.productId;
            } else if (block.productId && !Types.ObjectId.isValid(block.productId.toString())) {
                console.log(`❌ Error: El bloque #${index + 1} posee un productId inválido:`, block.productId);
                throw new AppError(`El bloque #${index + 1} posee un identificador de producto inválido para la base de datos.`, 400);
            }

            if (type === 'product_grid' && !block.productId && !block.imageUrl) {
                throw new AppError(`El bloque #${index + 1} de la cuadrícula requiere un ID de producto o una imagen por lo menos.`, 400);
            }
            if (type === 'featured_collections' && !block.imageUrl) {
                throw new AppError(`El bloque #${index + 1} de la grilla de imágenes requiere subir una miniatura válida.`, 400);
            }
        }
        console.log("-> sanitizeAndValidateBlocks completado con éxito.");
    }

    /**
     * Remueve de forma definitiva un registro de sección de la base de datos.
     */
    async deleteSection(id: string): Promise<ISection> {
        if (!Types.ObjectId.isValid(id)) {
            throw new AppError('El identificador de sección provisto es inválido.', 400);
        }

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

        const bulkOps = orders.map((item) => {
            if (!Types.ObjectId.isValid(item.id)) {
                throw new AppError(`El ID '${item.id}' enviado en el lote de ordenamiento no es válido.`, 400);
            }
            return {
                updateOne: {
                    filter: { _id: item.id },
                    update: { $set: { order: item.order } },
                },
            };
        });

        await Section.bulkWrite(bulkOps);
    }

    /**
     * Algoritmo para garantizar slugs 100% únicos sin colisiones recursivas.
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