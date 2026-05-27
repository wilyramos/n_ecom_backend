// File: backend/src/modules/claim/claim.service.ts
import Claim, { IClaim } from './claim.model';
import { AppError } from '../../utils/AppError';

export class ClaimService {
    /**
     * Genera el correlativo anual incremental según el estándar de INDECOPI
     */
    private static async generateCorrelative(): Promise<string> {
        const currentYear = new Date().getFullYear();
        const prefix = 'REC';

        const lastClaim = await Claim.findOne({
            correlativo: new RegExp(`^${prefix}-${currentYear}-`)
        })
        .sort({ createdAt: -1 })
        .select('correlativo')
        .lean();

        let nextSequence = 1;
        if (lastClaim && lastClaim.correlativo) {
            const parts = lastClaim.correlativo.split('-');
            const lastSequence = parseInt(parts[parts.length - 1], 10);
            if (!isNaN(lastSequence)) {
                nextSequence = lastSequence + 1;
            }
        }

        const paddedSequence = String(nextSequence).padStart(5, '0');
        return `${prefix}-${currentYear}-${paddedSequence}`;
    }

    /**
     * Registra un reclamo de manera pública
     */
    static async create(data: Partial<IClaim>) {
        if (!data.consumer || !data.detail) {
            throw new AppError('Los datos del consumidor y el detalle de la incidencia son obligatorios.', 400);
        }

        data.correlativo = await this.generateCorrelative();
        data.resolution = {
            estado: 'Pendiente',
            respuestaProveedor: '',
            fechaRespuesta: undefined
        };

        return await new Claim(data).save();
    }

    /**
     * Listado paginado y filtrado exclusivo para administración
     */
    static async getAll(filters: { estado?: string; search?: string; limit?: number; page?: number } = {}) {
        const { estado, search, limit = 10, page = 1 } = filters;
        const query: any = {};

        if (estado) query['resolution.estado'] = estado;

        if (search?.trim()) {
            const regex = new RegExp(search, 'i');
            query.$or = [
                { correlativo: regex },
                { 'consumer.nombres': regex },
                { 'consumer.numeroDocumento': regex },
                { 'consumer.email': regex }
            ];
        }

        const [claims, total] = await Promise.all([
            Claim.find(query)
                .skip((page - 1) * limit)
                .limit(limit)
                .sort({ createdAt: -1 }),
            Claim.countDocuments(query)
        ]);

        return { claims, total, page, pages: Math.ceil(total / limit) };
    }

    /**
     * Consulta pública de estado usando Correlativo + Documento de Identidad por privacidad
     */
    static async getStatusByPublicCredentials(correlativo: string, numeroDocumento: string) {
        const claim = await Claim.findOne({
            correlativo: correlativo.trim(),
            'consumer.numeroDocumento': numeroDocumento.trim()
        }).select('correlativo consumer.nombres resolution createdAt updatedAt');

        if (!claim) {
            throw new AppError('No se encontró ningún reclamo que coincida con las credenciales provistas.', 404);
        }

        return claim;
    }

    /**
     * Detalle completo del reclamo (Backoffice)
     */
    static async getById(id: string) {
        const claim = await Claim.findById(id);
        if (!claim) throw new AppError('El reclamo solicitado no existe.', 404);
        return claim;
    }

    /**
     * Resuelve o actualiza el estado de la reclamación (Backoffice)
     */
    static async resolve(id: string, respuestaProveedor: string, estado: 'En Proceso' | 'Resuelto') {
        if (!respuestaProveedor || respuestaProveedor.trim().length < 20) {
            throw new AppError('La respuesta institucional debe contener una explicación clara de al menos 20 caracteres.', 400);
        }

        const updateData: any = {
            'resolution.estado': estado,
            'resolution.respuestaProveedor': respuestaProveedor.trim()
        };

        if (estado === 'Resuelto') {
            updateData['resolution.fechaRespuesta'] = new Date();
        }

        const claim = await Claim.findByIdAndUpdate(id, { $set: updateData }, { new: true, runValidators: true });
        if (!claim) throw new AppError('No se pudo encontrar el reclamo para actualizar.', 404);

        return claim;
    }
}