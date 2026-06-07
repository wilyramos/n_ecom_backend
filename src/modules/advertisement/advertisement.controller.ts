import { Request, Response } from 'express';
import { AdvertisementService } from './advertisement.service';
import { AppError } from '../../utils/AppError';

const adService = new AdvertisementService();

export class AdvertisementController {
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
     * GET /api/advertisements/active
     * Recupera los avisos vigentes y activos filtrados por rangos horarios para la tienda.
     */
    getActiveAds = async (_req: Request, res: Response): Promise<void> => {
        try {
            const ads = await adService.getActiveAds();
            res.status(200).json({ ok: true, data: ads });
        } catch (error) {
            this.handleError(res, error, 'Error al recuperar los avisos activos del storefront.');
        }
    };

    /**
     * GET /api/advertisements/admin
     * Recupera todo el historial de campañas publicitarias de manera pagnada para el CMS.
     */
    getAllAds = async (req: Request, res: Response): Promise<void> => {
        try {
            const page = parseInt(req.query.page as string, 10) || 1;
            const limit = parseInt(req.query.limit as string, 10) || 10;

            const result = await adService.getAllAds(page, limit);

            res.status(200).json({
                ok: true,
                data: result.data,
                meta: result.meta
            });
        } catch (error) {
            this.handleError(res, error, 'Error al procesar el listado administrativo de avisos.');
        }
    };

    /**
     * GET /api/advertisements/:id
     * Recupera el documento y la configuración particular de una campaña por su ID único.
     */
    getAdById = async (req: Request, res: Response): Promise<void> => {
        try {
            const { id } = req.params;
            const ad = await adService.getAdById(id);
            res.status(200).json({ ok: true, data: ad });
        } catch (error) {
            this.handleError(res, error, 'Error al intentar localizar el aviso solicitado.');
        }
    };

    /**
     * POST /api/advertisements
     * Registra una nueva pauta publicitaria en el sistema.
     */
    createAd = async (req: Request, res: Response): Promise<void> => {
        try {
            const newAd = await adService.createAd(req.body);
            res.status(201).json({ ok: true, data: newAd });
        } catch (error) {
            this.handleError(res, error, 'Error operacional al crear el aviso.');
        }
    };

    /**
     * PUT /api/advertisements/:id
     * Modifica los parámetros estructurales o las fechas programadas de un aviso.
     */
    updateAd = async (req: Request, res: Response): Promise<void> => {
        try {
            const { id } = req.params;
            const updatedAd = await adService.updateAd(id, req.body);
            res.status(200).json({ ok: true, data: updatedAd });
        } catch (error) {
            this.handleError(res, error, 'Error operacional al actualizar el aviso.');
        }
    };

    /**
     * DELETE /api/advertisements/:id
     * Remueve un anuncio de forma definitiva del motor de persistencia.
     */
    deleteAd = async (req: Request, res: Response): Promise<void> => {
        try {
            const { id } = req.params;
            const deletedAd = await adService.deleteAd(id);
            res.status(200).json({ ok: true, message: 'Anuncio eliminado correctamente.', id: deletedAd._id });
        } catch (error) {
            this.handleError(res, error, 'Error crítico al procesar la eliminación del aviso.');
        }
    };
}