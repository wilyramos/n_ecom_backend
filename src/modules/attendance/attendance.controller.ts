// File: backend/src/modules/attendance/attendance.controller.ts

import { Request, Response } from 'express';
import { attendanceService } from './attendance.service';
import { AppError } from '../../utils/AppError';

// Helper para parsear enteros de query params con fallback seguro
const parseIntParam = (value: unknown, fallback: number): number => {
    const parsed = parseInt(value as string, 10);
    return isNaN(parsed) || parsed < 1 ? fallback : parsed;
};

export class AttendanceController {
    private handleError(res: Response, error: unknown, defaultMessage: string): void {
        if (error instanceof AppError) {
            res.status(error.statusCode).json({ message: error.message });
            return;
        }
        console.error(defaultMessage, error);
        res.status(500).json({ message: defaultMessage });
    }

    checkIn = async (req: Request, res: Response): Promise<void> => {
        try {
            const userId = (req as any).user.id;
            const record = await attendanceService.checkIn(userId);
            res.status(201).json({ success: true, data: record });
        } catch (error) {
            this.handleError(res, error, 'Error al registrar entrada.');
        }
    };

    checkOut = async (req: Request, res: Response): Promise<void> => {
        try {
            const userId = (req as any).user.id;
            const record = await attendanceService.checkOut(userId);
            res.status(200).json({ success: true, data: record });
        } catch (error) {
            this.handleError(res, error, 'Error al registrar salida.');
        }
    };

    getMyHistory = async (req: Request, res: Response): Promise<void> => {
        try {
            const userId = (req as any).user.id;
            const page  = parseIntParam(req.query.page, 1);
            const limit = parseIntParam(req.query.limit, 30);
            const result = await attendanceService.getMyAttendanceHistory(userId, page, limit);
            res.status(200).json({ success: true, ...result });
        } catch (error) {
            this.handleError(res, error, 'Error al recuperar historial.');
        }
    };

getAllForAdmin = async (req: Request, res: Response): Promise<void> => {
    try {
        const page  = parseIntParam(req.query.page, 1);
        const limit = parseIntParam(req.query.limit, 10);
        const { startDate, endDate, search } = req.query; // Cambiado userId por search

        const result = await attendanceService.getAllAttendanceForAdmin({
            startDate: startDate as string,
            endDate:   endDate as string,
            search:    search as string, // Despachado conceptualmente al service
            page,
            limit
        });

        res.status(200).json({ success: true, ...result });
    } catch (error) {
        this.handleError(res, error, 'Error al obtener reporte administrativo.');
    }
};
}

export const attendanceController = new AttendanceController();