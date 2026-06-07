import { Router } from 'express';
import { AdvertisementController } from './advertisement.controller';
import { authenticate, isAdmin } from '../../middleware/auth';

const router = Router();
const adController = new AdvertisementController();

// ── ENDPOINTS PÚBLICOS ─────────────────────────────────────────
router.get('/active', adController.getActiveAds);

// ── ENDPOINTS ADMINISTRATIVOS (PROTEGIDOS) ─────────────────────
router.use(authenticate, isAdmin);

router.get('/admin', adController.getAllAds);
router.get('/:id', adController.getAdById);
router.post('/', adController.createAd);
router.put('/:id', adController.updateAd);
router.delete('/:id', adController.deleteAd);

export default router;