export type Symbol = string;

export type OrderSide = "buy" | "sell";

export type OrderType = "market" | "limit" | "stop" | "stop-limit";

export type OrderStatus =
  | "pending"
  | "open"
  | "filled"
  | "partial"
  | "cancelled"
  | "rejected"
  | "expired";

export type PositionSide = "long" | "short" | "flat";

export type SignalStrength = "weak" | "moderate" | "strong";

export interface Tick {
  symbol: Symbol;
  timestamp: number;
  bid: number;
  ask: number;
  last: number;
  volume: number;
}

export interface OrderBookLevel {
  price: number;
  size: number;
}

export interface OrderBook {
  symbol: Symbol;
  timestamp: number;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
}

export interface Trade {
  id: string;
  symbol: Symbol;
  side: OrderSide;
  price: number;
  size: number;
  timestamp: number;
  fee: number;
}

export interface Order {
  id: string;
  clientOrderId: string;
  symbol: Symbol;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  price?: number;
  stopPrice?: number;
  status: OrderStatus;
  filledQuantity: number;
  averageFillPrice?: number;
  timestamp: number;
  updatedAt: number;
}

export interface Position {
  symbol: Symbol;
  side: PositionSide;
  quantity: number;
  averageEntryPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  realizedPnl: number;
  timestamp: number;
}

export interface Signal {
  id: string;
  symbol: Symbol;
  side: OrderSide;
  strength: SignalStrength;
  confidence: number;
  price: number;
  timestamp: number;
  source: string;
  metadata: Record<string, unknown>;
}

export interface PortfolioSnapshot {
  timestamp: number;
  totalValue: number;
  cash: number;
  buyingPower: number;
  positions: Position[];
  unrealizedPnl: number;
  realizedPnl: number;
  dailyPnl: number;
}

export interface RiskCheckResult {
  allowed: boolean;
  reason?: string;
  adjustedQuantity?: number;
  warnings: string[];
}

export interface AuditEntry {
  id: string;
  timestamp: number;
  level: "info" | "warn" | "error" | "critical";
  category: string;
  message: string;
  data?: Record<string, unknown>;
}

export type TradingMode = "paper" | "live";

export interface BrokerConfig {
  apiKey: string;
  apiSecret: string;
  baseUrl: string;
  wsUrl?: string;
  tradingMode: TradingMode;
}
