// File: backend/src/modules/section/section.routes.ts
import { Router } from 'express';
import { SectionController } from './section.controller';
import { authenticate, isAdmin } from '../../middleware/auth';

const router = Router();
const sectionController = new SectionController();

// ── PÚBLICAS ───────────────────────────────────────────────────
router.get('/', sectionController.getActiveSections);
router.get('/slug/:slug', sectionController.getSectionBySlug);

// ── PRIVADAS ───────────────────────────────────────────────────
router.use(authenticate, isAdmin);

router.get('/admin', sectionController.getAllSections);
router.post('/', sectionController.createSection);
router.patch('/reorder', sectionController.reorderSections);
router.get('/:id', sectionController.getSectionById);
router.put('/:id', sectionController.updateSection);
router.delete('/:id', sectionController.deleteSection);

export default router;