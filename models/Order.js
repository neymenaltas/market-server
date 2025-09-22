const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  placeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Place',
    required: true
  },
  products: [
    {
      productId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true
      },
      productName: {
        type: String,
        required: true
      },
      soldPrice: { // o anki satış fiyatı
        type: Number,
        required: true
      },
      quantity: {
        type: Number,
        required: true,
        default: 1
      }
    }
  ],
  totalAmount: { // siparişin toplam tutarı
    type: Number,
    required: true
  },
  createdBy: { // siparişi giren kullanıcı (ör: worker)
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true // createdAt, updatedAt otomatik gelir
});

module.exports = mongoose.model('Order', orderSchema);
