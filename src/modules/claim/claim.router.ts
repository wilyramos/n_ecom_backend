// File: backend/src/modules/claim/claim.routes.ts
import { Router } from 'express';
import { ClaimController } from './claim.controller';
import { authenticate, isAdminOrVendedor } from '../../middleware/auth';

const router = Router();

// Endpoints Públicos
router.post('/', ClaimController.create);
router.get('/track', ClaimController.trackClaim);

// Endpoints Protegidos (Gestión interna de incidencias)
router.use(authenticate, isAdminOrVendedor);

router.get('/', ClaimController.getAll);
router.route('/:id')
    .get(ClaimController.getById)
    .patch(ClaimController.resolve);

export default router;