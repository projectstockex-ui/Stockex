import express from 'express';
import { protectAdmin, superAdminOnly } from '../middleware/auth.js';
import {
  listSegmentGroupingOverview,
  getSegmentGroupingDetail,
  saveSegmentGrouping,
  seedSegmentGroupingDefaults,
} from '../services/segmentGroupingService.js';

const router = express.Router();
const superAdminAuth = [protectAdmin, superAdminOnly];

router.get('/', superAdminAuth, async (req, res) => {
  try {
    const segments = await listSegmentGroupingOverview();
    res.json({ segments });
  } catch (e) {
    console.error('[segment-grouping] list', e);
    res.status(500).json({ message: e.message || 'Failed to load segment grouping' });
  }
});

router.get('/:displaySegment', superAdminAuth, async (req, res) => {
  try {
    const data = await getSegmentGroupingDetail(req.params.displaySegment);
    res.json(data);
  } catch (e) {
    const status = e.status || 500;
    res.status(status).json({ message: e.message || 'Failed to load segment' });
  }
});

router.put('/:displaySegment', superAdminAuth, async (req, res) => {
  try {
    const data = await saveSegmentGrouping(
      req.params.displaySegment,
      req.body?.groups,
      req.admin?._id
    );
    res.json(data);
  } catch (e) {
    const status = e.status || 500;
    res.status(status).json({ message: e.message || 'Failed to save' });
  }
});

router.post('/:displaySegment/seed-defaults', superAdminAuth, async (req, res) => {
  try {
    const data = await seedSegmentGroupingDefaults(req.params.displaySegment, req.admin?._id);
    res.json(data);
  } catch (e) {
    const status = e.status || 500;
    res.status(status).json({ message: e.message || 'Failed to seed defaults' });
  }
});

export default router;
