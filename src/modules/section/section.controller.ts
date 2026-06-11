// File: backend/src/modules/section/section.controller.ts

import { Request, Response } from 'express';
import { SectionService } from './section.service';
import { AppError } from '../../utils/AppError';

const sectionService = new SectionService();

export class SectionController {
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

    getActiveSections = async (_req: Request, res: Response): Promise<void> => {
        try {
            const sections = await sectionService.getActiveSections();
            res.status(200).json(sections);
        } catch (error) {
            this.handleError(res, error, 'Error al obtener las secciones activas');
        }
    };

    getSectionBySlug = async (req: Request, res: Response): Promise<void> => {
        try {
            const { slug } = req.params;
            const section = await sectionService.getSectionBySlug(slug);
            res.status(200).json(section);
        } catch (error) {
            this.handleError(res, error, 'Error al obtener la sección por slug');
        }
    };

    getAllSections = async (req: Request, res: Response): Promise<void> => {
        try {
            const page = parseInt(req.query.page as string, 10) || 1;
            const limit = parseInt(req.query.limit as string, 10) || 10;

            const result = await sectionService.getAllSections(page, limit);

            res.status(200).json({
                ok: true,
                data: result.data,
                meta: result.meta
            });
        } catch (error) {
            this.handleError(res, error, 'Error al obtener el listado completo de secciones');
        }
    };

    getSectionById = async (req: Request, res: Response): Promise<void> => {
        try {
            const { id } = req.params;
            const section = await sectionService.getSectionById(id);
            res.status(200).json(section);
        } catch (error) {
            this.handleError(res, error, 'Error al obtener la sección');
        }
    };

    createSection = async (req: Request, res: Response): Promise<void> => {
        try {
            const newSection = await sectionService.createSection(req.body);
            res.status(201).json(newSection);
        } catch (error) {
            this.handleError(res, error, 'Error al crear la sección');
        }
    };

    updateSection = async (req: Request, res: Response): Promise<void> => {
        try {
            const { id } = req.params;
            const updatedSection = await sectionService.updateSection(id, req.body);
            res.status(200).json(updatedSection);
        } catch (error) {
            console.error("🚨 Error capturado en SectionController.updateSection:", error);
            this.handleError(res, error, 'Error al actualizar la sección');
        }
    };

    reorderSections = async (req: Request, res: Response): Promise<void> => {
        try {
            const { orders } = req.body;
            await sectionService.reorderSections(orders);
            res.status(200).json({ message: 'Secciones reordenadas con éxito' });
        } catch (error) {
            this.handleError(res, error, 'Error al reordenar las secciones');
        }
    };

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