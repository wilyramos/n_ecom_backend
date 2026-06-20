//File: backend/src/modules/page/page.routes.ts

import { Router } from 'express';
import { PageController } from './page.controller';
import { authenticate, isAdmin } from '../../middleware/auth';

const router = Router();
const pageController = new PageController();

// ── ENDPOINTS PÚBLICOS ─────────────────────────────────────────
router.get('/slug/:slug', pageController.getPageBySlug);

// ── ENDPOINTS ADMINISTRATIVOS (PROTEGIDOS) ─────────────────────
router.use(authenticate, isAdmin);

router.get('/admin', pageController.getAllPages);
router.get('/:id', pageController.getPageById);
router.post('/', pageController.createPage);
router.put('/:id', pageController.updatePage);
router.delete('/:id', pageController.deletePage);

export default router;