// File: backend/src/modules/seo/seo.controller.ts

import { RequestHandler } from 'express';
import { SeoService } from './seo.service';

const seoService = new SeoService();

/**
 * GET /api/seo/catalog-paths
 * Combinaciones de catálogo (categoría/marca/línea) con productos activos,
 * para generar el sitemap. Público y de solo lectura.
 */
export const getCatalogPaths: RequestHandler = async (req, res) => {
    try {
        const paths = await seoService.getCatalogPaths();
        res.status(200).json({ success: true, total: paths.length, paths });
    } catch (error) {
        console.error('Controller Error (getCatalogPaths):', error);
        res.status(500).json({ success: false, message: 'Error obteniendo las rutas del catálogo' });
    }
};
