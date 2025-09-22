const Product = require('../models/Product');
const PriceHistory = require('../models/PriceHistory');

class PriceUpdater {
  constructor() {
    this.intervals = new Map();
    this.isRunning = false;
    this.placeIntervals = new Map(); // Place bazlı interval takibi için
  }

  // Rastgele fiyat üretme (-%10 ile +%10 arası)
  generateRandomPrice(currentPrice, minPrice, maxPrice) {
    // Mevcut fiyata göre -%10 ve +%10 aralığı hesapla
    const min = currentPrice * 0.9;
    const max = currentPrice * 1.1;
    
    // 0.01'lik adımlarla rastgele fiyat
    let randomPrice = Math.random() * (max - min) + min;
    
    // Min ve max fiyat sınırlarını kontrol et
    if (minPrice !== undefined && minPrice !== null) {
      randomPrice = Math.max(minPrice, randomPrice);
    }
    
    if (maxPrice !== undefined && maxPrice !== null) {
      randomPrice = Math.min(maxPrice, randomPrice);
    }
    
    return Math.round(randomPrice * 100) / 100; // 2 ondalık basamak
  }

  // Tekil ürün fiyat güncelleme
  async updateProductPrice(productId) {
    try {
      const product = await Product.findById(productId);
      
      if (!product) {
        console.log(`Product with ID ${productId} not found`);
        return null;
      }

      // Eğer currentPrice yoksa, regularPrice'dan başlat
      if (product.currentPrice === undefined || product.currentPrice === null) {
        product.currentPrice = product.regularPrice;
        await product.save();
      }

      const oldPrice = product.currentPrice;
      let newPrice = this.generateRandomPrice(
        oldPrice, 
        product.minPrice, 
        product.maxPrice
      );

      // Fiyat değişim yüzdesi
      const changePercentage = ((newPrice - oldPrice) / oldPrice) * 100;

      // Ürün fiyatını güncelle
      product.previousPrice = oldPrice;
      product.currentPrice = newPrice;

      await product.save();

      // PriceHistory'ye kaydet
      const priceHistory = new PriceHistory({
        productId: product._id,
        oldPrice,
        newPrice,
        changePercentage: parseFloat(changePercentage.toFixed(2))
      });

      await priceHistory.save();

      console.log(`Product ${product.productName} price updated: ${oldPrice} -> ${newPrice} (${changePercentage.toFixed(2)}%)`);

      return { product, priceHistory };

    } catch (error) {
      console.error('Error updating product price:', error);
      throw error;
    }
  }

  // Belirli bir yer (place) için ürün fiyatlarını güncelle
  async updateProductsByPlace(placeId) {
    try {
      const products = await Product.find({ placeId });
      
      const results = [];
      for (const product of products) {
        const result = await this.updateProductPrice(product._id);
        if (result) {
          results.push(result);
        }
      }

      return results;
    } catch (error) {
      console.error('Error updating products by place:', error);
      throw error;
    }
  }

  // Belirli bir yer (place) için ürün fiyat interval'lerini başlat
  async startPlaceIntervals(placeId, intervalMs = 30000) {
    try {
      // Önce bu place'a ait tüm interval'leri durdur
      await this.stopPlaceIntervals(placeId);

      const products = await Product.find({ placeId });
      
      if (products.length === 0) {
        console.log(`No products found for place ${placeId}`);
        return;
      }

      // Place için ana interval oluştur
      const interval = setInterval(async () => {
        console.log(`Running scheduled update for place ${placeId}`);
        await this.updateProductsByPlace(placeId);
      }, intervalMs);

      // Interval'i kaydet
      this.placeIntervals.set(placeId, interval);
      this.isRunning = true;
      
      console.log(`Started price updates for ${products.length} products in place ${placeId} every ${intervalMs}ms`);
      
      // Hemen bir güncelleme çalıştır
      await this.updateProductsByPlace(placeId);
      
    } catch (error) {
      console.error('Error starting place intervals:', error);
      throw error;
    }
  }

  // Belirli bir ürün için interval başlat (isteğe bağlı)
  startProductInterval(productId, intervalMs) {
    // Önce varsa mevcut interval'i temizle
    this.stopProductInterval(productId);

    const interval = setInterval(async () => {
      await this.updateProductPrice(productId);
    }, intervalMs);

    this.intervals.set(productId, interval);
    console.log(`Started price updates for product ${productId} every ${intervalMs}ms`);
  }

  // Belirli bir yer (place) için tüm interval'leri durdur
  async stopPlaceIntervals(placeId) {
    try {
      // Place için ana interval'i durdur
      if (this.placeIntervals.has(placeId)) {
        clearInterval(this.placeIntervals.get(placeId));
        this.placeIntervals.delete(placeId);
        console.log(`Stopped price updates for all products in place ${placeId}`);
      }

      // Bu place'a ait tüm ürün interval'lerini durdur
      const products = await Product.find({ placeId });
      for (const product of products) {
        this.stopProductInterval(product._id);
      }


      // Eğer hiç interval kalmadıysa
      if (this.placeIntervals.size === 0 && this.intervals.size === 0) {
        this.isRunning = false;
      }
      
    } catch (error) {
      console.error('Error stopping place intervals:', error);
      throw error;
    }
  }

  // Belirli ürünün interval'ini durdur
  stopProductInterval(productId) {
    if (this.intervals.has(productId)) {
      clearInterval(this.intervals.get(productId));
      this.intervals.delete(productId);
      console.log(`Stopped price updates for product ${productId}`);
    }
  }

  // Tüm interval'leri durdur
  stopAllIntervals() {
    // Tüm place interval'lerini durdur
    this.placeIntervals.forEach((interval, placeId) => {
      clearInterval(interval);
    });
    this.placeIntervals.clear();
    
    // Tüm ürün interval'lerini durdur
    this.intervals.forEach((interval, productId) => {
      clearInterval(interval);
    });
    this.intervals.clear();
    
    this.isRunning = false;
    console.log('Stopped all price update intervals');
  }

  // Aktif interval'leri getir
  getActiveIntervals() {
    return {
      placeIntervals: Array.from(this.placeIntervals.keys()),
      productIntervals: Array.from(this.intervals.keys())
    };
  }

  // Çalışma durumunu kontrol et
  getStatus() {
    return {
      isRunning: this.isRunning,
      activePlaceIntervals: this.placeIntervals.size,
      activeProductIntervals: this.intervals.size,
      placeIds: Array.from(this.placeIntervals.keys()),
      productIds: Array.from(this.intervals.keys())
    };
  }

  // Belirli bir place için durum kontrolü
  async getPlaceStatus(placeId) {
    const products = await Product.find({ placeId });
    const activeIntervals = this.getActiveIntervals();
    
    const activeProducts = products.filter(product => 
      activeIntervals.productIntervals.includes(product._id.toString())
    );
    
    const hasPlaceInterval = activeIntervals.placeIntervals.includes(placeId);
    
    return {
      placeId,
      hasActiveInterval: hasPlaceInterval,
      totalProducts: products.length,
      activeProducts: activeProducts.length,
      productDetails: activeProducts.map(p => ({
        id: p._id,
        name: p.productName,
        currentPrice: p.currentPrice
      }))
    };
  }
}

module.exports = new PriceUpdater();

// Tüm ürünler için 30 saniyede bir fiyat güncelleme başlat
//priceUpdater.startAllProductsIntervals(30000);

// Sadece belirli bir mekana (place) ait ürünler için fiyat güncelleme başlat
//priceUpdater.startPlaceIntervals('placeId123', 30000);

// Belirli bir ürün için fiyat güncelleme başlat
//priceUpdater.startProductInterval('productId456', 30000);

// Tüm fiyat güncellemelerini durdur
//priceUpdater.stopAllIntervals();

// Sadece belirli bir mekana (place) ait ürün güncellemelerini durdur
//priceUpdater.stopPlaceIntervals('placeId123');

// Sistem durumunu kontrol et
//const status = priceUpdater.getStatus();
//console.log(status);