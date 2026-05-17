import User from './models/User.js';

mongoose.connect('mongodb://localhost:27017/stockex')
  .then(async () => {
    console.log('Connected to MongoDB');
    
    const users = await User.find({ 'wallet.usedMargin': { $gt: 0 } }).select('userId wallet.usedMargin');
    console.log('Users with usedMargin > 0:');
    users.forEach(u => console.log(u.userId, u.wallet.usedMargin));
    
    await mongoose.connection.close();
    process.exit(0);
  })
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
