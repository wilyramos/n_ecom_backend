// File: backend/src/modules/claim/claim.controller.ts
import { Request, Response, NextFunction } from 'express';
import { ClaimService } from './claim.service';

export class ClaimController {
    /**
     * POST /api/claims
     */
    static async create(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const claim = await ClaimService.create(req.body);
            res.status(201).json({
                status: 'success',
                data: claim
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * GET /api/claims
     */
    static async getAll(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { estado, search, limit, page } = req.query;

            const filters = {
                estado: estado as string,
                search: search as string,
                limit: limit ? parseInt(limit as string, 10) : undefined,
                page: page ? parseInt(page as string, 10) : undefined
            };

            const result = await ClaimService.getAll(filters);

            res.status(200).json({
                status: 'success',
                data: result.claims,
                total: result.total,
                page: result.page,
                pages: result.pages
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * GET /api/claims/track
     */
    static async trackClaim(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { correlativo, numeroDocumento } = req.query;
            const claim = await ClaimService.getStatusByPublicCredentials(
                correlativo as string,
                numeroDocumento as string
            );

            res.status(200).json({
                status: 'success',
                data: claim
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * GET /api/claims/:id
     */
    static async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { id } = req.params;
            const claim = await ClaimService.getById(id);
            res.status(200).json({
                status: 'success',
                data: claim
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * PATCH /api/claims/:id/resolve
     */
    static async resolve(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { id } = req.params;
            const { respuestaProveedor, estado } = req.body;

            const claim = await ClaimService.resolve(id, respuestaProveedor, estado);
            res.status(200).json({
                status: 'success',
                data: claim
            });
        } catch (error) {
            next(error);
        }
    }
}