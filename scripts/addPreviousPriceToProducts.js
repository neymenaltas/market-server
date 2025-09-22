const mongoose = require('mongoose');
const Product = require('../models/Product'); // Product modelinin path’i

async function addPreviousPriceField() {
  await mongoose.connect(process.env.MONGODB_URI);

  const result = await Product.updateMany(
    { previousPrice: { $exists: false } },
    { $set: { previousPrice: 0 } }
  );

  console.log('Updated products:', result.modifiedCount);

  await mongoose.disconnect();
}

addPreviousPriceField().catch(err => {
  console.error(err);
  mongoose.disconnect();
});