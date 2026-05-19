import mongoose from 'mongoose';
import User from '../models/User.js';
import Admin from '../models/Admin.js';

async function assignRadhaToManish() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/stockex');
    console.log('Connected to MongoDB');

    const userId = 'USRMPC7T5AKUPA';
    const adminCode = 'ADM5K46VN';

    // Find user
    const user = await User.findOne({ userId });
    if (!user) {
      console.error('User not found:', userId);
      process.exit(1);
    }

    // Find admin
    const admin = await Admin.findOne({ adminCode });
    if (!admin) {
      console.error('Admin not found:', adminCode);
      process.exit(1);
    }

    console.log('Found user:', user.userId, 'current admin:', user.admin);
    console.log('Found admin:', admin.adminCode, '-', admin.name);

    // Build hierarchy path (using ObjectIds)
    const hierarchyPath = [admin._id];
    let currentAdmin = admin;
    while (currentAdmin.parentId) {
      currentAdmin = await Admin.findById(currentAdmin.parentId);
      if (currentAdmin) {
        hierarchyPath.push(currentAdmin._id);
      } else {
        break;
      }
    }

    // Update user with admin
    await User.updateOne(
      { userId },
      {
        admin: admin._id,
        adminCode: admin.adminCode,
        hierarchyPath: hierarchyPath,
        creatorRole: admin.role
      }
    );

    console.log('✅ Admin assigned successfully!');
    console.log('User:', userId);
    console.log('Admin:', admin.adminCode, '-', admin.name);
    console.log('Hierarchy path:', hierarchyPath);

    // Verify
    const updatedUser = await User.findOne({ userId });
    console.log('Updated user.admin:', updatedUser.admin);
    console.log('Updated user.adminCode:', updatedUser.adminCode);

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

assignRadhaToManish();
