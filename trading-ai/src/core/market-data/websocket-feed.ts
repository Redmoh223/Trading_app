import { WebSocket } from "ws";
import { Tick, OrderBook, Symbol } from "../types";
import { MarketDataConnector } from "./connector";
import { logger } from "../logger";

export class WebSocketMarketData extends MarketDataConnector {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectInterval = 3000;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(url: string) {
    super();
    this.url = url;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        this.isConnected = true;
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
        logger.info("WebSocket market data connected", {
          category: "market-data",
        });
        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data.toString());
          if (data.T === "t" || data.type === "trade") {
            const tick: Tick = {
              symbol: data.symbol || data.S,
              timestamp: data.t || data.timestamp || Date.now(),
              bid: data.bid ?? data.last,
              ask: data.ask ?? data.last,
              last: data.last ?? data.price,
              volume: data.volume ?? data.size ?? 0,
            };
            this.emitTick(tick);
          } else if (data.type === "l2" || data.book) {
            const book: OrderBook = {
              symbol: data.symbol || data.S,
              timestamp: data.timestamp || Date.now(),
              bids: data.bids ?? [],
              asks: data.asks ?? [],
            };
            this.emitOrderBook(book);
          }
        } catch (err) {
          logger.error("Failed to parse market data message", {
            category: "market-data",
            error: err instanceof Error ? err.message : String(err),
          });
        }
      };

      this.ws.onerror = (err) => {
        logger.error("WebSocket market data error", {
          category: "market-data",
          error: err instanceof Error ? err.message : String(err),
        });
        reject(err);
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        logger.warn("WebSocket market data closed", {
          category: "market-data",
        });
        this.scheduleReconnect();
      };
    });
  }

  async disconnect(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }

  async subscribe(symbols: Symbol[]): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not connected");
    }
    const msg = JSON.stringify({
      action: "subscribe",
      trades: symbols,
      quotes: symbols,
    });
    this.ws.send(msg);
    for (const symbol of symbols) this.symbols.add(symbol);
    logger.info("Subscribed to symbols", { category: "market-data", symbols });
  }

  async unsubscribe(symbols: Symbol[]): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const msg = JSON.stringify({
      action: "unsubscribe",
      trades: symbols,
      quotes: symbols,
    });
    this.ws.send(msg);
    for (const symbol of symbols) this.symbols.delete(symbol);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      logger.info("Attempting WebSocket reconnect", {
        category: "market-data",
      });
      this.connect().catch(() => this.scheduleReconnect());
    }, this.reconnectInterval);
  }
}
