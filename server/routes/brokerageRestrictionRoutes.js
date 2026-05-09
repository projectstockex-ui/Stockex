import express from 'express';
import { protectAdmin, superAdminOnly } from '../middleware/auth.js';
import { 
  getBrokerageRestriction, 
  updateBrokerageRestriction,
  updateSelectiveBrokerageControl,
  getComprehensiveBrokerageRestriction
} from '../controllers/brokerageRestrictionController.js';

const router = express.Router();

/**
 * GET /api/admins/:id/brokerage-restriction
 * Get brokerage restriction settings for an admin (Super Admin only)
 */
router.get('/admins/:id/brokerage-restriction', protectAdmin, superAdminOnly, getBrokerageRestriction);

/**
 * PUT /api/admins/:id/brokerage-restriction
 * Update brokerage restriction settings for an admin (Super Admin only)
 */
router.put('/admins/:id/brokerage-restriction', protectAdmin, superAdminOnly, updateBrokerageRestriction);

/**
 * PUT /api/admins/:id/selective-brokerage-control
 * Update selective brokerage control settings for an admin (Super Admin only)
 */
router.put('/admins/:id/selective-brokerage-control', protectAdmin, superAdminOnly, updateSelectiveBrokerageControl);

/**
 * GET /api/admins/:id/comprehensive-brokerage-restriction
 * Get comprehensive brokerage restriction status including inheritance (Super Admin only)
 */
router.get('/admins/:id/comprehensive-brokerage-restriction', protectAdmin, superAdminOnly, getComprehensiveBrokerageRestriction);

export default router;
