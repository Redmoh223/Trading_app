import "dotenv/config";
import http from "http";
import { getConfig } from "./config";
import { logger, logAudit } from "./core/logger";
import { SimulatedMarketData } from "./core/market-data/simulator";
import { PaperExecutionEngine } from "./core/execution/paper-engine";
import { FeatureExtractor } from "./core/strategy/features";
import { MlSignalEngine, RuleBasedModel } from "./core/strategy/ml-signal";
import { RiskManager, defaultRiskLimits } from "./core/risk/manager";
import { eventBus, TradingEventBus } from "./core/events";
import { OrderSide, SignalStrength } from "./core/types";
import { PortfolioManager } from "./core/portfolio/manager";
import { BacktestingEngine } from "./core/backtesting/engine";
import { createApp } from "./server/app";

const PORT = parseInt(process.env.PORT || "3000", 10);
let portfolio!: PortfolioManager;
let execution!: PaperExecutionEngine;
const executionOrders: Map<string, any> = new Map();
const lastPrices: Map<string, number> = new Map();

let app: ReturnType<typeof createApp>;

async function main(): Promise<void> {
  const config = getConfig();
  logger.info("Starting Trading AI", {
    category: "system",
    mode: config.TRADING_MODE,
    nodeEnv: config.NODE_ENV,
  });

  const marketData = new SimulatedMarketData();
  execution = new PaperExecutionEngine(100000);
  portfolio = new PortfolioManager(100000);
  const featureExtractor = new FeatureExtractor();
  const signalEngine = new MlSignalEngine(
    new RuleBasedModel(),
    config.ML_CONFIDENCE_THRESHOLD,
    1000
  );
  const riskManager = new RiskManager(defaultRiskLimits());

  app = createApp({
    getPortfolio: () => portfolio.getSnapshot(),
    getPositions: () => ({ positions: portfolio.getPositions() }),
    getOrders: () => ({ orders: Array.from(executionOrders.values()) }),
    placeOrder: async (req) => {
      const snapshot = portfolio.getSnapshot();
      const marketPrice = lastPrices.get(req.symbol) ?? 100;

      // Calculer la quantité max achetable selon le cash disponible
      let qty = req.quantity;
      if (req.side === "buy") {
        const maxQty = Math.floor(snapshot.cash / marketPrice);
        if (maxQty <= 0) {
          return { ok: false, error: "Solde insuffisant pour cet achat" };
        }
        qty = Math.min(req.quantity, maxQty);
      }

      const context = {
        portfolio: snapshot,
        signal: {
          id: `MANUAL_${Date.now()}`,
          symbol: req.symbol,
          side: req.side,
          strength: "strong" as SignalStrength,
          confidence: 1,
          price: marketPrice,
          timestamp: Date.now(),
          source: "manual",
          metadata: {},
        },
        existingPosition: undefined,
        openOrdersCount: 0,
        estimatedQuantity: qty,
      };
      if (!riskManager.check(context.signal, context)) {
        return { ok: false, error: "Risk check failed" };
      }
      const order = await execution.placeOrder(req.symbol, req.side, qty, "market");
      executionOrders.set(order.id, order);
      if (order.status === "filled") {
        const fillPrice = order.averageFillPrice ?? marketPrice;
        const cost = fillPrice * qty;
        const fee = cost * 0.0001;
        if (req.side === "buy") {
          portfolio.updateCash(-cost - fee);
          syncPosition(req.symbol, "buy", qty, fillPrice, fee);
        } else {
          portfolio.updateCash(cost - fee);
          syncPosition(req.symbol, "sell", qty, fillPrice, fee);
        }
        broadcastState();
        return { ok: true, orderId: order.id, filledQuantity: qty, price: fillPrice };
      }
      return { ok: false, error: "Order not filled" };
    },
  });

  await marketData.connect();
  await execution.connect();

  const symbols = config.TRADE_SYMBOLS.split(",").map((s) => s.trim());
  await marketData.subscribe(symbols);

  // Définir les prix initiaux pour permettre les seed orders
  const seedPrices: Record<string, number> = { AAPL: 150, MSFT: 320, GOOGL: 135, TSLA: 210, SPY: 420, QQQ: 350 };
  for (const symbol of symbols) {
    const price = seedPrices[symbol] ?? 100;
    const spread = price * 0.0005;
    execution.setTickPrice(symbol, price - spread / 2, price + spread / 2);
  }

  // Seed positions initiales pour permettre l'achat et la vente
  for (const symbol of symbols) {
    const price = seedPrices[symbol] ?? 100;
    const qty = Math.floor(500 / price);
    if (qty > 0) {
      const order = await execution.placeOrder(symbol, "buy", qty, "market");
      if (order.status === "filled") {
        const fillPrice = order.averageFillPrice ?? price;
        const cost = fillPrice * qty;
        const fee = cost * 0.0001;
        portfolio.updateCash(-cost - fee);
        syncPosition(symbol, "buy", qty, fillPrice, fee);
        executionOrders.set(order.id, order);
        logger.info("Seed position", { category: "system", symbol, qty, price: fillPrice });
      }
    }
  }

  broadcastState();

  eventBus.on(TradingEventBus.TICK, (tick) => {
    execution.setTickPrice(tick.symbol, tick.bid, tick.ask);
    lastPrices.set(tick.symbol, tick.last);

    // --- Stop-loss / Take-profit automatique ---
    const positions = portfolio.getPositions();
    const pos = positions.find((p) => p.symbol === tick.symbol);
    if (pos && pos.side === "long" && pos.quantity > 0) {
      const pnlPct = ((tick.last - pos.averageEntryPrice) / pos.averageEntryPrice) * 100;
      const STOP_LOSS_PCT = -5;
      const TAKE_PROFIT_PCT = 10;
      if (pnlPct <= STOP_LOSS_PCT || pnlPct >= TAKE_PROFIT_PCT) {
        const side: OrderSide = "sell";
        const snapshot = portfolio.getSnapshot();
        const estimatedQty = pos.quantity;
        const context = {
          portfolio: snapshot,
          signal: {
            id: `SLTP_${Date.now()}`,
            symbol: tick.symbol,
            side,
            strength: "strong" as SignalStrength,
            confidence: 1,
            price: tick.last,
            timestamp: tick.timestamp,
            source: "sltp",
            metadata: { pnlPct, reason: pnlPct <= STOP_LOSS_PCT ? "stop_loss" : "take_profit" },
          },
          existingPosition: pos,
          openOrdersCount: 0,
          estimatedQuantity: estimatedQty,
        };
        if (riskManager.check(context.signal, context)) {
          execution.placeOrder(tick.symbol, side, estimatedQty, "market").then((order) => {
            executionOrders.set(order.id, order);
            if (order.status === "filled") {
              const fillPrice = order.averageFillPrice ?? tick.last;
              const cost = fillPrice * estimatedQty;
              const fee = cost * 0.0001;
              portfolio.updateCash(cost - fee);
              syncPosition(tick.symbol, "sell", estimatedQty, fillPrice, fee);
              logger.info("SLTP executed", {
                category: "execution",
                symbol: tick.symbol,
                side,
                quantity: estimatedQty,
                price: fillPrice,
                pnlPct,
                reason: pnlPct <= STOP_LOSS_PCT ? "stop_loss" : "take_profit",
              });
              broadcastState();
            }
          });
        }
        return;
      }
    }

    const features = featureExtractor.extract(tick);
    const signal = signalEngine.evaluate(features);

    if (!signal) return;

    const snapshot = portfolio.getSnapshot();
    const estimatedQty = Math.floor(
      Math.min(config.MAX_POSITION_SIZE_USD / signal.price, 100)
    );

    if (estimatedQty <= 0) {
      logger.warn("Estimated quantity is zero, skipping order", {
        category: "execution",
        symbol: signal.symbol,
        price: signal.price,
      });
      return;
    }

    const context = {
      portfolio: snapshot,
      signal,
      existingPosition: undefined,
      openOrdersCount: 0,
      estimatedQuantity: estimatedQty,
    };

    if (!riskManager.check(signal, context)) {
      return;
    }

    execution
      .placeOrder(signal.symbol, signal.side, estimatedQty, "market")
      .then((order) => {
        executionOrders.set(order.id, order);
        if (order.status === "filled") {
          const fillPrice = order.averageFillPrice ?? signal.price;
          const cost = fillPrice * estimatedQty;
          const fee = cost * 0.0001;

          if (signal.side === "buy") {
            portfolio.updateCash(-cost - fee);
            syncPosition(order.symbol, "buy", estimatedQty, fillPrice, fee);
          } else {
            portfolio.updateCash(cost - fee);
            syncPosition(order.symbol, "sell", estimatedQty, fillPrice, fee);
          }

          logger.info("Order filled and portfolio updated", {
            category: "execution",
            orderId: order.id,
            symbol: order.symbol,
            side: order.side,
            quantity: estimatedQty,
            price: fillPrice,
            fee,
          });
          broadcastState();
        }
      })
      .catch((err) => {
        logger.error("Order execution failed", {
          category: "execution",
          error: err instanceof Error ? err.message : String(err),
        });
      });
  });

  eventBus.on(TradingEventBus.KILL_SWITCH_TRIGGERED, (data) => {
    logAudit("critical", "system", "Kill switch activated - halting new orders", data);
  });

  logger.info("Trading AI initialized", { category: "system", symbols });

  const server = http.createServer(app);
  if (app.wss) {
    server.on("upgrade", (request, socket, head) => {
      app.wss!.handleUpgrade(request, socket, head, (ws) => {
        app.wss!.emit("connection", ws, request);
      });
    });
  }
  server.listen(PORT, () => {
    logger.info(`Dashboard + WS listening on http://localhost:${PORT}`, { category: "system" });
  });

  function broadcastState() {
    app.broadcast?.({
      type: "state",
      timestamp: Date.now(),
      portfolio: portfolio.getSnapshot(),
      positions: portfolio.getPositions(),
      orders: Array.from(executionOrders.values()),
    });
  }

  function syncPosition(symbol: string, side: OrderSide, qty: number, price: number, fee: number): void {
    const existing = portfolio.getPosition(symbol);
    const now = Date.now();

    if (!existing || existing.side === "flat") {
      portfolio.setPosition(symbol, {
        symbol,
        side: side === "buy" ? "long" : "short",
        quantity: qty,
        averageEntryPrice: price,
        currentPrice: price,
        unrealizedPnl: 0,
        realizedPnl: -fee,
        timestamp: now,
      });
      return;
    }

    if ((existing.side === "long" && side === "buy") || (existing.side === "short" && side === "sell")) {
      const totalQty = existing.quantity + qty;
      const newAvg = (existing.averageEntryPrice * existing.quantity + price * qty) / totalQty;
      existing.quantity = totalQty;
      existing.averageEntryPrice = newAvg;
      existing.currentPrice = price;
      existing.timestamp = now;
    } else {
      const closeQty = Math.min(existing.quantity, qty);
      const pnl =
        existing.side === "long"
          ? (price - existing.averageEntryPrice) * closeQty
          : (existing.averageEntryPrice - price) * closeQty;
      existing.realizedPnl += pnl - fee;
      existing.quantity -= closeQty;
      if (existing.quantity <= 0) {
        existing.side = "flat";
        existing.quantity = 0;
      } else if (side === "buy") {
        existing.side = "long";
        existing.averageEntryPrice = price;
      } else {
        existing.side = "short";
        existing.averageEntryPrice = price;
      }
      existing.timestamp = now;
    }
  }

  if (process.env.NODE_ENV === "test") {
    return;
  }

  const backtest = new BacktestingEngine(100000);
  await backtest.loadHistoricalData(symbols, 500);
  const results = await backtest.run(symbols);
  logger.info("Backtest results", { category: "backtest", results });
}

main().catch((err) => {
  logger.error("Fatal error starting Trading AI", {
    category: "system",
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  process.exit(1);
});
