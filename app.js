const express = require('express');
const app = express();
const mongoose = require('mongoose');
const cors = require("cors");
const http = require('http');
const socketIo = require('socket.io');
const DatabaseWatcher = require('./services/databaseWatcher');

const server = http.createServer(app); // HTTP server oluştur
const io = socketIo(server, { // Socket.io'yu HTTP server ile başlat
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

require('dotenv').config();

const PORT = process.env.PORT || 3000;

const authRoutes = require('./routes/auth');
const ownerRoutes = require('./routes/owner');
const workerRoutes = require('./routes/worker');
const adminRoutes = require('./routes/admin');

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// MongoDB bağlantısı
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('MongoDB bağlantısı başarılı'))
.catch(err => console.log('MongoDB bağlantı hatası:', err));

// DatabaseWatcher oluştur
const dbWatcher = new DatabaseWatcher(io);

// WebSocket bağlantılarını yönetme
io.on('connection', (socket) => {
  console.log('Yeni bir istemci bağlandı:', socket.id);

  // İstemci belirli bir mekanı dinlemek istediğinde
  socket.on('subscribe-to-place', async (placeId) => {
    try {
      socket.join(placeId);
      console.log(`İstemci ${socket.id} ${placeId} mekanını dinlemeye başladı`);
      
      // Bu mekan için change stream başlat (eğer henüz başlatılmadıysa)
      if (!dbWatcher.getActiveWatches().includes(placeId)) {
        await dbWatcher.watchPlaceProducts(placeId);
      }
      
      // Bağlantı anında mevcut ürün fiyatlarını gönder
      const Product = require('./models/Product');
      const products = await Product.find({ placeId });
      socket.emit('initial-prices', products);
      
    } catch (error) {
      console.error('Mekan dinleme hatası:', error);
      socket.emit('error', { message: 'Mekan dinlenirken hata oluştu' });
    }
  });

  // İstemci bir mekanı dinlemeyi bırakmak istediğinde
  socket.on('unsubscribe-from-place', (placeId) => {
    socket.leave(placeId);
    console.log(`İstemci ${socket.id} ${placeId} mekanını dinlemeyi bıraktı`);
    
    // Eğer bu mekanı dinleyen başka istemci kalmadıysa
    const room = io.sockets.adapter.rooms.get(placeId);
    if (!room || room.size === 0) {
      dbWatcher.stopWatchingPlace(placeId);
    }
  });

  // İstemci bağlantıyı kapatınca
  socket.on('disconnect', () => {
    console.log('İstemci bağlantıyı kapattı:', socket.id);
  });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/owner', ownerRoutes);
app.use('/api/worker', workerRoutes);
app.use('/api/admin', adminRoutes);

// Basit bir route
app.get('/', (req, res) => {
  res.json({ message: 'Node.js Projesine Hoş Geldiniz!' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: 'Route bulunamadı' });
});

// DÜZELTME: server.listen kullanın, app.listen değil
server.listen(PORT, () => {
  console.log(`Server ${PORT} portunda çalışıyor...`);
});