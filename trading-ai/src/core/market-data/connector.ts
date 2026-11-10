import { Tick, OrderBook, Symbol } from "../types";
import { eventBus, TradingEventBus } from "../events";

export abstract class MarketDataConnector {
  protected symbols: Set<Symbol> = new Set();
  protected isConnected = false;

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract subscribe(symbols: Symbol[]): Promise<void>;
  abstract unsubscribe(symbols: Symbol[]): Promise<void>;

  protected emitTick(tick: Tick): void {
    eventBus.emit(TradingEventBus.TICK, tick);
  }

  protected emitOrderBook(book: OrderBook): void {
    eventBus.emit(TradingEventBus.ORDER_BOOK, book);
  }

  getConnected(): boolean {
    return this.isConnected;
  }

  getSubscribedSymbols(): Symbol[] {
    return Array.from(this.symbols);
  }
}
