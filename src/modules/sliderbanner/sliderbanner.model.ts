// File: backend/src/modules/sliderbanner/sliderbanner.model.ts

import mongoose, { Schema, Document } from 'mongoose';

export type SliderLayout =
    | 'image-only'
    | 'default'
    | 'media-left'
    | 'background-media';

export type SliderTheme = 'dark' | 'light' | 'custom';

export interface ISliderMedia {
    imageUrl?: string;
    videoUrl?: string;
    objectFit?: 'contain' | 'cover' | 'fill';
}

export interface ISliderPrice {
    current?: number;
    compare?: number;
    label?: string;
    suffix?: string;
}

export interface ISliderDesign {
    layout: SliderLayout;
    theme?: SliderTheme;
    bgColor?: string;
    accentColor?: string;
    textColor?: string;
}

export interface ISliderCountdown {
    endsAt?: Date;
    label?: string;
    showDays?: boolean;
}

export interface ISliderBanner extends Document {
    title?: string;
    subtitle?: string;
    description?: string;
    terms?: string;
    price?: ISliderPrice;
    destUrl?: string;
    openInNewTab?: boolean;
    media?: ISliderMedia;
    design: ISliderDesign;
    countdown?: ISliderCountdown;
    isActive: boolean;
    order: number;
    schedule?: {
        startsAt?: Date;
        endsAt?: Date;
    };
}

// ── Sub-schemas ───────────────────────────────────────────────────────────────

const sliderMediaSchema = new Schema<ISliderMedia>(
    {
        imageUrl: { type: String, trim: true },
        videoUrl: { type: String, trim: true },
        objectFit: {
            type: String,
            enum: ['contain', 'cover', 'fill'],
            default: 'cover',
        },
    },
    { _id: false }
);

const sliderPriceSchema = new Schema<ISliderPrice>(
    {
        current: { type: Number, min: 0 },
        compare: { type: Number, min: 0 },
        label: { type: String, trim: true },
        suffix: { type: String, trim: true },
    },
    { _id: false }
);

const sliderDesignSchema = new Schema<ISliderDesign>(
    {
        layout: {
            type: String,
            enum: ['image-only', 'default', 'media-left', 'background-media'],
            default: 'default',
            required: true,
        },
        theme: { type: String, enum: ['dark', 'light', 'custom'], default: 'dark' },
        bgColor: { type: String },
        accentColor: { type: String },
        textColor: { type: String },
    },
    { _id: false }
);

const sliderCountdownSchema = new Schema<ISliderCountdown>(
    {
        endsAt: { type: Date },
        label: { type: String, trim: true },
        showDays: { type: Boolean, default: true },
    },
    { _id: false }
);

const sliderScheduleSchema = new Schema(
    {
        startsAt: { type: Date },
        endsAt: { type: Date },
    },
    { _id: false }
);

// ── Schema principal ──────────────────────────────────────────────────────────

const sliderBannerSchema = new Schema<ISliderBanner>(
    {
        title: { type: String, trim: true },
        subtitle: { type: String, trim: true },
        description: { type: String, trim: true },
        terms: { type: String, trim: true },

        price: { type: sliderPriceSchema },
        destUrl: { type: String, trim: true },
        openInNewTab: { type: Boolean, default: false },
        media: { type: sliderMediaSchema },
        design: { type: sliderDesignSchema, default: () => ({ layout: 'default', theme: 'dark' }) },
        countdown: { type: sliderCountdownSchema },
        schedule: { type: sliderScheduleSchema },

        isActive: { type: Boolean, default: true },
        order: { type: Number, default: 0 },
    },
    { timestamps: true }
);

sliderBannerSchema.index({ isActive: 1, order: 1 });
sliderBannerSchema.index({ 'schedule.startsAt': 1, 'schedule.endsAt': 1 });

export default mongoose.model<ISliderBanner>('SliderBanner', sliderBannerSchema);