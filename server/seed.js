import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Admin from './models/Admin.js';
import User from './models/User.js';

dotenv.config();

// Default segment permissions that cascade from admin to users
const defaultSegmentPermissions = {
  NSEFUT: {
    enabled: true, maxExchangeLots: 500, commissionType: 'PER_LOT', commissionLot: 20,
    maxLots: 100, minLots: 1, orderLots: 25, exposureIntraday: 10, exposureCarryForward: 5,
    optionBuy: { allowed: true, commissionType: 'PER_LOT', commission: 20, strikeSelection: 50, maxExchangeLots: 500 },
    optionSell: { allowed: true, commissionType: 'PER_LOT', commission: 20, strikeSelection: 50, maxExchangeLots: 500 }
  },
  NSEOPT: {
    enabled: true, maxExchangeLots: 500, commissionType: 'PER_LOT', commissionLot: 20,
    maxLots: 100, minLots: 1, orderLots: 25, exposureIntraday: 1, exposureCarryForward: 1,
    optionBuy: { allowed: true, commissionType: 'PER_LOT', commission: 20, strikeSelection: 50, maxExchangeLots: 500 },
    optionSell: { allowed: true, commissionType: 'PER_LOT', commission: 20, strikeSelection: 50, maxExchangeLots: 500 }
  },
  MCXFUT: {
    enabled: true, maxExchangeLots: 200, commissionType: 'PER_LOT', commissionLot: 25,
    maxLots: 50, minLots: 1, orderLots: 10, exposureIntraday: 8, exposureCarryForward: 4,
    optionBuy: { allowed: true, commissionType: 'PER_LOT', commission: 25, strikeSelection: 50, maxExchangeLots: 200 },
    optionSell: { allowed: true, commissionType: 'PER_LOT', commission: 25, strikeSelection: 50, maxExchangeLots: 200 }
  },
  MCXOPT: {
    enabled: true, maxExchangeLots: 200, commissionType: 'PER_LOT', commissionLot: 25,
    maxLots: 50, minLots: 1, orderLots: 10, exposureIntraday: 1, exposureCarryForward: 1,
    optionBuy: { allowed: true, commissionType: 'PER_LOT', commission: 25, strikeSelection: 50, maxExchangeLots: 200 },
    optionSell: { allowed: true, commissionType: 'PER_LOT', commission: 25, strikeSelection: 50, maxExchangeLots: 200 }
  },
  'NSE-EQ': {
    enabled: true, maxExchangeLots: 1000, commissionType: 'PER_CRORE', commissionLot: 100,
    maxLots: 500, minLots: 1, orderLots: 100, exposureIntraday: 5, exposureCarryForward: 1,
    optionBuy: { allowed: false, commissionType: 'PER_LOT', commission: 0, strikeSelection: 0, maxExchangeLots: 0 },
    optionSell: { allowed: false, commissionType: 'PER_LOT', commission: 0, strikeSelection: 0, maxExchangeLots: 0 }
  },
  'BSE-FUT': {
    enabled: false, maxExchangeLots: 100, commissionType: 'PER_LOT', commissionLot: 20,
    maxLots: 50, minLots: 1, orderLots: 10, exposureIntraday: 10, exposureCarryForward: 5,
    optionBuy: { allowed: true, commissionType: 'PER_LOT', commission: 20, strikeSelection: 50, maxExchangeLots: 100 },
    optionSell: { allowed: true, commissionType: 'PER_LOT', commission: 20, strikeSelection: 50, maxExchangeLots: 100 }
  },
  'BSE-OPT': {
    enabled: false, maxExchangeLots: 100, commissionType: 'PER_LOT', commissionLot: 20,
    maxLots: 50, minLots: 1, orderLots: 10, exposureIntraday: 1, exposureCarryForward: 1,
    optionBuy: { allowed: true, commissionType: 'PER_LOT', commission: 20, strikeSelection: 50, maxExchangeLots: 100 },
    optionSell: { allowed: true, commissionType: 'PER_LOT', commission: 20, strikeSelection: 50, maxExchangeLots: 100 }
  },
  FOREXFUT: {
    enabled: true, maxExchangeLots: 1000, commissionType: 'PER_LOT', commissionLot: 30,
    maxLots: 500, minLots: 1, orderLots: 100, exposureIntraday: 3, exposureCarryForward: 2,
    optionBuy: { allowed: false, commissionType: 'PER_LOT', commission: 0, strikeSelection: 0, maxExchangeLots: 0 },
    optionSell: { allowed: false, commissionType: 'PER_LOT', commission: 0, strikeSelection: 0, maxExchangeLots: 0 }
  },
  FOREXOPT: {
    enabled: true, maxExchangeLots: 1000, commissionType: 'PER_LOT', commissionLot: 30,
    maxLots: 500, minLots: 1, orderLots: 100, exposureIntraday: 1, exposureCarryForward: 1,
    optionBuy: { allowed: true, commissionType: 'PER_LOT', commission: 0, strikeSelection: 50, maxExchangeLots: 100 },
    optionSell: { allowed: true, commissionType: 'PER_LOT', commission: 0, strikeSelection: 50, maxExchangeLots: 100 }
  },
  CRYPTOFUT: {
    enabled: true, maxExchangeLots: 500, commissionType: 'PER_LOT', commissionLot: 30,
    maxLots: 200, minLots: 1, orderLots: 50, exposureIntraday: 5, exposureCarryForward: 3,
    optionBuy: { allowed: true, commissionType: 'PER_LOT', commission: 30, strikeSelection: 50, maxExchangeLots: 500 },
    optionSell: { allowed: true, commissionType: 'PER_LOT', commission: 30, strikeSelection: 50, maxExchangeLots: 500 }
  },
  CRYPTOOPT: {
    enabled: true, maxExchangeLots: 500, commissionType: 'PER_LOT', commissionLot: 30,
    maxLots: 100, minLots: 1, orderLots: 25, exposureIntraday: 1, exposureCarryForward: 1,
    optionBuy: { allowed: true, commissionType: 'PER_LOT', commission: 30, strikeSelection: 50, maxExchangeLots: 500 },
    optionSell: { allowed: true, commissionType: 'PER_LOT', commission: 30, strikeSelection: 50, maxExchangeLots: 500 }
  }
};

/**
 * Hierarchy Structure:
 * SUPER_ADMIN (Level 0) - Can create ADMIN, BROKER, SUB_BROKER directly + Users
 * ADMIN (Level 1) - Can create BROKER, SUB_BROKER directly + Users
 * BROKER (Level 2) - Can create SUB_BROKER + Users
 * SUB_BROKER (Level 3) - Can create Users only
 * 
 * Each role can have their own personal users (trading clients)
 * 
 * Example:
 * SUPER_ADMIN
 * ├── ADMIN (under Super Admin)
 * │   ├── BROKER (under Admin)
 * │   ├── SUB_BROKER (under Admin)
 * │   └── Users (under Admin)
 * ├── BROKER (directly under Super Admin)
 * │   ├── SUB_BROKER (under Broker)
 * │   └── Users (under Broker)
 * ├── SUB_BROKER (directly under Super Admin)
 * │   └── Users (under Sub Broker)
 * └── Users (under Super Admin - not allowed, must create via Admin/Broker/SubBroker)
 */

/** Old seeds used @stockex.com; DB keeps those until migrated — pull alone does not rewrite Mongo. */
async function migrateLegacystockexEmails() {
  const admins = await Admin.find({ email: /@stockex\.com$/i });
  const users = await User.find({ email: /@stockex\.com$/i });
  if (admins.length === 0 && users.length === 0) return;

  console.log('\n---------- Migrating @stockex.com → @stockex.com ----------');
  for (const a of admins) {
    const next = a.email.replace(/@stockex\.com$/i, '@stockex.com');
    await Admin.updateOne({ _id: a._id }, { $set: { email: next } });
    console.log(`  Admin: ${a.email} → ${next}`);
  }
  for (const u of users) {
    const next = u.email.replace(/@stockex\.com$/i, '@stockex.com');
    await User.updateOne({ _id: u._id }, { $set: { email: next } });
    console.log(`  User:  ${u.email} → ${next}`);
  }
  console.log(`  Done: ${admins.length} admin(s), ${users.length} user(s)\n`);
}

const seedHierarchy = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('MongoDB Connected');
    await migrateLegacystockexEmails();
    console.log('\n========== SEEDING HIERARCHY ==========\n');

    // ========== 1. SUPER ADMIN ==========
    let superAdmin = await Admin.findOne({ role: 'SUPER_ADMIN' });
    
    const KUBER_POOL_MAX = 1_000_000_000; // 100 crore

    if (superAdmin) {
      console.log('✓ Super Admin already exists!');
      console.log('  Email:', superAdmin.email);
      const kuberBal = Number(superAdmin.kuberWallet?.balance) || 0;
      if (kuberBal < KUBER_POOL_MAX) {
        await Admin.updateOne(
          { _id: superAdmin._id },
          { $set: { 'kuberWallet.balance': KUBER_POOL_MAX } }
        );
        console.log('  Kuber wallet topped up to 100 crore');
      }
    } else {
      superAdmin = await Admin.create({
        role: 'SUPER_ADMIN',
        username: 'superadmin',
        name: 'Super Administrator',
        email: 'superadmin@stockex.com',
        phone: '9999999999',
        adminCode: 'SUPER_ADMIN',
        password: 'admin123', 
        pin: '1234',
        wallet: { balance: 10000000 }, // 1 Crore initial balance
        kuberWallet: { balance: KUBER_POOL_MAX },
        hierarchyLevel: 0,
        hierarchyPath: [],
        segmentPermissions: defaultSegmentPermissions
      });
      
      console.log('\n✓ Super Admin Created!');
      console.log('  Email: superadmin@stockex.com');
      console.log('  Password: admin123');
      console.log('  Admin Code:', superAdmin.adminCode);
      console.log('  Created By: Super Admin');
      console.log('  Created At:', superAdmin.createdAt.toLocaleString());
    }

    // ========== 2. ADMIN (created by Super Admin) ==========
    let admin = await Admin.findOne({ role: 'ADMIN', username: 'demoadmin' });
    
    if (admin) {
      console.log('\n✓ Demo Admin already exists!');
      console.log('  Admin Code:', admin.adminCode);
      console.log('  Created At:', admin.createdAt.toLocaleString());
    } else {
      admin = await Admin.create({
        role: 'ADMIN',
        username: 'demoadmin',
        name: 'Demo Admin',
        email: 'admin@stockex.com',
        phone: '9876543210',
        password: 'admin123',
        pin: '1234',
        wallet: { balance: 1000000 }, // 10 Lakh initial balance
        createdBy: superAdmin._id,
        parentId: superAdmin._id,
        hierarchyPath: [superAdmin._id],
        segmentPermissions: defaultSegmentPermissions
      });
      
      console.log('\n✓ Demo Admin Created!');
      console.log('  Email: admin@stockex.com');
      console.log('  Password: admin123');
      console.log('  Admin Code:', admin.adminCode);
      console.log('  Created By: Super Admin');
      console.log('  Created At:', admin.createdAt.toLocaleString());
    }

    // ========== 3. BROKER (created by Admin) ==========
    let broker = await Admin.findOne({ role: 'BROKER', username: 'demobroker' });
    
    if (broker) {
      console.log('\n✓ Demo Broker (under Admin) already exists!');
      console.log('  Admin Code:', broker.adminCode);
      console.log('  Created At:', broker.createdAt.toLocaleString());
    } else {
      broker = await Admin.create({
        role: 'BROKER',
        username: 'demobroker',
        name: 'Demo Broker',
        email: 'broker@stockex.com',
        phone: '9876543211',
        password: 'admin123',
        pin: '1234',
        wallet: { balance: 500000 }, // 5 Lakh initial balance
        createdBy: admin._id,
        parentId: admin._id,
        hierarchyPath: [superAdmin._id, admin._id],
        segmentPermissions: defaultSegmentPermissions
      });
      
      console.log('\n✓ Demo Broker Created (under Admin)!');
      console.log('  Email: broker@stockex.com');
      console.log('  Password: admin123');
      console.log('  Admin Code:', broker.adminCode);
      console.log('  Created By: Demo Admin');
      console.log('  Created At:', broker.createdAt.toLocaleString());
    }

    // ========== 3b. BROKER (created directly by Super Admin) ==========
    let superBroker = await Admin.findOne({ role: 'BROKER', username: 'superbroker' });
    
    if (superBroker) {
      console.log('\n✓ Super Broker (under Super Admin) already exists!');
      console.log('  Admin Code:', superBroker.adminCode);
      console.log('  Created At:', superBroker.createdAt.toLocaleString());
    } else {
      superBroker = await Admin.create({
        role: 'BROKER',
        username: 'superbroker',
        name: 'Super Broker',
        email: 'superbroker@stockex.com',
        phone: '9876543220',
        password: 'admin123',
        pin: '1234',
        wallet: { balance: 500000 },
        createdBy: superAdmin._id,
        parentId: superAdmin._id,
        hierarchyPath: [superAdmin._id],
        segmentPermissions: defaultSegmentPermissions
      });
      
      console.log('\n✓ Super Broker Created (directly under Super Admin)!');
      console.log('  Email: superbroker@stockex.com');
      console.log('  Password: admin123');
      console.log('  Admin Code:', superBroker.adminCode);
      console.log('  Created By: Super Admin');
      console.log('  Created At:', superBroker.createdAt.toLocaleString());
    }

    // ========== 4. SUB BROKER (created by Broker) ==========
    let subBroker = await Admin.findOne({ role: 'SUB_BROKER', username: 'demosubbroker' });
    
    if (subBroker) {
      console.log('\n✓ Demo Sub Broker (under Broker) already exists!');
      console.log('  Admin Code:', subBroker.adminCode);
      console.log('  Created At:', subBroker.createdAt.toLocaleString());
    } else {
      subBroker = await Admin.create({
        role: 'SUB_BROKER',
        username: 'demosubbroker',
        name: 'Demo Sub Broker',
        email: 'subbroker@stockex.com',
        phone: '9876543212',
        password: 'admin123',
        pin: '1234',
        wallet: { balance: 100000 }, // 1 Lakh initial balance
        createdBy: broker._id,
        parentId: broker._id,
        hierarchyPath: [superAdmin._id, admin._id, broker._id],
        segmentPermissions: defaultSegmentPermissions
      });
      
      console.log('\n✓ Demo Sub Broker Created (under Broker)!');
      console.log('  Email: subbroker@stockex.com');
      console.log('  Password: admin123');
      console.log('  Admin Code:', subBroker.adminCode);
      console.log('  Created By: Demo Broker');
      console.log('  Created At:', subBroker.createdAt.toLocaleString());
    }

    // ========== 4b. SUB BROKER (created directly by Admin) ==========
    let adminSubBroker = await Admin.findOne({ role: 'SUB_BROKER', username: 'adminsubbroker' });
    
    if (adminSubBroker) {
      console.log('\n✓ Admin Sub Broker (under Admin) already exists!');
      console.log('  Admin Code:', adminSubBroker.adminCode);
      console.log('  Created At:', adminSubBroker.createdAt.toLocaleString());
    } else {
      adminSubBroker = await Admin.create({
        role: 'SUB_BROKER',
        username: 'adminsubbroker',
        name: 'Admin Sub Broker',
        email: 'adminsubbroker@stockex.com',
        phone: '9876543230',
        password: 'admin123',
        pin: '1234',
        wallet: { balance: 100000 },
        createdBy: admin._id,
        parentId: admin._id,
        hierarchyPath: [superAdmin._id, admin._id],
        segmentPermissions: defaultSegmentPermissions
      });
      
      console.log('\n✓ Admin Sub Broker Created (directly under Admin)!');
          console.log('  Email: adminsubbroker@stockex.com');
      console.log('  Password: admin123');
      console.log('  Admin Code:', adminSubBroker.adminCode);
      console.log('  Created By: Demo Admin');
      console.log('  Created At:', adminSubBroker.createdAt.toLocaleString());
      }

    // ========== 4c. SUB BROKER (created directly by Super Admin) ==========
    let superSubBroker = await Admin.findOne({ role: 'SUB_BROKER', username: 'supersubbroker' });
    
    if (superSubBroker) {
      console.log('\n✓ Super Sub Broker (under Super Admin) already exists!');
      console.log('  Admin Code:', superSubBroker.adminCode);
      console.log('  Created At:', superSubBroker.createdAt.toLocaleString());
    } else {
      superSubBroker = await Admin.create({
        role: 'SUB_BROKER',
        username: 'supersubbroker',
        name: 'Super Sub Broker',
        email: 'supersubbroker@stockex.com',
        phone: '9876543240',
        password: 'admin123',
        pin: '1234',
        wallet: { balance: 100000 },
        createdBy: superAdmin._id,
        parentId: superAdmin._id,
        hierarchyPath: [superAdmin._id],
        segmentPermissions: defaultSegmentPermissions
      });
      
      console.log('\n✓ Super Sub Broker Created (directly under Super Admin)!');
      console.log('  Email: supersubbroker@stockex.com');
      console.log('  Password: admin123');
      console.log('  Admin Code:', superSubBroker.adminCode);
      console.log('  Created By: Super Admin');
      console.log('  Created At:', superSubBroker.createdAt.toLocaleString());
    }

    // ========== 5. SAMPLE USERS FOR EACH LEVEL ==========
    console.log('\n---------- Creating Sample Users ----------');

    // User under Admin
    let adminUser = await User.findOne({ username: 'adminuser1' });
    if (!adminUser) {
      adminUser = await User.create({
        username: 'adminuser1',
        email: 'adminuser1@stockex.com',
        password: 'user123',
        fullName: 'Admin User 1',
        phone: '9000000001',
        admin: admin._id,
        adminCode: admin.adminCode,
        creatorRole: 'ADMIN',
        hierarchyPath: [superAdmin._id, admin._id],
        createdBy: admin._id
      });
      console.log('\n✓ User created under Admin');
      console.log('  Email: adminuser1@stockex.com');
      console.log('  Password: user123');
      console.log('  Created At:', adminUser.createdAt.toLocaleString());
    } else {
      console.log('\n✓ Admin User already exists');
    }

    // User under Broker
    let brokerUser = await User.findOne({ username: 'brokeruser1' });
    if (!brokerUser) {
      brokerUser = await User.create({
        username: 'brokeruser1',
        email: 'brokeruser1@stockex.com',
        password: 'user123',
        fullName: 'Broker User 1',
        phone: '9000000002',
        admin: broker._id,
        adminCode: broker.adminCode,
        creatorRole: 'BROKER',
        hierarchyPath: [superAdmin._id, admin._id, broker._id],
        createdBy: broker._id
      });
      console.log('\n✓ User created under Broker');
      console.log('  Email: brokeruser1@stockex.com');
      console.log('  Password: user123');
      console.log('  Created At:', brokerUser.createdAt.toLocaleString());
    } else {
      console.log('\n✓ Broker User already exists');
    }

    // User under Sub Broker
    let subBrokerUser = await User.findOne({ username: 'subbrokeruser1' });
    if (!subBrokerUser) {
      subBrokerUser = await User.create({
        username: 'subbrokeruser1',
        email: 'subbrokeruser1@stockex.com',
        password: 'user123',
        fullName: 'Sub Broker User 1',
        phone: '9000000003',
        admin: subBroker._id,
        adminCode: subBroker.adminCode,
        creatorRole: 'SUB_BROKER',
        hierarchyPath: [superAdmin._id, admin._id, broker._id, subBroker._id],
        createdBy: subBroker._id
      });
      console.log('\n✓ User created under Sub Broker');
      console.log('  Email: subbrokeruser1@stockex.com');
      console.log('  Password: user123');
      console.log('  Created At:', subBrokerUser.createdAt.toLocaleString());
        } else {
      console.log('\n✓ Sub Broker User already exists');
    }

    // ========== 6. UPDATE EXISTING ADMINS WITH SEGMENT PERMISSIONS ==========
    console.log('\n---------- Updating Existing Admins with Segment Permissions ----------');
    
    const adminsWithoutSegments = await Admin.find({
      $or: [
        { segmentPermissions: { $exists: false } },
        { segmentPermissions: null },
        { segmentPermissions: { $eq: {} } }
      ]
    });
    
    if (adminsWithoutSegments.length > 0) {
      for (const a of adminsWithoutSegments) {
        await Admin.updateOne(
          { _id: a._id },
          { $set: { segmentPermissions: defaultSegmentPermissions } }
        );
        console.log(`  ✓ Updated ${a.name} (${a.role}) with default segment permissions`);
        console.log('  Created At:', a.createdAt.toLocaleString());
      }
    } else {
      // Also update admins whose segmentPermissions Map is empty (size 0)
      const allAdmins = await Admin.find({});
      let updated = 0;
      for (const a of allAdmins) {
        const segPerms = a.segmentPermissions;
        if (!segPerms || (segPerms instanceof Map && segPerms.size === 0) || Object.keys(segPerms).length === 0) {
          await Admin.updateOne(
            { _id: a._id },
            { $set: { segmentPermissions: defaultSegmentPermissions } }
          );
          console.log(`  ✓ Updated ${a.name} (${a.role}) with default segment permissions`);
          updated++;
        }
      }
      if (updated === 0) {
        console.log('  ✓ All admins already have segment permissions');
        console.log('  Created At:', new Date().toLocaleString());
                      }
    }

    // ========== SUMMARY ==========
    console.log('\n========================================');
    console.log('         HIERARCHY SUMMARY');
    console.log('========================================');
    console.log(`
SUPER_ADMIN (Level 0) - ${superAdmin.email} (Code: ${superAdmin.adminCode})
│
├── ADMIN (Level 1) - ${admin.email} (Code: ${admin.adminCode})
│   ├── User: ${adminUser.email}
│   ├── BROKER - ${broker.email} (Code: ${broker.adminCode})
│   │   ├── User: ${brokerUser.email}
│   │   └── SUB_BROKER - ${subBroker.email} (Code: ${subBroker.adminCode})
│   │       └── User: ${subBrokerUser.email}
│   └── SUB_BROKER - ${adminSubBroker.email} (Code: ${adminSubBroker.adminCode})
│
├── BROKER (directly under Super Admin) - ${superBroker.email} (Code: ${superBroker.adminCode})
│
└── SUB_BROKER (directly under Super Admin) - ${superSubBroker.email} (Code: ${superSubBroker.adminCode})

PERMISSIONS:
- SUPER_ADMIN can create: ADMIN, BROKER, SUB_BROKER
- ADMIN can create: BROKER, SUB_BROKER, Users
- BROKER can create: SUB_BROKER, Users
- SUB_BROKER can create: Users only
    `);
    console.log('========================================');
    console.log('All passwords: admin123 (for admins), user123 (for users)');
    console.log('========================================\n');

    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
};

seedHierarchy();
