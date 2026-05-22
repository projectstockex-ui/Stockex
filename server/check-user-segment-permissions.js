import mongoose from 'mongoose';
import User from './models/User.js';

async function checkUserSegmentPermissions() {
  try {
    await mongoose.connect('mongodb://127.0.0.1:27017/stockex');
    console.log('Connected to MongoDB');

    // Find a user under Ram
    const user = await User.findOne({ admin: '6a0c782af1036e000d763896' });
    
    if (!user) {
      console.log('No user found under Ram admin');
      process.exit(0);
    }

    console.log(`User: ${user.userId} (${user._id})`);
    console.log(`User segmentPermissions:`, user.segmentPermissions);
    
    if (user.segmentPermissions instanceof Map) {
      const cryptofut = user.segmentPermissions.get('CRYPTOFUT');
      if (cryptofut) {
        console.log(`User CRYPTOFUT timing: ${cryptofut.cryptoStartTime} - ${cryptofut.cryptoClosingTime}`);
      }
    } else if (user.segmentPermissions && typeof user.segmentPermissions === 'object') {
      if (user.segmentPermissions.CRYPTOFUT) {
        console.log(`User CRYPTOFUT timing: ${user.segmentPermissions.CRYPTOFUT.cryptoStartTime} - ${user.segmentPermissions.CRYPTOFUT.cryptoClosingTime}`);
      }
    }

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkUserSegmentPermissions();
