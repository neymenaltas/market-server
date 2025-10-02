const Product = require('../models/Product');
const PriceHistory = require('../models/PriceHistory');
const Order = require('../models/Order'); // Sipariş modeliniz

class PriceUpdater {
  constructor() {
    this.intervals = new Map();
    this.isRunning = false;
    this.placeIntervals = new Map();
    // Her ürün için sipariş sayacı
    this.orderCounts = new Map();
    // Fiyat momentum takibi (trend)
    this.priceMomentum = new Map();
  }

  // Sipariş bazlı fiyat hesaplama
  calculateOrderBasedPrice(product, orderCount, totalOrders) {
    const { currentPrice, minPrice, maxPrice, regularPrice } = product;
    
    // Güvenli varsayılan değerler
    const min = minPrice || regularPrice * 0.7;
    const max = maxPrice || regularPrice * 1.5;
    const current = currentPrice || regularPrice;
    
    // Ürünün toplam siparişler içindeki oranı (0-1 arası)
    const orderRatio = totalOrders > 0 ? orderCount / totalOrders : 0;
    
    // Mevcut fiyatın min-max aralığındaki konumu (0-1 arası)
    const pricePosition = (current - min) / (max - min);
    
    // Sipariş yoğunluğuna göre hedef konum belirleme
    // orderRatio yüksekse -> maxPrice'a yaklaşmalı
    // orderRatio düşükse -> minPrice'a yaklaşmalı
    let targetPosition;
    
    if (orderRatio > 0.3) {
      // Popüler ürün: fiyat yükselmeli (DAHA YAVAS)
      targetPosition = 0.4 + (orderRatio * 0.4); // 0.4 ile 0.8 arası (önceden 0.5-1.0)
    } else if (orderRatio < 0.1) {
      // Az sipariş alan ürün: fiyat düşmeli (DAHA HIZLI)
      targetPosition = orderRatio * 3; // 0 ile 0.3 arası (önceden 0-0.5)
    } else {
      // Orta seviye: düşüşe meyilli
      targetPosition = 0.25 + (orderRatio * 0.5); // 0.25-0.4 arası (önceden 0.3-1.0)
    }
    
    // Momentum faktörü: ani fiyat değişimlerini önle
    const momentumKey = product._id.toString();
    const previousMomentum = this.priceMomentum.get(momentumKey) || pricePosition;
    
    // Yavaş geçiş (momentum smoothing)
    // Düşüşte daha hızlı, yükselişte daha yavaş
    let changeSpeed;
    if (targetPosition < previousMomentum) {
      // Fiyat düşüyorsa: DAHA HIZLI
      changeSpeed = 0.25 + (orderRatio * 0.10); // %25-35 hızla düşer
    } else {
      // Fiyat yükseliyorsa: DAHA YAVAS
      changeSpeed = 0.08 + (orderRatio * 0.12); // %8-20 hızla yükselir
    }
    
    const smoothedPosition = previousMomentum + ((targetPosition - previousMomentum) * changeSpeed);
    
    // Momentum güncelle
    this.priceMomentum.set(momentumKey, smoothedPosition);
    
    // Yeni fiyat hesapla
    let newPrice = min + (smoothedPosition * (max - min));
    
    // Ekstrem değişimleri sınırla (düşüş için %7, yükseliş için %3)
    let maxChange;
    if (newPrice < current) {
      // Düşüşte daha fazla hareket
      maxChange = current * 0.1; // %10'ye kadar düşebilir
    } else {
      // Yükselişte daha az hareket
      maxChange = current * 0.05; // %5'e kadar yükselebilir
    }
    
    if (Math.abs(newPrice - current) > maxChange) {
      newPrice = current + (Math.sign(newPrice - current) * maxChange);
    }
    
    // Min-max sınırlarına uygunluğu garanti et
    newPrice = Math.max(min, Math.min(max, newPrice));
    
    return Math.round(newPrice * 100) / 100;
  }

  // Sipariş alındığında fiyatları güncelle
  async updatePricesOnOrder(orderedProductIds, placeId) {
    try {
      // Place'deki tüm ürünleri al
      const allProducts = await Product.find({ placeId });
      
      if (allProducts.length === 0) {
        console.log(`No products found for place ${placeId}`);
        return [];
      }

      // Her ürün için sipariş sayısını güncelle
      orderedProductIds.forEach(productId => {
        const key = productId.toString();
        const currentCount = this.orderCounts.get(key) || 0;
        this.orderCounts.set(key, currentCount + 1);
      });

      // Toplam sipariş sayısını hesapla
      const totalOrderCount = Array.from(this.orderCounts.values())
        .reduce((sum, count) => sum + count, 0);

      const results = [];

      // Tüm ürünler için fiyat güncelle
      for (const product of allProducts) {
        const productKey = product._id.toString();
        const orderCount = this.orderCounts.get(productKey) || 0;
        
        const oldPrice = product.currentPrice || product.regularPrice;
        const newPrice = this.calculateOrderBasedPrice(
          product,
          orderCount,
          totalOrderCount
        );

        // Fiyat değişimi varsa güncelle
        if (Math.abs(newPrice - oldPrice) > 0.01) {
          const changePercentage = ((newPrice - oldPrice) / oldPrice) * 100;

          product.previousPrice = oldPrice;
          product.currentPrice = newPrice;
          await product.save();

          // PriceHistory'ye kaydet
          const priceHistory = new PriceHistory({
            productId: product._id,
            oldPrice,
            newPrice,
            changePercentage: parseFloat(changePercentage.toFixed(2)),
            reason: 'order_based' // Neden bilgisi eklenebilir
          });
          await priceHistory.save();

          console.log(
            `Product ${product.productName}: ${oldPrice} -> ${newPrice} ` +
            `(${changePercentage.toFixed(2)}%) [Orders: ${orderCount}/${totalOrderCount}]`
          );

          results.push({ product, priceHistory });
        }
      }

      return results;

    } catch (error) {
      console.error('Error updating prices on order:', error);
      throw error;
    }
  }

  // Periyodik sipariş verisi temizleme ve dengeleme
  async rebalancePrices(placeId) {
    try {
      // Sipariş sayılarını %35 azalt (daha hızlı eskitme - önceden %20)
      // Bu sayede fiyatlar daha hızlı düşer
      this.orderCounts.forEach((count, key) => {
        this.orderCounts.set(key, Math.floor(count * 0.65)); // 0.65 = %35 azaltma
      });

      // 0 olan kayıtları temizle
      Array.from(this.orderCounts.entries()).forEach(([key, count]) => {
        if (count === 0) {
          this.orderCounts.delete(key);
        }
      });

      console.log(`Rebalanced order counts for place ${placeId}`);
    } catch (error) {
      console.error('Error rebalancing prices:', error);
      throw error;
    }
  }

  // Periyodik dengeleme interval'i başlat (opsiyonel)
  startRebalanceInterval(placeId, intervalMs = 300000) { // 5 dakikada bir
    const interval = setInterval(async () => {
      await this.rebalancePrices(placeId);
    }, intervalMs);

    this.intervals.set(`rebalance_${placeId}`, interval);
    console.log(`Started rebalance interval for place ${placeId}`);
  }

  // Sipariş istatistiklerini getir
  getOrderStats(placeId) {
    const stats = {};
    let total = 0;

    this.orderCounts.forEach((count, productId) => {
      stats[productId] = count;
      total += count;
    });

    return {
      placeId,
      totalOrders: total,
      productOrderCounts: stats,
      trackedProducts: this.orderCounts.size
    };
  }

  // Sipariş verilerini sıfırla
  resetOrderCounts(placeId) {
    // Belirli bir place için sıfırlama yapılabilir
    this.orderCounts.clear();
    this.priceMomentum.clear();
    console.log(`Reset order counts for place ${placeId}`);
  }

  // Tüm interval'leri durdur
  stopAllIntervals() {
    this.intervals.forEach((interval) => {
      clearInterval(interval);
    });
    this.intervals.clear();
    this.isRunning = false;
    console.log('Stopped all intervals');
  }

  // Sistem durumu
  getStatus() {
    return {
      isRunning: this.isRunning,
      activeIntervals: this.intervals.size,
      trackedProducts: this.orderCounts.size,
      totalOrders: Array.from(this.orderCounts.values())
        .reduce((sum, count) => sum + count, 0)
    };
  }
}

module.exports = new PriceUpdater();