// File: backend/src/modules/seo/seo.routes.ts

import { Router } from 'express';
import { getCatalogPaths } from './seo.controller';

const router = Router();

// Rutas de catálogo para el sitemap (público, solo lectura)
router.get('/catalog-paths', getCatalogPaths);

export default router;
