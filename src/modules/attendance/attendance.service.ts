// File: backend/src/modules/attendance/attendance.service.ts

import { Types, FilterQuery } from 'mongoose';
import { Attendance, IAttendance } from './attendance.model';
import { AppError } from '../../utils/AppError';

export interface IAttendanceFilterDto {
    startDate?: string;
    endDate?: string;
    search?: string; // Cambiado userId por search
    page?: number;
    limit?: number;
}
export interface IPaginatedAttendance {
    data: IAttendance[];
    meta: {
        total: number;
        page: number;
        limit: number;
        pages: number;
    };
}

export class AttendanceService {

    /** Normaliza una fecha a medianoche UTC para comparaciones consistentes */
    private toMidnight(date: Date): Date {
        const d = new Date(date);
        d.setHours(0, 0, 0, 0);
        return d;
    }

    /** Calcula horas trabajadas redondeadas a 2 decimales */
    private calcWorkHours(checkIn: Date, checkOut: Date): number {
        const diffMs = checkOut.getTime() - checkIn.getTime();
        return parseFloat((diffMs / (1000 * 60 * 60)).toFixed(2));
    }

    async checkIn(userId: string): Promise<IAttendance> {
        if (!Types.ObjectId.isValid(userId)) {
            throw new AppError('Identificador de usuario inválido.', 400);
        }

        const now = new Date();
        const today = this.toMidnight(now);

        const existing = await Attendance.findOne({
            userId: new Types.ObjectId(userId),
            date: today
        });

        if (existing) {
            throw new AppError('Ya registraste tu entrada para hoy.', 409); // 409 Conflict es más semántico que 400
        }

        return await Attendance.create({
            userId: new Types.ObjectId(userId),
            date: today,
            checkIn: { timestamp: now }
        });
    }

    async checkOut(userId: string): Promise<IAttendance> {
        if (!Types.ObjectId.isValid(userId)) {
            throw new AppError('Identificador de usuario inválido.', 400);
        }

        const now = new Date();
        const today = this.toMidnight(now);

        const attendance = await Attendance.findOne({
            userId: new Types.ObjectId(userId),
            date: today
        });

        if (!attendance) {
            throw new AppError('No hay registro de entrada para hoy.', 404);
        }

        if (attendance.checkOut?.timestamp) {
            throw new AppError('Ya registraste tu salida para hoy.', 409);
        }

        attendance.checkOut = { timestamp: now };
        attendance.workHours = this.calcWorkHours(attendance.checkIn.timestamp, now);

        return await attendance.save();
    }

    async getMyAttendanceHistory(
        userId: string,
        page = 1,
        limit = 30
    ): Promise<IPaginatedAttendance> {
        if (!Types.ObjectId.isValid(userId)) {
            throw new AppError('Identificador de usuario inválido.', 400);
        }

        const filter = { userId: new Types.ObjectId(userId) };
        const skip = (page - 1) * limit;

        const [data, total] = await Promise.all([
            Attendance.find(filter).sort({ date: -1 }).skip(skip).limit(limit).lean(),
            Attendance.countDocuments(filter)
        ]);

        return {
            data: data as IAttendance[],
            meta: { total, page, limit, pages: Math.ceil(total / limit) }
        };
    }

    async getAllAttendanceForAdmin(filters: IAttendanceFilterDto): Promise<IPaginatedAttendance> {
        const { startDate, endDate, search, page = 1, limit = 10 } = filters;
        const skip = (page - 1) * limit;

        // 1. Validaciones preventivas de rango de tiempo
        if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
            throw new AppError('La fecha de inicio no puede ser posterior a la fecha de fin.', 400);
        }

        // 2. Construcción de etapas del Pipeline de Agregación
        const pipeline: any[] = [];

        // Etapa A: Filtrado por fechas directas en la colección de asistencias
        const dateQuery: any = {};
        if (startDate || endDate) {
            if (startDate) dateQuery.$gte = this.toMidnight(new Date(startDate));
            if (endDate) dateQuery.$lte = this.toMidnight(new Date(endDate));
            pipeline.push({ $match: { date: dateQuery } });
        }

        // Etapa B: Cruce de colecciones ($lookup relacional con la colección de usuarios)
        pipeline.push({
            $lookup: {
                from: 'users', // Nombre exacto de la colección de usuarios en MongoDB
                localField: 'userId',
                foreignField: '_id',
                as: 'userDetails'
            }
        });

        // Deshacer el array generado por el lookup para tener un objeto directo
        pipeline.push({ $unwind: '$userDetails' });

        // Etapa C: Aplicar Filtro de Texto Global (Nombre, Apellidos, Email o DNI/RUC/CE)
        if (search && search.trim() !== "") {
            const searchRegex = new RegExp(search.trim(), 'i'); // Case-insensitive
            pipeline.push({
                $match: {
                    $or: [
                        { 'userDetails.nombre': searchRegex },
                        { 'userDetails.apellidos': searchRegex },
                        { 'userDetails.email': searchRegex },
                        { 'userDetails.numeroDocumento': searchRegex }
                    ]
                }
            });
        }

        // 3. Ejecución paralela facetada para obtener los registros paginados y el conteo total
        const aggregationResult = await Attendance.aggregate([
            ...pipeline,
            {
                $facet: {
                    records: [
                        { $sort: { date: -1 } },
                        { $skip: skip },
                        { $limit: limit },
                        {
                            // Estructuramos la salida para que coincida exactamente con el formato esperado en el frontend (Populate)
                            $project: {
                                _id: 1,
                                date: 1,
                                checkIn: 1,
                                checkOut: 1,
                                workHours: 1,
                                createdAt: 1,
                                updatedAt: 1,
                                userId: {
                                    _id: '$userDetails._id',
                                    nombre: '$userDetails.nombre',
                                    apellidos: '$userDetails.apellidos',
                                    email: '$userDetails.email',
                                    tipoDocumento: '$userDetails.tipoDocumento',
                                    numeroDocumento: '$userDetails.numeroDocumento',
                                    rol: '$userDetails.rol'
                                }
                            }
                        }
                    ],
                    totalCount: [
                        { $count: 'count' }
                    ]
                }
            }
        ]);

        const data = aggregationResult[0]?.records || [];
        const total = aggregationResult[0]?.totalCount[0]?.count || 0;

        return {
            data,
            meta: {
                total,
                page,
                limit,
                pages: Math.ceil(total / limit)
            }
        };
    }
}

export const attendanceService = new AttendanceService();