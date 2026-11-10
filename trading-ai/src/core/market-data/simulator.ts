import { Tick, Symbol } from "../types";
import { MarketDataConnector } from "./connector";
import { logger } from "../logger";

export class SimulatedMarketData extends MarketDataConnector {
  private intervalRefs: Map<Symbol, NodeJS.Timeout> = new Map();
  private prices: Map<Symbol, number> = new Map();
  private volatility: Map<Symbol, number> = new Map();

  constructor() {
    super();
    this.prices.set("AAPL", 150);
    this.prices.set("MSFT", 320);
    this.prices.set("GOOGL", 135);
    this.prices.set("TSLA", 210);
    this.prices.set("SPY", 420);
    this.prices.set("QQQ", 350);
    this.volatility.set("AAPL", 0.02);
    this.volatility.set("MSFT", 0.015);
    this.volatility.set("GOOGL", 0.018);
    this.volatility.set("TSLA", 0.04);
    this.volatility.set("SPY", 0.01);
    this.volatility.set("QQQ", 0.012);
  }

  async connect(): Promise<void> {
    this.isConnected = true;
    logger.info("Simulated market data connected", { category: "market-data" });
  }

  async disconnect(): Promise<void> {
    for (const [, ref] of this.intervalRefs) {
      clearInterval(ref);
    }
    this.intervalRefs.clear();
    this.isConnected = false;
    logger.info("Simulated market data disconnected", {
      category: "market-data",
    });
  }

  async subscribe(symbols: Symbol[]): Promise<void> {
    for (const symbol of symbols) {
      this.symbols.add(symbol);
      if (!this.prices.has(symbol)) {
        this.prices.set(symbol, 100);
        this.volatility.set(symbol, 0.02);
      }
      if (this.intervalRefs.has(symbol)) continue;

      const ref = setInterval(() => {
        const price = this.prices.get(symbol)!;
        const vol = this.volatility.get(symbol)!;
        const change = (Math.random() - 0.5) * 2 * vol * price;
        const newPrice = Math.max(price + change, 0.01);
        this.prices.set(symbol, newPrice);

        const spread = newPrice * 0.0005;
        const tick: Tick = {
          symbol,
          timestamp: Date.now(),
          bid: newPrice - spread / 2,
          ask: newPrice + spread / 2,
          last: newPrice,
          volume: Math.floor(Math.random() * 100000) + 1000,
        };
        this.emitTick(tick);
      }, 100);
      this.intervalRefs.set(symbol, ref);
    }
    logger.info("Subscribed to symbols", { category: "market-data", symbols });
  }

  async unsubscribe(symbols: Symbol[]): Promise<void> {
    for (const symbol of symbols) {
      this.symbols.delete(symbol);
      const ref = this.intervalRefs.get(symbol);
      if (ref) {
        clearInterval(ref);
        this.intervalRefs.delete(symbol);
      }
    }
    logger.info("Unsubscribed from symbols", { category: "market-data", symbols });
  }

  getCurrentPrice(symbol: Symbol): number | undefined {
    return this.prices.get(symbol);
  }
}
