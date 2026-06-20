//File: backend/src/modules/page/page.service.ts

import { UpdateQuery } from 'mongoose';
import { Page, IPage } from './page.model';
import { AppError } from '../../utils/AppError';
import slugify from 'slugify';

// Slugs fijos del sistema que colisionarían con rutas físicas del Storefront
const RESERVED_SLUGS = [
    "admin", "api", "pos", "staff", "auth", "carrito", "catalogo", 
    "categorias", "checkout", "checkout-result", "colecciones", 
    "libro-de-reclamaciones", "novedades", "ofertas", "productos", 
    "profile", "search", "track-order", "login", "registro", "perfil"
];

// Slugs legales e-commerce estrictamente inmutables y no eliminables
const IMMUTABLE_SLUGS = ["terminos-y-condiciones", "cambios-devoluciones"];

export class PageService {
    /**
     * Recupera una página activa mediante su slug único para el storefront (Next.js).
     */
    async getPageBySlug(slug: string): Promise<IPage> {
        const page = await Page.findOne({ slug, isActive: true }).lean();

        if (!page) {
            throw new AppError('La página solicitada no está disponible o no existe.', 404);
        }

        return page as IPage;
    }

    /**
     * Obtiene todas las páginas de manera paginada para el Panel de Administración.
     */
    async getAllPages(page: number = 1, limit: number = 10): Promise<{
        data: IPage[];
        meta: { total: number; page: number; pages: number; limit: number }
    }> {
        const skip = (page - 1) * limit;

        const [data, total] = await Promise.all([
            Page.find()
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Page.countDocuments()
        ]);

        const pages = Math.ceil(total / limit);

        return {
            data: data as IPage[],
            meta: { total, page, pages, limit }
        };
    }

    /**
     * Obtiene una página por su ID para edición en el CMS.
     */
    async getPageById(id: string): Promise<IPage> {
        const page = await Page.findById(id).lean();

        if (!page) {
            throw new AppError('La página solicitada no existe.', 404);
        }

        return page as IPage;
    }

    /**
     * Registra una nueva página autogenerando el slug si no es provisto.
     */
    async createPage(pageData: Partial<IPage>): Promise<IPage> {
        if (!pageData.title) {
            throw new AppError('El título de la página es obligatorio.', 400);
        }

        const baseText = pageData.slug || pageData.title;
        pageData.slug = slugify(baseText, { lower: true, strict: true });

        // Denegar la creación si el slug generado está reservado por la aplicación
        if (RESERVED_SLUGS.includes(pageData.slug.toLowerCase().trim())) {
            throw new AppError(`La ruta '/${pageData.slug}' está protegida porque corresponde a una sección crítica del e-commerce.`, 400);
        }

        await this.checkSlugUniqueness(pageData.slug);

        const newPage = new Page(pageData);
        return await newPage.save();
    }

    /**
     * Actualiza las propiedades de una página y recalcula el slug si cambia el título o slug explícito.
     * Bloquea la mutación del slug si pertenece a documentos inmutables.
     */
    async updatePage(id: string, updateData: UpdateQuery<IPage>): Promise<IPage> {
        const currentPage = await Page.findById(id).lean();
        if (!currentPage) {
            throw new AppError('No se localizó la página para aplicar la actualización.', 404);
        }

        if (updateData.slug || updateData.title) {
            const baseText = updateData.slug || updateData.title;
            const newSlug = slugify(baseText, { lower: true, strict: true });

            // Bloqueo estricto: Si la página es inmutable y el slug difiere, arrojar error
            if (IMMUTABLE_SLUGS.includes(currentPage.slug) && newSlug !== currentPage.slug) {
                throw new AppError(`No está permitido modificar la ruta (slug) de la página legal obligatoria '/${currentPage.slug}'.`, 400);
            }

            if (RESERVED_SLUGS.includes(newSlug.toLowerCase().trim())) {
                throw new AppError(`La ruta '/${newSlug}' corresponde a una sección reservada de la plataforma e-commerce.`, 400);
            }

            updateData.slug = newSlug;
            await this.checkSlugUniqueness(newSlug, id);
        }

        const updatedPage = await Page.findByIdAndUpdate(
            id,
            { $set: updateData },
            { new: true, runValidators: true }
        );

        return updatedPage!;
    }

    /**
     * Remueve permanentemente una página del sistema si no es un recurso legal protegido.
     */
    async deletePage(id: string): Promise<IPage> {
        const page = await Page.findById(id).lean();
        if (!page) {
            throw new AppError('No se encontró la página seleccionada para remover.', 404);
        }

        // Bloqueo estricto contra la eliminación de rutas estructurales estables
        if (IMMUTABLE_SLUGS.includes(page.slug)) {
            throw new AppError(`La página '/${page.slug}' es vital para el cumplimiento legal del e-commerce y no puede ser eliminada.`, 400);
        }

        const deletedPage = await Page.findByIdAndDelete(id);
        return deletedPage!;
    }

    /**
     * Valida la unicidad del slug en la colección.
     */
    private async checkSlugUniqueness(slug: string, excludeId?: string): Promise<void> {
        const query: Record<string, any> = { slug };
        if (excludeId) {
            query._id = { $ne: excludeId };
        }

        const exists = await Page.findOne(query).select('_id').lean();
        if (exists) {
            throw new AppError('El slug generado o provisto ya se encuentra registrado por otra página.', 400);
        }
    }
}