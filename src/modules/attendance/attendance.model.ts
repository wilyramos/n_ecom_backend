// File: backend/src/modules/attendance/attendance.model.ts

import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IAttendance extends Document {
    userId: Types.ObjectId;
    date: Date; // Fecha normalizada (YYYY-MM-DD a medianoche) para control de duplicados
    checkIn: {
        timestamp: Date;
    };
    checkOut?: {
        timestamp: Date;
    };
    workHours?: number; // Horas laboradas calculadas de forma dinámica en el check-out
    createdAt: Date;
    updatedAt: Date;
}

const attendanceSchema = new Schema<IAttendance>(
    {
        userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        date: { type: Date, required: true },
        checkIn: {
            timestamp: { type: Date, required: true }
        },
        checkOut: {
            timestamp: { type: Date }
        },
        workHours: { type: Number, min: 0 }
    },
    { timestamps: true }
);

// Índices para búsquedas óptimas y unicidad por día y usuario
attendanceSchema.index({ userId: 1, date: 1 }, { unique: true });
attendanceSchema.index({ date: 1 });

export const Attendance = mongoose.model<IAttendance>('Attendance', attendanceSchema);