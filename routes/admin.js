const express = require('express');
const { verifyToken } = require('../middleware/auth');
const { restrictTo } = require('../middleware/role');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Place = require('../models/Place');


const router = express.Router();

// Sadece adminlerin'ların erişebileceği route
router.get('/dashboard', verifyToken, restrictTo('owner'), (req, res) => {
  res.json({
    message: 'Owner dashboarduna hoş geldiniz!',
    user: req.user
  });
});


router.post('/register-place', verifyToken, restrictTo('admin'), async (req, res) => {
  try {
    const { placeName } = req.body;
    
    const existingPlace = await Place.findOne({ placeName });
    if (existingPlace) {
      return res.status(400).json({ message: 'Bu mekan ismi ile zaten kayıt olunmuş.' });
    }
    
    const newPlace = new Place({
      placeName,
    });
    
    await newPlace.save();
    
    res.status(201).json({
      message: 'Mekan başarıyla oluşturuldu',
      place: {
        id: newPlace._id,
        placeName: newPlace.placeName,
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Sunucu hatası', error: error.message });
  }
});

router.get('/places', verifyToken, async (req, res) => {
  try {
    const places = await Place.find(); // populate yok, tüm dokümanlar

    res.status(200).json({
      count: places.length,
      places
    });
  } catch (error) {
    res.status(500).json({ message: 'Sunucu hatası', error: error.message });
  }
});

router.get('/owners', verifyToken, async (req, res) => {
  try {
    const owners = await User.find({ role: 'owner' }).select('username _id role'); // sadece gerekli alanları çek

    res.status(200).json({
      count: owners.length,
      owners
    });
  } catch (error) {
    res.status(500).json({ message: 'Sunucu hatası', error: error.message });
  }
});

// Owner oluşturma endpoint
router.post('/create-owner', verifyToken, restrictTo('admin'), async (req, res) => {
  try {
    const { username, password } = req.body;

    // username kontrolü
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ message: 'Bu username ile kullanıcı zaten var.' });
    }

    // owner kullanıcı oluştur
    const newUser = new User({
      username,
      password,
      role: 'owner'
    });

    await newUser.save();

    res.status(201).json({
      message: 'Owner kullanıcı başarıyla oluşturuldu',
      user: {
        id: newUser._id,
        username: newUser.username,
        role: newUser.role
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Sunucu hatası', error: error.message });
  }
});

router.put('/assign-owner-to-place', verifyToken, restrictTo('admin'), async (req, res) => {
  try {
    const { ownerId, placeId } = req.body;

    // Owner user
    const owner = await User.findById(ownerId);
    if (!owner || owner.role !== 'owner') {
      return res.status(400).json({ message: 'Geçerli bir owner bulunamadı.' });
    }

    // Place
    const place = await Place.findById(placeId);
    if (!place) {
      return res.status(400).json({ message: 'Geçerli bir place bulunamadı.' });
    }

    // Place’e owner ekle
    place.ownerId = owner._id;
    await place.save();

    // Owner’a place ekle (varsa duplicate kontrolü)
    if (!owner.placeIds) owner.placeIds = []; // Eğer array yoksa oluştur
    if (!owner.placeIds.includes(place._id)) {
      owner.placeIds.push(place._id);
      await owner.save();
    }

    res.status(200).json({
      message: `Owner ${owner.username} başarıyla ${place.placeName} mekanına atandı.`,
      place,
      owner
    });
  } catch (error) {
    res.status(500).json({ message: 'Sunucu hatası', error: error.message });
  }
});


module.exports = router;