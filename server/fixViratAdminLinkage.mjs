import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

// Import models
const User = (await import('./models/User.js')).default;
const Admin = (await import('./models/Admin.js')).default;

async function fixViratAdminLinkage() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    // Find user Virat
    const virat = await User.findOne({ username: 'virat' });
    if (!virat) {
      console.log('❌ User virat not found');
      return;
    }

    console.log('✓ Virat user found:', {
      userId: virat._id,
      username: virat.username,
      email: virat.email,
      admin: virat.admin,
      adminCode: virat.adminCode,
      createdBy: virat.createdBy,
      creatorRole: virat.creatorRole
    });

    // Find Ashish (subbroker) who should be Virat's admin
    const ashish = await Admin.findOne({ username: 'ashish' });
    if (!ashish) {
      console.log('❌ Admin ashish not found');
      return;
    }

    console.log('✓ Ashish admin found:', {
      adminId: ashish._id,
      username: ashish.username,
      role: ashish.role,
      adminCode: ashish.adminCode,
      parentId: ashish.parentId,
      hierarchyPath: ashish.hierarchyPath
    });

    // Update Virat's admin linkage
    const result = await User.updateOne(
      { _id: virat._id },
      {
        $set: {
          admin: ashish._id,
          adminCode: ashish.adminCode,
          createdBy: ashish._id,
          creatorRole: ashish.role
        }
      }
    );

    console.log('✓ Virat admin linkage fixed successfully');
    console.log('  Admin:', ashish.username);
    console.log('  Admin Code:', ashish.adminCode);
    console.log('  Role:', ashish.role);
    console.log('  Modified count:', result.modifiedCount);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
  }
}

fixViratAdminLinkage();
