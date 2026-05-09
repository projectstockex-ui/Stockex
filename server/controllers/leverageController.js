/**
 * Leverage Management Controller
 * Handles hierarchical leverage cap operations
 */

import Admin from '../models/Admin.js';
import leverageValidationService from '../services/leverageValidationService.js';

class LeverageController {
  /**
   * Set leverage cap for Admin (SuperAdmin only)
   */
  async setAdminLeverageCap(req, res) {
    try {
      const { maxLeverageFromParent } = req.body;
      const admin = await Admin.findById(req.params.id);

      if (!admin) return res.status(404).json({ message: 'Admin not found' });
      if (admin.role === 'SUPER_ADMIN') return res.status(403).json({ message: 'Cannot modify Super Admin leverage cap' });

      // Validate the leverage cap
      const validation = leverageValidationService.validateLeverageCap(req.admin, maxLeverageFromParent);
      if (!validation.valid) {
        return res.status(400).json({ message: validation.error });
      }

      // Update leverage cap
      if (!admin.leverageSettings) admin.leverageSettings = {};
      admin.leverageSettings.maxLeverageFromParent = maxLeverageFromParent;
      admin.markModified('leverageSettings');
      await admin.save();

      res.json({
        message: 'Leverage cap updated successfully',
        maxLeverageFromParent: admin.leverageSettings.maxLeverageFromParent
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }

  /**
   * Set leverage cap for Broker (Admin only)
   */
  async setBrokerLeverageCap(req, res) {
    try {
      const currentAdmin = req.admin;
      const { maxLeverageFromParent } = req.body;
      const broker = await Admin.findById(req.params.id);

      if (!broker) return res.status(404).json({ message: 'Broker not found' });
      if (broker.role !== 'BROKER') return res.status(400).json({ message: 'Target is not a broker' });

      // Verify parent relationship
      if (broker.createdBy.toString() !== currentAdmin._id.toString()) {
        return res.status(403).json({ message: 'You can only set leverage cap for your own brokers' });
      }

      // Validate the leverage cap against parent's own cap
      const validation = leverageValidationService.validateLeverageCap(currentAdmin, maxLeverageFromParent);
      if (!validation.valid) {
        return res.status(400).json({ message: validation.error });
      }

      // Update leverage cap
      if (!broker.leverageSettings) broker.leverageSettings = {};
      broker.leverageSettings.maxLeverageFromParent = maxLeverageFromParent;
      broker.markModified('leverageSettings');
      await broker.save();

      res.json({
        message: 'Leverage cap updated successfully',
        maxLeverageFromParent: broker.leverageSettings.maxLeverageFromParent
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }

  /**
   * Set leverage cap for SubBroker (Broker only)
   */
  async setSubBrokerLeverageCap(req, res) {
    try {
      const currentAdmin = req.admin;
      const { maxLeverageFromParent } = req.body;
      const subBroker = await Admin.findById(req.params.id);

      if (!subBroker) return res.status(404).json({ message: 'Sub Broker not found' });
      if (subBroker.role !== 'SUB_BROKER') return res.status(400).json({ message: 'Target is not a sub-broker' });

      // Verify parent relationship
      if (subBroker.createdBy.toString() !== currentAdmin._id.toString()) {
        return res.status(403).json({ message: 'You can only set leverage cap for your own sub-brokers' });
      }

      // Validate the leverage cap against parent's own cap
      const validation = leverageValidationService.validateLeverageCap(currentAdmin, maxLeverageFromParent);
      if (!validation.valid) {
        return res.status(400).json({ message: validation.error });
      }

      // Update leverage cap
      if (!subBroker.leverageSettings) subBroker.leverageSettings = {};
      subBroker.leverageSettings.maxLeverageFromParent = maxLeverageFromParent;
      subBroker.markModified('leverageSettings');
      await subBroker.save();

      res.json({
        message: 'Leverage cap updated successfully',
        maxLeverageFromParent: subBroker.leverageSettings.maxLeverageFromParent
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
}

export default new LeverageController();
