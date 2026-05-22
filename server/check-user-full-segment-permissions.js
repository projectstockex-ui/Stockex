import mongoose from 'mongoose';
import User from './models/User.js';

async function checkUserFullSegmentPermissions() {
  try {
    await mongoose.connect('mongodb://127.0.0.1:27017/stockex');
    console.log('Connected to MongoDB');

    const user = await User.findOne({ admin: '6a0c782af1036e000d763896' });
    
    if (!user) {
      console.log('User not found');
      process.exit(0);
    }

    console.log(`User: ${user.userId} (${user._id})`);
    
    if (user.segmentPermissions instanceof Map) {
      console.log('\nCRYPTOFUT:');
      const cryptofut = user.segmentPermissions.get('CRYPTOFUT');
      if (cryptofut) {
        console.log(JSON.stringify(cryptofut, null, 2));
      }
      
      console.log('\nCRYPTOOPT:');
      const cryptoopt = user.segmentPermissions.get('CRYPTOOPT');
      if (cryptoopt) {
        console.log(JSON.stringify(cryptoopt, null, 2));
      }
    } else if (user.segmentPermissions && typeof user.segmentPermissions === 'object') {
      console.log('\nCRYPTOFUT:');
      if (user.segmentPermissions.CRYPTOFUT) {
        console.log(JSON.stringify(user.segmentPermissions.CRYPTOFUT, null, 2));
      }
      
      console.log('\nCRYPTOOPT:');
      if (user.segmentPermissions.CRYPTOOPT) {
        console.log(JSON.stringify(user.segmentPermissions.CRYPTOOPT, null, 2));
      }
    }

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkUserFullSegmentPermissions();
