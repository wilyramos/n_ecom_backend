//File: backend/src/modules/page/page.controller.ts

import { Request, Response } from 'express';
import { PageService } from './page.service';
import { AppError } from '../../utils/AppError';

const pageService = new PageService();

export class PageController {
    /**
     * Centraliza las respuestas de error capturando instancias de AppError
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
     * GET /api/pages/slug/:slug
     * Consume la página por slug para visualización en la tienda online.
     */
    getPageBySlug = async (req: Request, res: Response): Promise<void> => {
        try {
            const { slug } = req.params;
            const page = await pageService.getPageBySlug(slug);
            res.status(200).json({ ok: true, data: page });
        } catch (error) {
            this.handleError(res, error, 'Error al recuperar la página para el escaparate público.');
        }
    };

    /**
     * GET /api/pages/admin
     * Lista histórico de páginas estructurado de manera paginada para la administración.
     */
    getAllPages = async (req: Request, res: Response): Promise<void> => {
        try {
            const page = parseInt(req.query.page as string, 10) || 1;
            const limit = parseInt(req.query.limit as string, 10) || 10;

            const result = await pageService.getAllPages(page, limit);

            res.status(200).json({
                ok: true,
                data: result.data,
                meta: result.meta
            });
        } catch (error) {
            this.handleError(res, error, 'Error al procesar el listado administrativo de páginas.');
        }
    };

    /**
     * GET /api/pages/:id
     * Obtiene el documento de una página por su identificador.
     */
    getPageById = async (req: Request, res: Response): Promise<void> => {
        try {
            const { id } = req.params;
            const page = await pageService.getPageById(id);
            res.status(200).json({ ok: true, data: page });
        } catch (error) {
            this.handleError(res, error, 'Error al intentar localizar la página solicitada.');
        }
    };

    /**
     * POST /api/pages
     * Genera una nueva entrada de contenido institucional en la base de datos.
     */
    createPage = async (req: Request, res: Response): Promise<void> => {
        try {
            const newPage = await pageService.createPage(req.body);
            res.status(201).json({ ok: true, data: newPage });
        } catch (error) {
            this.handleError(res, error, 'Error operacional al crear la página.');
        }
    };

    /**
     * PUT /api/pages/:id
     * Actualiza el contenido, metadatos SEO o visibilidad de una página.
     */
    updatePage = async (req: Request, res: Response): Promise<void> => {
        try {
            const { id } = req.params;
            const updatedPage = await pageService.updatePage(id, req.body);
            res.status(200).json({ ok: true, data: updatedPage });
        } catch (error) {
            this.handleError(res, error, 'Error operacional al actualizar la página.');
        }
    };

    /**
     * DELETE /api/pages/:id
     * Elimina el registro físico de la página.
     */
    deletePage = async (req: Request, res: Response): Promise<void> => {
        try {
            const { id } = req.params;
            const deletedPage = await pageService.deletePage(id);
            res.status(200).json({ ok: true, message: 'Página eliminada correctamente.', id: deletedPage._id });
        } catch (error) {
            this.handleError(res, error, 'Error crítico al procesar la eliminación de la página.');
        }
    };
}