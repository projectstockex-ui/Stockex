import mongoose from 'mongoose';
import Admin from './models/Admin.js';

mongoose.connect('mongodb://127.0.0.1:27017/stockex')
  .then(async () => {
    console.log('Connected to MongoDB');
    
    // Find Manish
    const manish = await Admin.findOne({ name: 'manish' });
    if (!manish) {
      console.log('Manish not found');
      process.exit(1);
    }

    console.log('Manish found:', manish.name);

    // Use Mongoose dot notation to update nested field
    manish.set('segmentPermissions.NSEOPT.enabled', false);
    await manish.save();
    console.log('NSEOPT disabled for Manish');

    // Verify
    const updatedManish = await Admin.findOne({ name: 'manish' });
    console.log('NSEOPT enabled status after fix:', updatedManish.get('segmentPermissions.NSEOPT.enabled'));

    mongoose.connection.close();
    process.exit(0);
  })
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
