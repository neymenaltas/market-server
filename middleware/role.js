// Rol tabanlı erişim kontrolü
exports.restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        message: 'Bu işlem için gerekli izne sahip değilsiniz.'
      });
    }
    next();
  };
};