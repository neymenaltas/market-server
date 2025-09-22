const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

// JWT token oluşturma
const signToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET || 'gizli_anahtar', {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  });
};

// Kayıt olma
router.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Kullanıcı var mı kontrol et
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ message: 'Bu email ile zaten kayıt olunmuş.' });
    }
    
    // Yeni kullanıcı oluştur
    const newUser = new User({
      username,
      password,
      role: "worker"
    });
    
    await newUser.save();
    
    // Token oluştur
    const token = signToken(newUser._id);
    
    res.status(201).json({
      message: 'Kullanıcı başarıyla oluşturuldu',
      token,
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

// Giriş yapma
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Kullanıcıyı bul ve şifreyi kontrol et
    const user = await User.findOne({ username }).select('+password');
    if (!user || !(await user.correctPassword(password, user.password))) {
      return res.status(401).json({ message: 'Email veya şifre hatalı' });
    }
    
    // Token oluştur
    const token = signToken(user._id);
    
    res.json({
      message: 'Giriş başarılı',
      token,
      user: {
        id: user._id,
        username: user.username,
        role: user.role,
        placeIds: user.placeIds
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Sunucu hatası', error: error.message });
  }
});

// Mevcut kullanıcıyı getirme
router.get('/me', verifyToken, async (req, res) => {
  res.json({
    user: req.user
  });
});

module.exports = router;