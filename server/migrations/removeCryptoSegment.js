import mongoose from 'mongoose';
import Admin from '../models/Admin.js';
import User from '../models/User.js';
import SystemSettings from '../models/SystemSettings.js';

/**
 * Migration: Remove CRYPTO segment from segmentPermissions
 * 
 * This migration removes the deprecated 'CRYPTO' segment from:
 * 1. All Admin documents' segmentPermissions maps
 * 2. All User documents' segmentPermissions maps
 * 3. SystemSettings.adminSegmentDefaults map
 */

async function removeCryptoSegment() {
  try {
    console.log('Starting migration: Remove CRYPTO segment from segmentPermissions...');
    
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/stockex');
    console.log('Connected to MongoDB');
    
    // Remove CRYPTO from Admin.segmentPermissions
    const adminUpdateResult = await Admin.updateMany(
      { 'segmentPermissions.CRYPTO': { $exists: true } },
      { $unset: { 'segmentPermissions.CRYPTO': '' } }
    );
    console.log(`Updated ${adminUpdateResult.modifiedCount} Admin documents (removed CRYPTO from segmentPermissions)`);
    
    // Remove CRYPTO from User.segmentPermissions
    const userUpdateResult = await User.updateMany(
      { 'segmentPermissions.CRYPTO': { $exists: true } },
      { $unset: { 'segmentPermissions.CRYPTO': '' } }
    );
    console.log(`Updated ${userUpdateResult.modifiedCount} User documents (removed CRYPTO from segmentPermissions)`);
    
    // Remove CRYPTO from SystemSettings.adminSegmentDefaults
    const settingsUpdateResult = await SystemSettings.updateOne(
      { settingsType: 'global', 'adminSegmentDefaults.CRYPTO': { $exists: true } },
      { $unset: { 'adminSegmentDefaults.CRYPTO': '' } }
    );
    console.log(`Updated SystemSettings (removed CRYPTO from adminSegmentDefaults)`);
    
    console.log('Migration completed successfully!');
    
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

// Run migration if called directly
removeCryptoSegment().then(() => process.exit(0));

export default removeCryptoSegment;
