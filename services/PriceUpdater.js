const Product = require('../models/Product');
const PriceHistory = require('../models/PriceHistory');
const Order = require('../models/Order');

class PriceUpdater {
  constructor() {
    this.intervals = new Map();
    this.isRunning = false;
    this.placeIntervals = new Map();
    this.orderCounts = new Map();
    this.priceMomentum = new Map();
  }

  // Sipariş bazlı fiyat hesaplama - DÜZELTİLMİŞ
  calculateOrderBasedPrice(product, orderCount, allOrderCounts) {
    const { currentPrice, minPrice, maxPrice, regularPrice } = product;

    const min = minPrice || regularPrice * 0.7;
    const max = maxPrice || regularPrice * 1.5;
    const current = currentPrice || regularPrice;

    const pricePosition = (current - min) / (max - min);

    const maxOrderCount = Math.max(...Array.from(allOrderCounts.values()), 1);
    const normalizedOrderRatio = orderCount / maxOrderCount;

    // DAHA AGRESİF HEDEF KONUMLAR
    let targetPosition;

    if (normalizedOrderRatio > 0.5) {
      // ÇOK POPÜLER: Fiyat yükselmeli (0.65-0.95 arası)
      targetPosition = 0.65 + normalizedOrderRatio * 0.3;
    } else if (normalizedOrderRatio > 0.2) {
      // ORTA POPÜLER: Nötr seviye (0.45-0.65 arası)
      targetPosition = 0.45 + normalizedOrderRatio * 0.4;
    } else if (normalizedOrderRatio > 0.05) {
      // AZ POPÜLER: Belirgin düşüş (0.15-0.35 arası)
      targetPosition = 0.15 + normalizedOrderRatio * 4.0;
    } else {
      // HİÇ SİPARİŞ YOK veya ÇOK AZ: AGRESİF DÜŞÜŞ (0-0.15 arası)
      targetPosition = pricePosition * 0.25; // Mevcut pozisyondan %75 düşer
    }

    // Momentum faktörü
    const momentumKey = product._id.toString();
    const previousMomentum =
      this.priceMomentum.get(momentumKey) || pricePosition;

    // DAHA HIZLI DEĞİŞİM HIZ
    let changeSpeed;
    if (targetPosition > previousMomentum) {
      // Fiyat YÜKSELİYORSA
      if (normalizedOrderRatio > 0.4) {
        changeSpeed = 0.3; // Popüler ürünler hızlı yükselir
      } else {
        changeSpeed = 0.18; // Normal yükseliş
      }
    } else {
      // Fiyat DÜŞÜYORSA - DAHA HIZLI DÜŞÜŞ
      if (normalizedOrderRatio === 0) {
        changeSpeed = 0.45; // Sipariş almayanlar çok hızlı düşer
      } else if (normalizedOrderRatio < 0.1) {
        changeSpeed = 0.35; // Çok az sipariş alanlar hızlı düşer
      } else {
        changeSpeed = 0.25; // Normal düşüş
      }
    }

    const smoothedPosition =
      previousMomentum + (targetPosition - previousMomentum) * changeSpeed;
    this.priceMomentum.set(momentumKey, smoothedPosition);

    // Yeni fiyat hesapla
    let newPrice = min + smoothedPosition * (max - min);

    // DAHA GENİŞ DEĞIŞIM SINIRLARI
    let maxChange;
    if (newPrice > current && normalizedOrderRatio > 0.2) {
      // SİPARİŞ ALAN ÜRÜN YÜKSELİYOR: %10'a kadar
      maxChange = current * 0.1;
    } else if (newPrice < current) {
      // DÜŞÜŞ: Daha geniş sınır
      if (normalizedOrderRatio === 0) {
        maxChange = current * 0.18; // Sipariş almayanlar %18'e kadar düşer
      } else if (normalizedOrderRatio < 0.1) {
        maxChange = current * 0.15; // Az sipariş alanlar %15'e kadar düşer
      } else {
        maxChange = current * 0.12; // Normal düşüş %12'ye kadar
      }
    } else {
      // NORMAL YÜKSELİŞ: %6'ya kadar
      maxChange = current * 0.06;
    }

    if (Math.abs(newPrice - current) > maxChange) {
      newPrice = current + Math.sign(newPrice - current) * maxChange;
    }

    // Min-max sınırları
    newPrice = Math.max(min, Math.min(max, newPrice));

    return Math.round(newPrice * 100) / 100;
  }

  // Sipariş alındığında fiyatları güncelle
  async updatePricesOnOrder(orderedProductIds, placeId) {
    try {
      const allProducts = await Product.find({ placeId });

      if (allProducts.length === 0) {
        console.log(`No products found for place ${placeId}`);
        return [];
      }

      // Her ürün için sipariş sayısını güncelle
      orderedProductIds.forEach((productId) => {
        const key = productId.toString();
        const currentCount = this.orderCounts.get(key) || 0;
        this.orderCounts.set(key, currentCount + 1);
      });

      // Tüm sipariş sayılarını Map olarak geç
      const results = [];

      // Tüm ürünler için fiyat güncelle
      for (const product of allProducts) {
        const productKey = product._id.toString();
        const orderCount = this.orderCounts.get(productKey) || 0;

        const oldPrice = product.currentPrice || product.regularPrice;
        const newPrice = this.calculateOrderBasedPrice(
          product,
          orderCount,
          this.orderCounts // Tüm sipariş sayılarını gönder
        );

        // Fiyat değişimi varsa güncelle
        if (Math.abs(newPrice - oldPrice) > 0.01) {
          const changePercentage = ((newPrice - oldPrice) / oldPrice) * 100;
          const isOrdered = orderedProductIds.includes(product._id.toString());

          product.previousPrice = oldPrice;
          product.currentPrice = newPrice;
          await product.save();

          // PriceHistory'ye kaydet
          const priceHistory = new PriceHistory({
            productId: product._id,
            oldPrice,
            newPrice,
            changePercentage: parseFloat(changePercentage.toFixed(2)),
            reason: isOrdered ? "order_received" : "market_adjustment",
          });
          await priceHistory.save();

          const orderInfo = isOrdered ? "📈 ORDERED" : "📉 Market";
          console.log(
            `${orderInfo} | ${product.productName}: ${oldPrice.toFixed(
              2
            )} -> ${newPrice.toFixed(2)} ` +
              `(${changePercentage > 0 ? "+" : ""}${changePercentage.toFixed(
                2
              )}%) [Orders: ${orderCount}]`
          );

          results.push({ product, priceHistory });
        }
      }

      return results;
    } catch (error) {
      console.error("Error updating prices on order:", error);
      throw error;
    }
  }

  // Periyodik sipariş verisi temizleme ve dengeleme
  async rebalancePrices(placeId) {
    try {
      // Sipariş sayılarını %35 azalt
      this.orderCounts.forEach((count, key) => {
        this.orderCounts.set(key, Math.floor(count * 0.65));
      });

      // 0 olan kayıtları temizle
      Array.from(this.orderCounts.entries()).forEach(([key, count]) => {
        if (count === 0) {
          this.orderCounts.delete(key);
        }
      });

      console.log(`Rebalanced order counts for place ${placeId}`);
    } catch (error) {
      console.error("Error rebalancing prices:", error);
      throw error;
    }
  }

  // Periyodik dengeleme interval'i başlat
  startRebalanceInterval(placeId, intervalMs = 300000) {
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
      trackedProducts: this.orderCounts.size,
    };
  }

  // Sipariş verilerini sıfırla
  resetOrderCounts(placeId) {
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
    console.log("Stopped all intervals");
  }

  // Sistem durumu
  getStatus() {
    return {
      isRunning: this.isRunning,
      activeIntervals: this.intervals.size,
      trackedProducts: this.orderCounts.size,
      totalOrders: Array.from(this.orderCounts.values()).reduce(
        (sum, count) => sum + count,
        0
      ),
    };
  }
}

module.exports = new PriceUpdater();