import { Symbol, Tick } from "../types";

export interface MarketFeatures {
  symbol: Symbol;
  timestamp: number;
  price: number;
  return1m: number;
  return5m: number;
  return15m: number;
  volatility: number;
  volumeImbalance: number;
  spread: number;
  bidAskImbalance: number;
  rsi: number;
  momentum: number;
}

class PriceBuffer {
  prices: number[] = [];
  private maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  push(price: number): void {
    this.prices.push(price);
    if (this.prices.length > this.maxSize) {
      this.prices.shift();
    }
  }

  get(indexFromEnd: number): number | undefined {
    return this.prices[this.prices.length - 1 - indexFromEnd];
  }

  get length(): number {
    return this.prices.length;
  }

  get last(): number | undefined {
    return this.prices[this.prices.length - 1];
  }
}

export class FeatureExtractor {
  private priceBuffers: Map<Symbol, PriceBuffer> = new Map();
  private volumeBuffers: Map<Symbol, number[]> = new Map();
  private lastTick: Map<Symbol, Tick> = new Map();

  private getBuffer(symbol: Symbol): PriceBuffer {
    let buf = this.priceBuffers.get(symbol);
    if (!buf) {
      buf = new PriceBuffer(100);
      this.priceBuffers.set(symbol, buf);
    }
    return buf;
  }

  extract(tick: Tick): MarketFeatures {
    const buf = this.getBuffer(tick.symbol);
    buf.push(tick.last);

    const price = tick.last;
    const return1m = this.calculateReturn(buf, 1);
    const return5m = this.calculateReturn(buf, 5);
    const return15m = this.calculateReturn(buf, 15);
    const volatility = this.calculateVolatility(buf);
    const spread = tick.ask - tick.bid;
    const midPrice = (tick.bid + tick.ask) / 2;
    const bidAskImbalance = (tick.bid - tick.ask) / midPrice;
    const volumeImbalance = this.calculateVolumeImbalance(tick.symbol, tick.volume);
    const rsi = this.calculateRSI(buf);
    const momentum = this.calculateMomentum(buf);

    const features: MarketFeatures = {
      symbol: tick.symbol,
      timestamp: tick.timestamp,
      price,
      return1m,
      return5m,
      return15m,
      volatility,
      volumeImbalance,
      spread,
      bidAskImbalance,
      rsi,
      momentum,
    };

    this.lastTick.set(tick.symbol, tick);

    return features;
  }

  private calculateReturn(buf: PriceBuffer, periods: number): number {
    const current = buf.last;
    const past = buf.get(periods);
    if (current === undefined || past === undefined || past === 0) return 0;
    return (current - past) / past;
  }

  private calculateVolatility(buf: PriceBuffer): number {
    const prices = buf.prices;
    if (prices.length < 2) return 0;
    const mean =
      prices.reduce((sum, p) => sum + p, 0) / prices.length;
    const variance =
      prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) /
      prices.length;
    return Math.sqrt(variance) / mean;
  }

  private calculateRSI(buf: PriceBuffer, period: number = 14): number {
    const prices = buf.prices;
    if (prices.length < period + 1) return 50;
    let gains = 0;
    let losses = 0;
    for (let i = prices.length - period; i < prices.length; i++) {
      const change = prices[i] - prices[i - 1];
      if (change > 0) gains += change;
      else losses += -change;
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  }

  private calculateMomentum(buf: PriceBuffer, period: number = 10): number {
    const current = buf.last;
    const past = buf.get(period);
    if (current === undefined || past === undefined) return 0;
    return current - past;
  }

  private calculateVolumeImbalance(symbol: Symbol, currentVolume: number): number {
    let vols = this.volumeBuffers.get(symbol);
    if (!vols) {
      vols = [];
      this.volumeBuffers.set(symbol, vols);
    }
    vols.push(currentVolume);
    if (vols.length > 20) vols.shift();
    const avg =
      vols.reduce((sum, v) => sum + v, 0) / vols.length;
    return avg === 0 ? 0 : (currentVolume - avg) / avg;
  }
}
