import mongoose from 'mongoose';
import User from './models/User.js';

mongoose.connect('mongodb://localhost:27017/stockex')
  .then(async () => {
    console.log('Connected to MongoDB');
    
    const user = await User.findOne({}).sort({ createdAt: -1 });
    if (user) {
      console.log('Found user:', user.userId, 'Current usedMargin:', user.wallet.usedMargin);
      await User.updateOne({ _id: user._id }, { $set: { 'wallet.usedMargin': 0 } });
      console.log('✓ Reset usedMargin to 0 for user:', user.userId);
    } else {
      console.log('No user found');
    }
    
    await mongoose.connection.close();
    console.log('Done');
    process.exit(0);
  })
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
