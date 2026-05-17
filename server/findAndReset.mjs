import mongoose from 'mongoose';
import User from './models/User.js';

mongoose.connect('mongodb://localhost:27017/stockex')
  .then(async () => {
    console.log('Connected to MongoDB');
    
    // Find user with usedMargin 78,164.98
    const user = await User.findOne({ 'wallet.usedMargin': 78164.98 }).select('userId wallet.usedMargin');
    if (user) {
      console.log('Found user with stale usedMargin:', user.userId, user.wallet.usedMargin);
      await User.updateOne({ _id: user._id }, { $set: { 'wallet.usedMargin': 0 } });
      console.log('✓ Reset usedMargin to 0 for user:', user.userId);
    } else {
      console.log('No user found with usedMargin 78,164.98');
      // Show all users with usedMargin > 0
      const users = await User.find({ 'wallet.usedMargin': { $gt: 0 } }).select('userId wallet.usedMargin');
      console.log('All users with usedMargin > 0:');
      users.forEach(u => console.log(u.userId, u.wallet.usedMargin));
    }
    
    await mongoose.connection.close();
    process.exit(0);
  })
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
