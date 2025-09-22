const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Token doğrulama middleware'i
exports.verifyToken = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ message: 'Token bulunamadı. Yetkilendirme reddedildi.' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'gizli_anahtar');
    const user = await User.findById(decoded.id).select('-password');
    
    if (!user) {
      return res.status(401).json({ message: 'Token geçersiz.' });
    }
    
    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ message: 'Token geçersiz.' });
  }
};