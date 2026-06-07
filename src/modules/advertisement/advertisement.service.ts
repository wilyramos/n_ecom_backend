import { UpdateQuery } from 'mongoose';
import { Advertisement, IAdvertisement } from './advertisement.model';
import { AppError } from '../../utils/AppError';

export class AdvertisementService {
    /**
     * Recupera los avisos vigentes y habilitados para el escaparate público.
     * Evalúa dinámicamente si la fecha de hoy se encuentra en el rango parametrizado.
     */
    async getActiveAds(): Promise<IAdvertisement[]> {
        const now = new Date();

        return await Advertisement.find({
            isActive: true,
            $and: [
                {
                    $or: [
                        { startDate: { $exists: false } },
                        { startDate: { $eq: null } },
                        { startDate: { $lte: now } }
                    ]
                },
                {
                    $or: [
                        { endDate: { $exists: false } },
                        { endDate: { $eq: null } },
                        { endDate: { $gte: now } }
                    ]
                }
            ]
        })
        .sort({ createdAt: -1 }) // Prioriza siempre las campañas de carga más recientes
        .lean();
    }

    /**
     * Obtiene el listado completo y paginado de avisos para el Panel Administrativo.
     */
    async getAllAds(page: number = 1, limit: number = 10): Promise<{
        data: IAdvertisement[];
        meta: { total: number; page: number; pages: number; limit: number }
    }> {
        const skip = (page - 1) * limit;

        // Ejecuciones paralelas estructuradas mediante buffers nativos de Node
        const [data, total] = await Promise.all([
            Advertisement.find()
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Advertisement.countDocuments()
        ]);

        const pages = Math.ceil(total / limit);

        return {
            data: data as IAdvertisement[],
            meta: { total, page, pages, limit }
        };
    }

    /**
     * Obtiene una campaña publicitaria en particular basándose en su ID binario.
     */
    async getAdById(id: string): Promise<IAdvertisement> {
        const ad = await Advertisement.findById(id).lean();
        
        if (!ad) {
            throw new AppError('El banner o aviso publicitario solicitado no existe.', 404);
        }

        return ad as IAdvertisement;
    }

    /**
     * Registra un nuevo aviso en el sistema aplicando validaciones lógicas de consistencia.
     */
    async createAd(adData: Partial<IAdvertisement>): Promise<IAdvertisement> {
        this.validateAdPayload(adData);

        const newAd = new Advertisement(adData);
        return await newAd.save();
    }

    /**
     * Modifica las propiedades o vigencia temporal de un aviso administrativo existente.
     */
    async updateAd(id: string, updateData: UpdateQuery<IAdvertisement>): Promise<IAdvertisement> {
        this.validateAdPayload(updateData as Partial<IAdvertisement>);

        const updatedAd = await Advertisement.findByIdAndUpdate(
            id,
            { $set: updateData },
            { new: true, runValidators: true }
        );

        if (!updatedAd) {
            throw new AppError('No se localizó el aviso publicitario para aplicar la actualización.', 404);
        }

        return updatedAd;
    }

    /**
     * Remueve permanentemente un aviso de la base de datos.
     */
    async deleteAd(id: string): Promise<IAdvertisement> {
        const deletedAd = await Advertisement.findByIdAndDelete(id);

        if (!deletedAd) {
            throw new AppError('No se encontró el aviso publicitario seleccionado para remover.', 404);
        }

        return deletedAd;
    }

    /**
     * Validación lógica interna de consistencia de datos de campañas publicitarias
     */
    private validateAdPayload(data: Partial<IAdvertisement>): void {
        if (data.layout === 'modal_popup' && !data.imageUrl) {
            throw new AppError('El formato de Modal Emergente (Popup) requiere obligatoriamente una imagen publicitaria adjunta.', 400);
        }

        if (data.startDate && data.endDate) {
            const start = new Date(data.startDate).getTime();
            const end = new Date(data.endDate).getTime();

            if (start >= end) {
                throw new AppError('La fecha de vencimiento (cierre) debe ser estrictamente posterior a la fecha de inicio programada.', 400);
            }
        }
    }
}