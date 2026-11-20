// File: backend/src/modules/claim/claim.service.ts
import Claim, { IClaim } from './claim.model';
import { AppError } from '../../utils/AppError';
import { ClaimEmail } from '../../emails/ClaimEmailResend';

const DIA_MS = 24 * 60 * 60 * 1000;

export class ClaimService {
    /**
     * Días sin atención tras los cuales se vuelve a avisar a los administradores (env CLAIM_REMINDER_DAYS, por defecto 3)
     */
    static get diasRecordatorio(): number {
        const dias = parseInt(process.env.CLAIM_REMINDER_DAYS || '', 10);
        return Number.isFinite(dias) && dias > 0 ? dias : 3;
    }

    /**
     * Recuerda a los administradores los reclamos no resueltos y sin respuesta reciente.
     * Un reclamo cuenta como "sin atender" si su última actividad (registro, última respuesta o último recordatorio)
     * tiene más de `dias` días. Cada reclamo se reserva de forma atómica antes de enviar el correo, así que
     * ejecuciones duplicadas del cron no generan avisos repetidos.
     */
    static async notificarReclamosSinAtender(dias: number = ClaimService.diasRecordatorio): Promise<number> {
        const cutoff = new Date(Date.now() - dias * DIA_MS);
        const sinUltimoAviso = [
            { 'resolution.ultimoRecordatorioAdmin': { $exists: false } },
            { 'resolution.ultimoRecordatorioAdmin': null },
            { 'resolution.ultimoRecordatorioAdmin': { $lte: cutoff } }
        ];

        const candidatos = await Claim.find({
            'resolution.estado': { $ne: 'Resuelto' },
            createdAt: { $lte: cutoff },
            $or: sinUltimoAviso
        });

        const pendientes = candidatos.filter((claim) => {
            const ultimaActividad = Math.max(
                new Date(claim.createdAt).getTime(),
                claim.resolution?.fechaRespuesta ? new Date(claim.resolution.fechaRespuesta).getTime() : 0,
                claim.resolution?.ultimoRecordatorioAdmin ? new Date(claim.resolution.ultimoRecordatorioAdmin).getTime() : 0
            );
            return ultimaActividad <= cutoff.getTime();
        });

        let enviados = 0;
        for (const candidato of pendientes) {
            // Reserva atómica: solo un proceso puede avisar sobre este reclamo en esta ventana
            const reservado = await Claim.findOneAndUpdate(
                { _id: candidato._id, 'resolution.estado': { $ne: 'Resuelto' }, $or: sinUltimoAviso },
                { $set: { 'resolution.ultimoRecordatorioAdmin': new Date() } },
                { new: true }
            );
            if (!reservado) continue;

            const envio = await ClaimEmail.notifyAdminsOnNewClaim(reservado, { diasSinAtender: dias });
            if (envio.success) {
                enviados++;
            } else {
                // Si el correo no salió, libera la reserva para reintentar en la siguiente ejecución
                await Claim.updateOne({ _id: reservado._id }, { $unset: { 'resolution.ultimoRecordatorioAdmin': 1 } });
            }
        }

        return enviados;
    }

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

        const claim = await new Claim(data).save();

        // Aviso a los administradores; un fallo de correo no debe revertir el registro
        ClaimEmail.notifyAdminsOnNewClaim(claim).catch((error) =>
            console.error(`⚠️ [ClaimService] Error en notificación a administradores (${claim.correlativo}):`, error)
        );

        return claim;
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

        const current = await Claim.findById(id).select('resolution.estado resolution.respuestaProveedor').lean();
        if (!current) throw new AppError('No se pudo encontrar el reclamo para actualizar.', 404);

        const nuevaRespuesta = respuestaProveedor.trim();
        const estadoCambio = current.resolution?.estado !== estado;
        const respuestaCambio = (current.resolution?.respuestaProveedor || '') !== nuevaRespuesta;

        const updateData: any = {
            'resolution.estado': estado,
            'resolution.respuestaProveedor': nuevaRespuesta
        };

        if (estado === 'Resuelto' || respuestaCambio) {
            updateData['resolution.fechaRespuesta'] = new Date();
        }

        const claim = await Claim.findByIdAndUpdate(id, { $set: updateData }, { new: true, runValidators: true });
        if (!claim) throw new AppError('No se pudo encontrar el reclamo para actualizar.', 404);

        // Notifica al consumidor solo si cambió el estado y/o la respuesta
        if (estadoCambio || respuestaCambio) {
            const envio = await ClaimEmail.sendResponseToConsumer(claim);
            if (!envio.success) {
                console.warn(`⚠️ [ClaimService] No se pudo notificar al consumidor del reclamo ${claim.correlativo}.`);
            }
        }

        return claim;
    }
}