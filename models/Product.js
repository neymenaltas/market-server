const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  productName: {
    type: String,
    required: true,
  },
  placeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Place',
    required: true
  },
  regularPrice: {
    type: Number,
    required: true
  },
  currentPrice: {
    type: Number,
  },
  previousPrice: {
    type: Number,
  },
  minPrice: {
    type: Number,
  },
  maxPrice: {
    type: Number,
  }
}, {
  timestamps: true
});

productSchema.index({ placeId: 1, productName: 1 }, { unique: true });

module.exports = mongoose.model('Product', productSchema);
