const mongoose = require('mongoose');
const User = require('../models/User'); // User modelinin path’i

async function addPlaceIdsField() {
  await mongoose.connect(process.env.MONGODB_URI);

  const result = await User.updateMany(
    { placeIds: { $exists: false } },
    { $set: { placeIds: [] } }
  );

  console.log('Updated users:', result.modifiedCount);

  await mongoose.disconnect();
}

addPlaceIdsField().catch(err => {
  console.error(err);
  mongoose.disconnect();
});