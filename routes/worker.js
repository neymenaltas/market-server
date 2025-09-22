const express = require('express');
const { verifyToken } = require('../middleware/auth');
const { restrictTo } = require('../middleware/role');
const Order = require('../models/Order');
const Place = require('../models/Place');
const Product = require('../models/Product');

const router = express.Router();

router.post('/create-order', verifyToken, restrictTo('owner', 'worker'), async (req, res) => {
  try {
    const { placeId, products } = req.body;

    if (!placeId || !products || products.length === 0) {
      return res.status(400).json({ message: 'placeId ve en az bir ürün zorunludur.' });
    }

    // Mekan gerçekten var mı?
    const place = await Place.findById(placeId);
    if (!place) {
      return res.status(404).json({ message: 'Geçerli bir mekan bulunamadı.' });
    }

    // Toplam fiyat hesapla
    const totalAmount = products.reduce((sum, p) => sum + (p.soldPrice * (p.quantity || 1)), 0);

    // Sipariş oluştur
    const newOrder = new Order({
      placeId,
      products,
      totalAmount,
      createdBy: req.user.id
    });

    await newOrder.save();

    res.status(201).json({
      message: 'Sipariş başarıyla oluşturuldu.',
      order: newOrder
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Sunucu hatası', error: error.message });
  }
});

router.get('/get-orders/:userId', verifyToken, restrictTo('owner', 'worker'), async (req, res) => {
  try {
    const { userId } = req.params;

    // createdBy alanına göre filtrele ve user bilgilerini populate et
    const orders = await Order.find({ createdBy: userId })
      .populate({
        path: 'createdBy',
        select: 'username' // sadece username alanını getir
      })
      .select('products productName soldPrice quantity totalAmount placeId createdAt createdBy')
      .sort({ createdAt: -1 });

    // Orders'ı formatla - createdBy artık bir obje {_id, username}
    const formattedOrders = orders.map(order => ({
      ...order.toObject(),
      createdBy: order.createdBy.username // sadece username'i döndür
    }));

    res.status(200).json({
      count: orders.length,
      orders: formattedOrders
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Siparişler alınırken bir hata oluştu.' });
  }
});

router.delete('/orders/:orderId', verifyToken, restrictTo('worker', 'owner'), async (req, res) => {
  try {
    const { orderId } = req.params;

    // Silinmek istenen ürün var mı?
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: 'Silinmek istenen order bulunamadı.' });
    }

    // Silme işlemi
    await Order.findByIdAndDelete(orderId);

    res.status(200).json({ message: 'Order başarıyla silindi.' });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Sunucu hatası', error: error.message });
  }
});

module.exports = router;