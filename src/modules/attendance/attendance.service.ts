// File: backend/src/modules/attendance/attendance.service.ts

import { Types, FilterQuery } from 'mongoose';
import { Attendance, IAttendance } from './attendance.model';
import { AppError } from '../../utils/AppError';

export interface IAttendanceFilterDto {
    startDate?: string;
    endDate?: string;
    search?: string;
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
    stats: {
        globalWorkHours: number;
        globalTotalRecords: number;
        globalActiveDays: number;
    };
}

export class AttendanceService {

    private toMidnightLima(date: Date): Date {
        const limaStr = date.toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
        return new Date(`${limaStr}T00:00:00.000-05:00`);
    }

    private calcWorkHours(checkIn: Date, checkOut: Date): number {
        const diffMs = checkOut.getTime() - checkIn.getTime();
        return parseFloat((diffMs / (1000 * 60 * 60)).toFixed(2));
    }

    async checkIn(userId: string): Promise<IAttendance> {
        if (!Types.ObjectId.isValid(userId)) {
            throw new AppError('Identificador de usuario inválido.', 400);
        }
        const now = new Date();
        const today = this.toMidnightLima(now);

        const existing = await Attendance.findOne({
            userId: new Types.ObjectId(userId),
            date: today
        });

        if (existing) {
            throw new AppError('Ya registraste tu entrada para hoy.', 409);
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
        const today = this.toMidnightLima(now);

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
    ): Promise<Omit<IPaginatedAttendance, 'stats'>> {
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

        if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
            throw new AppError('La fecha de inicio no puede ser posterior a la fecha de fin.', 400);
        }

        const pipeline: any[] = [];

        const dateQuery: any = {};
        if (startDate || endDate) {
            if (startDate) dateQuery.$gte = this.toMidnightLima(new Date(startDate));
            if (endDate) dateQuery.$lte = this.toMidnightLima(new Date(endDate));
            pipeline.push({ $match: { date: dateQuery } });
        }

        pipeline.push({
            $lookup: {
                from: 'users',
                localField: 'userId',
                foreignField: '_id',
                as: 'userDetails'
            }
        });

        pipeline.push({ $unwind: '$userDetails' });

        if (search && search.trim() !== "") {
            const searchRegex = new RegExp(search.trim(), 'i');
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

        const aggregationResult = await Attendance.aggregate([
            ...pipeline,
            {
                $facet: {
                    records: [
                        { $sort: { date: -1 } },
                        { $skip: skip },
                        { $limit: limit },
                        {
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
                    globalStats: [
                        {
                            $group: {
                                _id: null,
                                totalHours: { $sum: { $ifNull: ['$workHours', 0] } },
                                totalCount: { $sum: 1 },
                                uniqueDays: { $addToSet: '$date' }
                            }
                        },
                        {
                            $project: {
                                _id: 0,
                                totalHours: { $round: ['$totalHours', 2] },
                                totalCount: 1,
                                activeDays: { $size: '$uniqueDays' }
                            }
                        }
                    ]
                }
            }
        ]);

        const data = aggregationResult[0]?.records || [];
        const statsRaw = aggregationResult[0]?.globalStats[0] || { totalHours: 0, totalCount: 0, activeDays: 0 };
        const total = statsRaw.totalCount;

        return {
            data,
            meta: {
                total,
                page,
                limit,
                pages: Math.ceil(total / limit)
            },
            stats: {
                globalWorkHours: statsRaw.totalHours,
                globalTotalRecords: statsRaw.totalCount,
                globalActiveDays: statsRaw.activeDays
            }
        };
    }
}

export const attendanceService = new AttendanceService();