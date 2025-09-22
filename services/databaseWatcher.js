const Product = require('../models/Product');

class DatabaseWatcher {
  constructor(ioInstance) {
    this.io = ioInstance;
    this.watchers = new Map();
    this.lastPrices = new Map();
    this.pendingUpdates = new Map(); // Batch güncellemeler için
  }

  // Belirli bir mekandaki ürün değişikliklerini izle (polling ile)
  async watchPlaceProducts(placeId) {
    try {
      // Önce mevcut bir izleyici varsa kapat
      this.stopWatchingPlace(placeId);

      console.log(`Place ${placeId} ürün değişiklikleri izlenmeye başlandı (polling)`);

      // İlk fiyatları kaydet
      const products = await Product.find({ placeId });
      products.forEach(product => {
        this.lastPrices.set(product._id.toString(), product.currentPrice);
      });

      // Polling interval'i oluştur (5 saniyede bir kontrol et)
      const interval = setInterval(async () => {
        try {
          await this.checkPriceChanges(placeId);
        } catch (error) {
          console.error('Polling hatası:', error);
        }
      }, 5000); // 5 saniyede bir

      // İzleyiciyi kaydet
      this.watchers.set(placeId, interval);

    } catch (error) {
      console.error('Watcher oluşturulurken hata:', error);
      throw error;
    }
  }

  // Fiyat değişikliklerini kontrol et ve batch olarak gönder
  async checkPriceChanges(placeId) {
    try {
      const currentProducts = await Product.find({ placeId });
      const priceChanges = [];

      currentProducts.forEach(product => {
        const productId = product._id.toString();
        const lastPrice = this.lastPrices.get(productId);
        const currentPrice = product.currentPrice;

        // Fiyat değişti mi kontrol et
        if (lastPrice !== undefined && lastPrice !== currentPrice) {
          console.log(`Ürün ${productId} fiyat değişti: ${lastPrice} -> ${currentPrice}`);
          
          // Değişim yüzdesini hesapla
          let changePercentage = 0;
          if (lastPrice && lastPrice > 0) {
            changePercentage = ((currentPrice - lastPrice) / lastPrice) * 100;
          }

          priceChanges.push({
            productId: productId,
            productName: product.productName,
            oldPrice: lastPrice,
            newPrice: currentPrice,
            changePercentage: parseFloat(changePercentage.toFixed(2)),
            updatedAt: new Date()
          });

          // Yeni fiyatı kaydet
          this.lastPrices.set(productId, currentPrice);
        }
      });

      // Eğer değişiklik varsa, hepsini tek seferde gönder
      if (priceChanges.length > 0) {
        console.log(`${priceChanges.length} ürün fiyat değişikliği gönderiliyor...`);
        
        // Tek tek gönder (daha güvenilir)
        priceChanges.forEach((change, index) => {
          setTimeout(() => {
            this.io.to(placeId).emit('price-update', change);
            console.log(`Gönderildi: ${change.productName} - ${change.oldPrice} -> ${change.newPrice}`);
          }, index * 100); // Her bir event'i 100ms arayla gönder
        });

        // Alternatif: Toplu gönderim
        this.io.to(placeId).emit('bulk-price-update', {
          placeId: placeId,
          updates: priceChanges,
          timestamp: new Date()
        });
      }

    } catch (error) {
      console.error('Fiyat kontrolü hatası:', error);
    }
  }

  // Belirli bir mekanın izlemesini durdur
  stopWatchingPlace(placeId) {
    if (this.watchers.has(placeId)) {
      clearInterval(this.watchers.get(placeId));
      this.watchers.delete(placeId);
      
      // Bu place'a ait fiyat kayıtlarını temizle
      const products = Array.from(this.lastPrices.keys());
      // Bu kısmı optimize etmek için place bilgisini de saklayabilirsiniz
      
      console.log(`Place ${placeId} izlemesi durduruldu`);
    }
  }

  // Tüm izlemeleri durdur
  stopAllWatching() {
    this.watchers.forEach((interval, placeId) => {
      clearInterval(interval);
      console.log(`Place ${placeId} izlemesi durduruldu`);
    });
    this.watchers.clear();
    this.lastPrices.clear();
    this.pendingUpdates.clear();
  }

  // Aktif izlemeleri getir
  getActiveWatches() {
    return Array.from(this.watchers.keys());
  }

  // Belirli bir place'deki tüm ürünlerin mevcut durumunu getir
  async getPlaceProductsSnapshot(placeId) {
    try {
      const products = await Product.find({ placeId });
      return products.map(product => ({
        productId: product._id.toString(),
        productName: product.productName,
        currentPrice: product.currentPrice,
        previousPrice: product.previousPrice,
        lastTrackedPrice: this.lastPrices.get(product._id.toString())
      }));
    } catch (error) {
      console.error('Snapshot alınırken hata:', error);
      return [];
    }
  }

  // Manuel fiyat senkronizasyonu
  async syncPricesForPlace(placeId) {
    try {
      const products = await Product.find({ placeId });
      products.forEach(product => {
        this.lastPrices.set(product._id.toString(), product.currentPrice);
      });
      console.log(`${products.length} ürün fiyatı senkronize edildi (Place: ${placeId})`);
    } catch (error) {
      console.error('Fiyat senkronizasyonu hatası:', error);
    }
  }
}

module.exports = DatabaseWatcher;