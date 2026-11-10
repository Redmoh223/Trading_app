import { Tick, OrderSide, Symbol } from "../types";
import { PaperExecutionEngine } from "../execution/paper-engine";
import { FeatureExtractor, MlSignalEngine, RuleBasedModel } from "../strategy";
import { RiskManager, defaultRiskLimits } from "../risk/manager";
import { logger } from "../logger";

export interface BacktestResult {
  symbol: Symbol;
  initialCash: number;
  finalCash: number;
  totalReturnPct: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRatePct: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  trades: Array<{
    timestamp: number;
    side: OrderSide;
    price: number;
    quantity: number;
    pnl: number;
  }>;
}

export class BacktestingEngine {
  private execution: PaperExecutionEngine;
  private featureExtractor: FeatureExtractor;
  private signalEngine: MlSignalEngine;
  private riskManager: RiskManager;
  private ticks: Map<Symbol, Tick[]> = new Map();
  private currentIndex: Map<Symbol, number> = new Map();

  constructor(initialCash: number = 100000) {
    this.execution = new PaperExecutionEngine(initialCash);
    this.featureExtractor = new FeatureExtractor();
    this.signalEngine = new MlSignalEngine(new RuleBasedModel(), 0.6, 500);
    this.riskManager = new RiskManager(defaultRiskLimits());
  }

  async loadHistoricalData(symbols: Symbol[], ticksPerSymbol: number = 1000): Promise<void> {
    for (const symbol of symbols) {
      const ticks: Tick[] = [];
      let price = 100;
      for (let i = 0; i < ticksPerSymbol; i++) {
        const change = (Math.random() - 0.5) * 0.02 * price;
        price = Math.max(price + change, 0.01);
        const spread = price * 0.0005;
        ticks.push({
          symbol,
          timestamp: Date.now() - (ticksPerSymbol - i) * 1000,
          bid: price - spread / 2,
          ask: price + spread / 2,
          last: price,
          volume: Math.floor(Math.random() * 100000) + 1000,
        });
      }
      this.ticks.set(symbol, ticks);
      this.currentIndex.set(symbol, 0);
    }
    logger.info("Historical data loaded", {
      category: "backtest",
      symbols,
      ticksPerSymbol,
    });
  }

  async run(symbols: Symbol[]): Promise<BacktestResult[]> {
    const results: BacktestResult[] = [];

    for (const symbol of symbols) {
      const ticks = this.ticks.get(symbol);
      if (!ticks || ticks.length === 0) continue;

      let cash = this.execution.getCash();
      let peak = cash;
      let maxDrawdown = 0;
      const trades: BacktestResult["trades"] = [];
      let winningTrades = 0;
      let losingTrades = 0;

      let lastTradePrice: number | null = null;

      for (const tick of ticks) {
        this.execution.setTickPrice(tick.symbol, tick.bid, tick.ask);

        const features = this.featureExtractor.extract(tick);
        const signal = this.signalEngine.evaluate(features);

        if (signal) {
          const context = {
            portfolio: {
              timestamp: Date.now(),
              totalValue: cash,
              cash,
              buyingPower: cash,
              positions: [],
              unrealizedPnl: 0,
              realizedPnl: 0,
              dailyPnl: 0,
            },
            signal,
            existingPosition: undefined,
            openOrdersCount: 0,
          };

          if (this.riskManager.check(signal, context)) {
            const qty = Math.floor(
              Math.min(this.riskManager["limits"].maxPositionSizeUsd / tick.last, 100)
            );
            if (qty > 0) {
              const order = await this.execution.placeOrder(
                tick.symbol,
                signal.side,
                qty,
                "market"
              );

              if (order.status === "filled") {
                const fillPrice = order.averageFillPrice ?? tick.last;
                if (lastTradePrice !== null) {
                  const pnl =
                    signal.side === "sell"
                      ? (fillPrice - lastTradePrice) * qty
                      : (lastTradePrice - fillPrice) * qty;
                  trades.push({
                    timestamp: tick.timestamp,
                    side: signal.side,
                    price: fillPrice,
                    quantity: qty,
                    pnl,
                  });
                  if (pnl > 0) winningTrades++;
                  else losingTrades++;
                  cash += pnl;
                }
                lastTradePrice = fillPrice;
              }
            }
          }
        }

        const currentValue = cash;
        if (currentValue > peak) peak = currentValue;
        const drawdown = ((peak - currentValue) / peak) * 100;
        if (drawdown > maxDrawdown) maxDrawdown = drawdown;
      }

      const totalTrades = trades.length;
      const totalReturnPct = ((cash - this.execution.getCash()) / this.execution.getCash()) * 100;
      const winRatePct = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
      const avgReturn = trades.reduce((sum, t) => sum + t.pnl, 0) / Math.max(totalTrades, 1);
      const stdDev =
        Math.sqrt(
          trades.reduce((sum, t) => sum + Math.pow(t.pnl - avgReturn, 2), 0) /
            Math.max(totalTrades, 1)
        ) || 1;
      const sharpeRatio = (avgReturn / stdDev) * Math.sqrt(252);

      results.push({
        symbol,
        initialCash: this.execution.getCash(),
        finalCash: cash,
        totalReturnPct,
        totalTrades,
        winningTrades,
        losingTrades,
        winRatePct,
        maxDrawdownPct: maxDrawdown,
        sharpeRatio,
        trades,
      });
    }

    return results;
  }
}

export { BacktestingEngine as default };
