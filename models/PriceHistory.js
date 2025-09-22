const mongoose = require('mongoose');

const priceHistorySchema = new mongoose.Schema({
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  oldPrice: {
    type: Number,
    required: true
  },
  newPrice: {
    type: Number,
    required: true
  },
  changePercentage: {
    type: Number,
    required: true
  },
}, {
  timestamps: true
});


module.exports = mongoose.model('PriceHistory', priceHistorySchema);