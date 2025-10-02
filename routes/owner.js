const express = require('express');
const { verifyToken } = require('../middleware/auth');
const { restrictTo } = require('../middleware/role');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Place = require('../models/Place');
const Product = require('../models/Product');
const Order = require('../models/Order');
const priceUpdater = require('../services/PriceUpdater');

const router = express.Router();

// Sadece owner'ların yapabileceği başka bir işlem
router.post('/register-worker', verifyToken, restrictTo('owner'), async (req, res) => {
  try {
    const { username, password, placeId } = req.body;

    if (!placeId) {
      return res.status(400).json({ message: 'PlaceId zorunludur.' });
    }

    // Kullanıcı var mı kontrol et
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ message: 'Bu username ile zaten kayıt olunmuş.' });
    }


    // Yeni worker oluştur
    const newUser = new User({
      username,
      password: password,
      placeIds: [placeId],
      role: "worker"
    });

    await newUser.save();

    res.status(201).json({
      message: 'Kullanıcı başarıyla oluşturuldu',
      user: {
        id: newUser._id,
        username: newUser.username,
        placeIds: newUser.placeIds,
        role: newUser.role
      }
    });

  } catch (error) {
    res.status(500).json({ message: 'Sunucu hatası', error: error.message });
  }
});

router.get('/places/:userId', verifyToken, restrictTo('owner'), async (req, res) => {
  try {
    const { userId } = req.params;

    // Sadece ownerId eşleşen placelar
    const places = await Place.find({ ownerId: userId });

    res.status(200).json({
      count: places.length,
      places
    });
  } catch (error) {
    res.status(500).json({ message: 'Sunucu hatası', error: error.message });
  }
});

router.get('/workers/:placeId', verifyToken, restrictTo('owner'), async (req, res) => {
  try {
    const { placeId } = req.params;

    // placeId'ye sahip tüm workerlar
    const workers = await User.find({ 
      role: 'worker', 
      placeIds: placeId 
    }).select('username role');

    res.status(200).json({
      count: workers.length,
      workers
    });
  } catch (error) {
    res.status(500).json({ message: 'Sunucu hatası', error: error.message });
  }
});

router.post('/:placeId/register-product', verifyToken, restrictTo('owner'), async (req, res) => {
  try {
    const { placeId } = req.params;
    const { productName, regularPrice, minPrice, maxPrice } = req.body;

    // Place gerçekten var mı?
    const place = await Place.findById(placeId);
    if (!place) {
      return res.status(404).json({ message: 'Geçerli bir mekan bulunamadı.' });
    }

    // Bu mekan gerçekten bu owner’a mı ait?
    if (place.ownerId.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Bu mekana ürün ekleme yetkiniz yok.' });
    }

    // Ürün oluştur
    const newProduct = new Product({
      productName,
      placeId,
      regularPrice,
      currentPrice: regularPrice,
      minPrice,
      maxPrice
    });

    await newProduct.save();

    res.status(201).json({
      message: 'Ürün başarıyla eklendi.',
      product: newProduct
    });

  } catch (error) {
    // Duplicate product hatası
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Bu mekanda bu ürün zaten mevcut.' });
    }
    res.status(500).json({ message: 'Sunucu hatası', error: error.message });
  }
});

router.get('/products/:placeId', verifyToken, restrictTo('owner', 'worker'), async (req, res) => {
  try {
    const { placeId } = req.params;

    // placeId'ye sahip tüm workerlar
    const products = await Product.find({ 
      placeId: placeId 
    }).select('productName regularPrice currentPrice previousPrice minPrice maxPrice placeId');

    res.status(200).json({
      count: products.length,
      products
    });
  } catch (error) {
    res.status(500).json({ message: 'Sunucu hatası', error: error.message });
  }
});

router.delete('/workers/:workerId', verifyToken, restrictTo('owner'), async (req, res) => {
  try {
    const { workerId } = req.params;

    // Silinmek istenen kullanıcı var mı?
    const worker = await User.findById(workerId);
    if (!worker) {
      return res.status(404).json({ message: 'Silinmek istenen worker bulunamadı.' });
    }

    // Worker rolü kontrolü
    if (worker.role !== 'worker') {
      return res.status(400).json({ message: 'Bu kullanıcı bir worker değil.' });
    }

    // Eğer owner sadece kendi mekanındaki worker'ı silebilsin istiyorsan:
    const ownerPlaces = req.user.placeIds.map(id => id.toString());
    const workerPlaces = worker.placeIds.map(id => id.toString());

    const ortakPlace = workerPlaces.some(p => ownerPlaces.includes(p));
    if (!ortakPlace) {
      return res.status(403).json({ message: 'Bu worker sizin mekanlarınıza ait değil, silemezsiniz.' });
    }

    // Silme işlemi
    await User.findByIdAndDelete(workerId);

    res.status(200).json({ message: 'Worker başarıyla silindi.' });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Sunucu hatası', error: error.message });
  }
});

router.delete('/products/:productId', verifyToken, restrictTo('owner'), async (req, res) => {
  try {
    const { productId } = req.params;

    // Silinmek istenen ürün var mı?
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ message: 'Silinmek istenen product bulunamadı.' });
    }

    // Silme işlemi
    await Product.findByIdAndDelete(productId);

    res.status(200).json({ message: 'Product başarıyla silindi.' });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Sunucu hatası', error: error.message });
  }
});

router.post('/start-exchange/:placeId', verifyToken, restrictTo('owner'), async (req, res) => {
  try {
    const { placeId } = req.params;

    const place = await Place.findById(placeId);
    if (!place) {
      return res.status(404).json({ 
        success: false,
        message: 'Geçerli bir mekan bulunamadı.' 
      });
    }

    const products = await Product.find({ placeId });
    if (products.length === 0) {
      return res.status(404).json({ 
        success: false,
        message: 'Bu mekanda herhangi bir ürün bulunamadı.' 
      });
    }

    // Periyodik dengeleme başlat (5 dakikada bir sipariş sayılarını azaltır)
    priceUpdater.startRebalanceInterval(placeId, 300000);

    res.status(200).json({
      success: true,
      message: 'Sipariş bazlı fiyatlandırma sistemi aktif.',
      data: {
        place: place.name,
        productCount: products.length,
        rebalanceInterval: 300000
      }
    });

  } catch (error) {
    console.error('Fiyat güncelleme hatası:', error);
    res.status(500).json({ 
      success: false,
      message: 'Sunucu hatası', 
      error: error.message 
    });
  }
});

// Dinamik fiyatlandırmayı durdurma endpoint'i
router.post('/stop-exchange/:placeId', verifyToken, restrictTo('owner'), async (req, res) => {
  try {
    const { placeId } = req.params;

    // Place gerçekten var mı?
    const place = await Place.findById(placeId);
    if (!place) {
      return res.status(404).json({ 
        success: false,
        message: 'Geçerli bir mekan bulunamadı.' 
      });
    }

    // Fiyat güncelleme interval'ini durdur
    priceUpdater.stopPlaceIntervals(placeId);

    res.status(200).json({
      success: true,
      message: 'Fiyat güncelleme işlemi durduruldu.',
      data: {
        place: place.name
      }
    });

  } catch (error) {
    console.error('Fiyat güncelleme durdurma hatası:', error);
    res.status(500).json({ 
      success: false,
      message: 'Sunucu hatası', 
      error: error.message 
    });
  }
});

router.put('product/:productId', async (req, res) => {
  try {
    const { productId } = req.params;
    
    // Güncellenmesine izin verilen alanlar
    const allowedUpdates = {
      productName: req.body.productName,
      regularPrice: req.body.regularPrice,
      currentPrice: req.body.currentPrice,
      previousPrice: req.body.previousPrice,
      minPrice: req.body.minPrice,
      maxPrice: req.body.maxPrice
    };
    
    // PlaceId'nin değiştirilmesine izin vermiyoruz
    if (req.body.placeId) {
      return res.status(400).json({ 
        error: 'PlaceId değiştirilemez' 
      });
    }
    
    // Ürünü bul ve güncelle
    const product = await Product.findByIdAndUpdate(
      productId,
      { $set: allowedUpdates },
      { 
        new: true, // Güncellenmiş dokümanı döndür
        runValidators: true // Şema validasyonlarını çalıştır
      }
    );
    
    if (!product) {
      return res.status(404).json({ 
        error: 'Ürün bulunamadı' 
      });
    }
    
    res.status(200).json({
      message: 'Ürün başarıyla güncellendi',
      product
    });
    
  } catch (error) {
    console.error('Ürün güncelleme hatası:', error);
    
    if (error.name === 'CastError') {
      return res.status(400).json({ 
        error: 'Geçersiz ürün ID formatı' 
      });
    }
    
    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(val => val.message);
      return res.status(400).json({ 
        error: 'Validasyon hatası', 
        details: errors 
      });
    }
    
    if (error.code === 11000) {
      return res.status(400).json({ 
        error: 'Bu isimde bir ürün zaten mevcut' 
      });
    }
    
    res.status(500).json({ 
      error: 'Sunucu hatası' 
    });
  }
});

router.put('/user/:userId', verifyToken, restrictTo('owner'), async (req, res) => {
  try {
    const { userId } = req.params;
    const { username, password } = req.body;

    // Gerekli alanları kontrol et
    if (!username) {
      return res.status(400).json({ message: 'Username zorunludur.' });
    }

    // Kullanıcıyı bul
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'Kullanıcı bulunamadı.' });
    }

    // Eğer username değiştiyse, yeni username'in benzersiz olduğunu kontrol et
    if (username !== user.username) {
      const existingUser = await User.findOne({ username });
      if (existingUser) {
        return res.status(400).json({ message: 'Bu username zaten kullanılıyor.' });
      }
    }

    // Güncelleme nesnesini hazırla
    const updateData = { username };
    
    // Eğer şifre verildiyse, şifreyi de güncelle (hash'le)
    if (password) {
      const saltRounds = 10;
      updateData.password = await bcrypt.hash(password, saltRounds);
    }

    // Kullanıcıyı güncelle
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      updateData,
      { 
        new: true, // Güncellenmiş dokümanı döndür
        runValidators: true // Şema validasyonlarını çalıştır
      }
    ).select('-password'); // Şifre alanını döndürme

    res.status(200).json({
      message: 'Kullanıcı başarıyla güncellendi',
      user: updatedUser
    });

  } catch (error) {
    console.error('Kullanıcı güncelleme hatası:', error);
    
    if (error.name === 'CastError') {
      return res.status(400).json({ message: 'Geçersiz kullanıcı ID formatı.' });
    }
    
    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({ message: 'Validasyon hatası', errors });
    }
    
    res.status(500).json({ message: 'Sunucu hatası', error: error.message });
  }
});

router.post('/reset-prices/:placeId', verifyToken, restrictTo('owner'), async (req, res) => {
  try {
    const { placeId } = req.params;
    priceUpdater.resetOrderCounts(placeId);

    res.status(200).json({
      success: true,
      message: 'Sipariş verileri ve fiyat momentum bilgileri sıfırlandı'
    });

  } catch (error) {
    console.error('Sıfırlama hatası:', error);
    res.status(500).json({ 
      success: false,
      message: 'Sunucu hatası', 
      error: error.message 
    });
  }
});

// Owner'ın kendi mekanındaki tüm siparişleri görüntüleme
router.get('/get-orders/:placeId', verifyToken, restrictTo('owner'), async (req, res) => {
  try {
    const { placeId } = req.params;
    const ownerId = req.user.id;

    // Önce mekanın gerçekten bu owner'a ait olduğunu kontrol et
    const place = await Place.findOne({ 
      _id: placeId, 
      ownerId: ownerId 
    });

    if (!place) {
      return res.status(404).json({ 
        message: 'Mekan bulunamadı veya bu mekan üzerinde yetkiniz yok.' 
      });
    }

    // Bu mekana ait tüm siparişleri getir
    const orders = await Order.find({ placeId })
      .populate({
        path: 'createdBy',
        select: 'username' // siparişi oluşturan kullanıcı bilgisi
      })
      .select('products productName soldPrice quantity totalAmount placeId table createdAt createdBy')
      .sort({ createdAt: -1 }); // en yeni siparişler üstte

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



module.exports = router;