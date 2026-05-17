import mongoose from 'mongoose';
import User from './models/User.js';

mongoose.connect('mongodb://localhost:27017/stockex')
  .then(async () => {
    console.log('Connected to MongoDB');
    
    // Show all users with their usedMargin
    const users = await User.find({}).select('userId wallet.usedMargin wallet.tradingBalance').sort({ createdAt: -1 });
    console.log('All users and their usedMargin:');
    users.forEach(u => console.log(u.userId, u.wallet.usedMargin, 'tradingBalance:', u.wallet.tradingBalance));
    
    await mongoose.connection.close();
    process.exit(0);
  })
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
