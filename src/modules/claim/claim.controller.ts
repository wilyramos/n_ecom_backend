// File: backend/src/modules/claim/claim.controller.ts
import { Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';
import { ClaimService } from './claim.service';
import { AppError } from '../../utils/AppError';
import { ClaimStatus } from './claim.model';

const claimService = new ClaimService();

export class ClaimController {
    /**
     * POST /claims
     * Registra un nuevo reclamo. Público (sin autenticación).
     */
    public async create(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            // Los errores de express-validator ya se manejan en el middleware
            // handleInputErrors antes de llegar aquí, pero se deja como red de seguridad
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return next(new AppError('Datos de entrada inválidos.', 400));
            }

            const {
                nombres, tipoDocumento, numeroDocumento,
                celular, email, direccion, ciudad, region,
                tipoReclamo, fechaIncidencia, detalle, pedido
            } = req.body;

            const consumerData = {
                nombres,
                tipoDocumento,
                numeroDocumento,
                celular,
                email,
                direccion,
                ciudad,
                region
            };

            const detailData = {
                tipoReclamo,
                fechaIncidencia: new Date(fechaIncidencia),
                detalle,
                pedido
            };

            const claim = await claimService.createClaim(consumerData, detailData);

            res.status(201).json({
                success: true,
                message: 'Reclamación registrada exitosamente.',
                data: {
                    id: claim._id,
                    correlativo: claim.correlativo,
                    createdAt: claim.createdAt
                }
            });
        } catch (error: any) {
            next(new AppError(error.message || 'Error al crear el reclamo.', 500));
        }
    }

    /**
     * GET /claims
     * Lista todos los reclamos. Solo administradores.
     */
    public async getAll(_req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const claims = await claimService.getAllClaims();
            res.status(200).json({
                success: true,
                results: claims.length,
                data: claims
            });
        } catch (error: any) {
            next(new AppError(error.message || 'Error al obtener los reclamos.', 500));
        }
    }

    /**
     * GET /claims/:correlativo
     * Consulta pública de estado de un reclamo por su correlativo.
     */
    public async getByCorrelativo(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { correlativo } = req.params;
            const claim = await claimService.getClaimByCorrelativo(correlativo.toUpperCase());

            if (!claim) {
                return next(new AppError(`No se encontró el reclamo con correlativo ${correlativo}.`, 404));
            }

            res.status(200).json({
                success: true,
                data: claim
            });
        } catch (error: any) {
            next(new AppError(error.message || 'Error al obtener el reclamo.', 500));
        }
    }

    /**
     * PATCH /claims/:correlativo/resolution
     * Actualiza el estado de un reclamo. Solo administradores.
     */
    public async updateResolution(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { correlativo } = req.params;
            const { estado, respuestaProveedor } = req.body;

            const updated = await claimService.updateResolution(
                correlativo.toUpperCase(),
                estado as ClaimStatus,
                respuestaProveedor
            );

            if (!updated) {
                return next(new AppError(`No se encontró el reclamo con correlativo ${correlativo}.`, 404));
            }

            res.status(200).json({
                success: true,
                message: 'Resolución actualizada correctamente.',
                data: {
                    correlativo: updated.correlativo,
                    estado: updated.resolution.estado,
                    fechaRespuesta: updated.resolution.fechaRespuesta
                }
            });
        } catch (error: any) {
            next(new AppError(error.message || 'Error al actualizar la resolución.', 500));
        }
    }
}