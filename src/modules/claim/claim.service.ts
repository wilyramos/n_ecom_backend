// File: backend/src/modules/claim/claim.service.ts
import Claim, { IClaim, IClaimConsumer, IClaimDetail, ClaimStatus } from './claim.model';

export class ClaimService {
    /**
     * Genera el correlativo INDECOPI con reintentos ante colisiones de unicidad.
     * Se reintenta hasta 5 veces para absorber race conditions en alta concurrencia.
     */
    private async generateCorrelativo(retries = 5): Promise<string> {
        const currentYear = new Date().getFullYear();
        const startOfYear = new Date(`${currentYear}-01-01T00:00:00.000Z`);
        const endOfYear   = new Date(`${currentYear}-12-31T23:59:59.999Z`);

        for (let attempt = 0; attempt < retries; attempt++) {
            const count = await Claim.countDocuments({
                createdAt: { $gte: startOfYear, $lte: endOfYear }
            });

            const paddedSequence = String(count + 1 + attempt).padStart(5, '0');
            const correlativo    = `R-${currentYear}-${paddedSequence}`;

            // Verifica que no exista ya ese correlativo antes de devolverlo
            const exists = await Claim.exists({ correlativo });
            if (!exists) return correlativo;
        }

        // Fallback: usa timestamp para garantizar unicidad
        const ts = Date.now().toString().slice(-5);
        return `R-${new Date().getFullYear()}-${ts}`;
    }

    /**
     * Registra un nuevo reclamo y genera su número correlativo INDECOPI.
     */
    public async createClaim(
        consumer: IClaimConsumer,
        detail: IClaimDetail
    ): Promise<IClaim> {
        const correlativo = await this.generateCorrelativo();

        const newClaim = new Claim({ correlativo, consumer, detail });

        try {
            return await newClaim.save();
        } catch (error: any) {
            // E11000 = duplicate key (colisión de correlativo en concurrencia extrema)
            if (error.code === 11000 && error.keyPattern?.correlativo) {
                const fallbackCorrelativo = await this.generateCorrelativo(3);
                newClaim.correlativo = fallbackCorrelativo;
                return await newClaim.save();
            }
            throw error;
        }
    }

    /**
     * Obtiene todos los reclamos ordenados por fecha de creación descendente.
     * Uso: panel de administración.
     */
    public async getAllClaims(): Promise<IClaim[]> {
        return Claim.find().sort({ createdAt: -1 }).lean();
    }

    /**
     * Obtiene un reclamo por su correlativo INDECOPI.
     */
    public async getClaimByCorrelativo(correlativo: string): Promise<IClaim | null> {
        return Claim.findOne({ correlativo }).lean();
    }

    /**
     * Actualiza el estado de resolución de un reclamo (uso administrativo).
     */
    public async updateResolution(
        correlativo: string,
        estado: ClaimStatus,
        respuestaProveedor?: string
    ): Promise<IClaim | null> {
        return Claim.findOneAndUpdate(
            { correlativo },
            {
                $set: {
                    'resolution.estado': estado,
                    ...(respuestaProveedor !== undefined && {
                        'resolution.respuestaProveedor': respuestaProveedor
                    }),
                    ...(estado === 'Resuelto' && {
                        'resolution.fechaRespuesta': new Date()
                    })
                }
            },
            { new: true, runValidators: true }
        );
    }
}