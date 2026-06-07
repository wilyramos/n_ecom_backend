import { Request, Response } from 'express';
import { SectionService } from './section.service';
import { AppError } from '../../utils/AppError';

const sectionService = new SectionService();

export class SectionController {
    /**
     * 
     */
    private handleError(res: Response, error: unknown, defaultMessage: string): void {
        if (error instanceof AppError) {
            res.status(error.statusCode).json({ message: error.message });
            return;
        }
        res.status(500).json({
            message: defaultMessage,
            error: error instanceof Error ? error.message : error
        });
    }

    /**
     * GET /api/sections
     * Obtiene las secciones activas organizadas para el storefront (Next.js 15)
     */
    getActiveSections = async (_req: Request, res: Response): Promise<void> => {
        try {
            const sections = await sectionService.getActiveSections();
            res.status(200).json(sections);
        } catch (error) {
            this.handleError(res, error, 'Error al obtener las secciones activas');
        }
    };

    /**
     * GET /api/sections/slug/:slug
     * Obtiene una sección activa específica filtrando por su slug único
     */
    getSectionBySlug = async (req: Request, res: Response): Promise<void> => {
        try {
            const { slug } = req.params;
            const section = await sectionService.getSectionBySlug(slug);
            res.status(200).json(section);
        } catch (error) {
            this.handleError(res, error, 'Error al obtener la sección por slug');
        }
    };

    /**
     * GET /api/sections/admin
     * Obtiene todas las secciones (activas e inactivas) para el panel de administración
     */
    getAllSections = async (req: Request, res: Response): Promise<void> => {
        try {
            // Parseo seguro de query params con valores por defecto
            const page = parseInt(req.query.page as string, 10) || 1;
            const limit = parseInt(req.query.limit as string, 10) || 10;

            const result = await sectionService.getAllSections(page, limit);

            // Formato espejo exacto que valida el esquema del frontend
            res.status(200).json({
                ok: true,
                data: result.data,
                meta: result.meta
            });
        } catch (error) {
            this.handleError(res, error, 'Error al obtener el listado completo de secciones');
        }
    };

    /**
     * GET /api/sections/:id
     * Obtiene el detalle administrativo de una sección por su ID
     */
    getSectionById = async (req: Request, res: Response): Promise<void> => {
        try {
            const { id } = req.params;
            const section = await sectionService.getSectionById(id);
            res.status(200).json(section);
        } catch (error) {
            this.handleError(res, error, 'Error al obtener la sección');
        }
    };

    /**
     * POST /api/sections
     * Crea una nueva sección de contenido estructurado
     */
    createSection = async (req: Request, res: Response): Promise<void> => {
        console.log("Datos recibidos para crear sección:", req.body);
        try {
            console.log("Datos recibidos para crear sección:", req.body);
            const newSection = await sectionService.createSection(req.body);
            res.status(201).json(newSection);
        } catch (error) {
            console.error("Error al crear sección:", error);
            this.handleError(res, error, 'Error al crear la sección');
        }
    };

    /**
     * PUT /api/sections/:id
     * Actualiza las propiedades globales o el listado de bloques de una sección
     */
    updateSection = async (req: Request, res: Response): Promise<void> => {
        try {
            const { id } = req.params;
            const updatedSection = await sectionService.updateSection(id, req.body);
            res.status(200).json(updatedSection);
        } catch (error) {
            this.handleError(res, error, 'Error al actualizar la sección');
        }
    };

    /**
     * PATCH /api/sections/reorder
     * Reordena posicionalmente múltiples secciones concurrentes (Drag and Drop en CMS)
     */
    reorderSections = async (req: Request, res: Response): Promise<void> => {
        try {
            const { orders } = req.body;
            await sectionService.reorderSections(orders);
            res.status(200).json({ message: 'Secciones reordenadas con éxito' });
        } catch (error) {
            this.handleError(res, error, 'Error al reordenar las secciones');
        }
    };

    /**
     * DELETE /api/sections/:id
     * Remueve permanentemente una sección de la base de datos
     */
    deleteSection = async (req: Request, res: Response): Promise<void> => {
        try {
            const { id } = req.params;
            await sectionService.deleteSection(id);
            res.status(200).json({ message: 'Sección eliminada correctamente', id });
        } catch (error) {
            this.handleError(res, error, 'Error al eliminar la sección');
        }
    };
}