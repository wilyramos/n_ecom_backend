// File: backend/src/modules/advertisement/advertisement.model.ts (o donde corresponda)
import { Schema, model, Document } from 'mongoose';

export type AdLayoutType = 'top_bar' | 'modal_popup';

export interface IAdvertisement extends Document {
    title?: string;
    showTitle: boolean;
    subtitle?: string;
    imageUrl?: string;
    linkTo?: string;
    layout: AdLayoutType;
    isActive: boolean;
    startDate?: Date;
    endDate?: Date;
    createdAt: Date;
    updatedAt: Date;
}

const AdvertisementSchema = new Schema<IAdvertisement>({
    title: { type: String, trim: true, default: '' },
    showTitle: { type: Boolean, default: true },
    subtitle: { type: String, trim: true },
    imageUrl: { type: String },
    linkTo: { type: String, trim: true },
    layout: {
        type: String,
        required: true,
        enum: ['top_bar', 'modal_popup'],
        default: 'top_bar'
    },
    isActive: { type: Boolean, default: true },
    startDate: { type: Date },
    endDate: { type: Date }
}, { timestamps: true });

AdvertisementSchema.index({ isActive: 1, layout: 1, startDate: 1, endDate: 1 });

export const Advertisement = model<IAdvertisement>('Advertisement', AdvertisementSchema);