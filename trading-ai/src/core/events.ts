import { EventEmitter } from "events";

export class TradingEventBus extends EventEmitter {
  static readonly TICK = "tick";
  static readonly ORDER_BOOK = "order_book";
  static readonly SIGNAL = "signal";
  static readonly ORDER_CREATED = "order_created";
  static readonly ORDER_FILLED = "order_filled";
  static readonly ORDER_REJECTED = "order_rejected";
  static readonly POSITION_UPDATED = "position_updated";
  static readonly RISK_VIOLATION = "risk_violation";
  static readonly KILL_SWITCH_TRIGGERED = "kill_switch_triggered";
  static readonly PORTFOLIO_UPDATE = "portfolio_update";
  static readonly TRADE_EXECUTED = "trade_executed";
}

export const eventBus = new TradingEventBus();
eventBus.setMaxListeners(100);
