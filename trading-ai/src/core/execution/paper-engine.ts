import { Order, OrderSide, OrderType, Position, Symbol, Trade } from "../types";
import { eventBus, TradingEventBus } from "../events";
import { logger, logAudit } from "../logger";

export interface FillResult {
  orderId: string;
  filledQuantity: number;
  fillPrice: number;
  timestamp: number;
  fee: number;
}

export abstract class ExecutionEngine {
  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract placeOrder(
    symbol: Symbol,
    side: OrderSide,
    quantity: number,
    type: OrderType,
    price?: number,
    stopPrice?: number
  ): Promise<Order>;
  abstract cancelOrder(orderId: string): Promise<void>;
  abstract getOrder(orderId: string): Promise<Order | null>;
  abstract getOpenOrders(symbol?: Symbol): Promise<Order[]>;
  abstract getPositions(): Promise<Position[]>;
}

export class PaperExecutionEngine extends ExecutionEngine {
  private orders: Map<string, Order> = new Map();
  private positions: Map<Symbol, Position> = new Map();
  private cash: number;
  private tickPrices: Map<Symbol, { bid: number; ask: number }> = new Map();
  private orderIdCounter = 0;

  constructor(initialCash: number = 100000) {
    super();
    this.cash = initialCash;
  }

  async connect(): Promise<void> {
    logger.info("Paper execution engine connected", {
      category: "execution",
      initialCash: this.cash,
    });
  }

  async disconnect(): Promise<void> {
    logger.info("Paper execution engine disconnected", { category: "execution" });
  }

  setTickPrice(symbol: Symbol, bid: number, ask: number): void {
    this.tickPrices.set(symbol, { bid, ask });
  }

  async placeOrder(
    symbol: Symbol,
    side: OrderSide,
    quantity: number,
    type: OrderType,
    price?: number,
    stopPrice?: number
  ): Promise<Order> {
    const orderId = `ORD_${Date.now()}_${this.orderIdCounter++}`;
    const clientOrderId = `CLIENT_${orderId}`;
    const now = Date.now();

    const order: Order = {
      id: orderId,
      clientOrderId,
      symbol,
      side,
      type,
      quantity,
      price,
      stopPrice,
      status: "open",
      filledQuantity: 0,
      averageFillPrice: undefined,
      timestamp: now,
      updatedAt: now,
    };

    this.orders.set(orderId, order);

    eventBus.emit(TradingEventBus.ORDER_CREATED, order);
    logAudit("info", "execution", "Order created", {
      orderId,
      symbol,
      side,
      quantity,
      type,
      price,
    });

    if (type === "market") {
      await this.fillMarketOrder(order);
    }

    return order;
  }

  private async fillMarketOrder(order: Order): Promise<void> {
    const tick = this.tickPrices.get(order.symbol);
    if (!tick) {
      order.status = "rejected";
      order.updatedAt = Date.now();
      eventBus.emit(TradingEventBus.ORDER_REJECTED, order);
      logAudit("warn", "execution", "Order rejected - no price data", {
        orderId: order.id,
        symbol: order.symbol,
      });
      return;
    }

    const fillPrice = order.side === "buy" ? tick.ask : tick.bid;
    const fee = fillPrice * order.quantity * 0.0001;
    const now = Date.now();

    order.filledQuantity = order.quantity;
    order.averageFillPrice = fillPrice;
    order.status = "filled";
    order.updatedAt = now;

    const cost = fillPrice * order.quantity + fee;

    if (order.side === "buy") {
      if (this.cash < cost) {
        order.status = "rejected";
        order.updatedAt = now;
        eventBus.emit(TradingEventBus.ORDER_REJECTED, order);
        logAudit("warn", "execution", "Order rejected - insufficient cash", {
          orderId: order.id,
          required: cost,
          available: this.cash,
        });
        return;
      }
      this.cash -= cost;
      this.updatePosition(order.symbol, "long", order.quantity, fillPrice, fee);
    } else {
      const pos = this.positions.get(order.symbol);
      if (!pos || pos.quantity < order.quantity) {
        order.status = "rejected";
        order.updatedAt = now;
        eventBus.emit(TradingEventBus.ORDER_REJECTED, order);
        logAudit("warn", "execution", "Order rejected - insufficient position", {
          orderId: order.id,
          symbol: order.symbol,
        });
        return;
      }
      this.cash += cost;
      this.updatePosition(order.symbol, "short", order.quantity, fillPrice, fee);
    }

    const trade: Trade = {
      id: `TRD_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      symbol: order.symbol,
      side: order.side,
      price: fillPrice,
      size: order.quantity,
      timestamp: now,
      fee,
    };

    eventBus.emit(TradingEventBus.ORDER_FILLED, order);
    eventBus.emit(TradingEventBus.TRADE_EXECUTED, trade);
    logAudit("info", "execution", "Order filled", {
      orderId: order.id,
      symbol: order.symbol,
      side: order.side,
      price: fillPrice,
      quantity: order.quantity,
      fee,
    });
  }

  private updatePosition(
    symbol: Symbol,
    side: "long" | "short",
    quantity: number,
    price: number,
    fee: number
  ): void {
    const existing = this.positions.get(symbol);
    const now = Date.now();

    if (!existing) {
      this.positions.set(symbol, {
        symbol,
        side: side === "long" ? "long" : "short",
        quantity,
        averageEntryPrice: price,
        currentPrice: price,
        unrealizedPnl: 0,
        realizedPnl: 0,
        timestamp: now,
      });
      return;
    }

    if ((existing.side === "long" && side === "long") || (existing.side === "short" && side === "short")) {
      const totalQty = existing.quantity + quantity;
      const newAvg =
        (existing.averageEntryPrice * existing.quantity + price * quantity) /
        totalQty;
      existing.quantity = totalQty;
      existing.averageEntryPrice = newAvg;
      existing.currentPrice = price;
      existing.timestamp = now;
    } else {
      const closeQty = Math.min(existing.quantity, quantity);
      const pnl =
        existing.side === "long"
          ? (price - existing.averageEntryPrice) * closeQty
          : (existing.averageEntryPrice - price) * closeQty;
      existing.realizedPnl += pnl - fee;
      existing.quantity -= closeQty;

      if (existing.quantity <= 0) {
        existing.side = "flat";
        existing.quantity = 0;
      } else if (side === "long" && existing.side === "short") {
        existing.side = "long";
        existing.averageEntryPrice = price;
      } else if (side === "short" && existing.side === "long") {
        existing.side = "short";
        existing.averageEntryPrice = price;
      }
      existing.timestamp = now;
    }
  }

  updatePositionPrice(symbol: Symbol, price: number): void {
    const pos = this.positions.get(symbol);
    if (!pos || pos.side === "flat") return;
    pos.currentPrice = price;
    pos.unrealizedPnl =
      pos.side === "long"
        ? (price - pos.averageEntryPrice) * pos.quantity
        : (pos.averageEntryPrice - price) * pos.quantity;
  }

  async cancelOrder(orderId: string): Promise<void> {
    const order = this.orders.get(orderId);
    if (!order) return;
    if (order.status === "filled" || order.status === "cancelled") return;
    order.status = "cancelled";
    order.updatedAt = Date.now();
    eventBus.emit(TradingEventBus.ORDER_REJECTED, order);
    logAudit("info", "execution", "Order cancelled", { orderId });
  }

  async getOrder(orderId: string): Promise<Order | null> {
    return this.orders.get(orderId) ?? null;
  }

  async getOpenOrders(symbol?: Symbol): Promise<Order[]> {
    const orders = Array.from(this.orders.values()).filter(
      (o) => o.status === "open" && (!symbol || o.symbol === symbol)
    );
    return orders;
  }

  async getPositions(): Promise<Position[]> {
    return Array.from(this.positions.values());
  }

  getCash(): number {
    return this.cash;
  }

  setCash(amount: number): void {
    this.cash = amount;
  }
}

export { PaperExecutionEngine as default };
