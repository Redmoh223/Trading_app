import { Trade, Order, Signal } from "../types";
import { logger } from "../logger";

export class AuditLogger {
  private entries: Array<{ timestamp: number; type: string; data: unknown }> = [];

  logTrade(trade: Trade): void {
    this.entries.push({
      timestamp: trade.timestamp,
      type: "trade",
      data: trade,
    });
    logger.info("Trade executed", {
      category: "audit",
      symbol: trade.symbol,
      side: trade.side,
      price: trade.price,
      size: trade.size,
      fee: trade.fee,
    });
  }

  logOrder(order: Order): void {
    this.entries.push({
      timestamp: order.timestamp,
      type: "order",
      data: order,
    });
  }

  logSignal(signal: Signal): void {
    this.entries.push({
      timestamp: signal.timestamp,
      type: "signal",
      data: signal,
    });
  }

  getTrades(): Trade[] {
    return this.entries.filter((e) => e.type === "trade").map((e) => e.data as Trade);
  }

  getOrders(): Order[] {
    return this.entries.filter((e) => e.type === "order").map((e) => e.data as Order);
  }

  getSignals(): Signal[] {
    return this.entries.filter((e) => e.type === "signal").map((e) => e.data as Signal);
  }

  clear(): void {
    this.entries = [];
  }
}

export { AuditLogger as default };
