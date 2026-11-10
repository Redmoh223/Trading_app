import { Position, PortfolioSnapshot, Symbol } from "../types";

export class PortfolioManager {
  private positions: Map<Symbol, Position> = new Map();
  private cash: number;
  private initialCash: number;

  constructor(initialCash: number = 100000) {
    this.cash = initialCash;
    this.initialCash = initialCash;
  }

  setCash(amount: number): void {
    this.cash = amount;
  }

  getCash(): number {
    return this.cash;
  }

  setPosition(symbol: Symbol, position: Position): void {
    this.positions.set(symbol, position);
  }

  getPosition(symbol: Symbol): Position | undefined {
    return this.positions.get(symbol);
  }

  getPositions(): Position[] {
    return Array.from(this.positions.values());
  }

  getSnapshot(): PortfolioSnapshot {
    const positions = this.getPositions();
    let unrealizedPnl = 0;
    let realizedPnl = 0;
    let positionValue = 0;

    for (const pos of positions) {
      unrealizedPnl += pos.unrealizedPnl;
      realizedPnl += pos.realizedPnl;
      positionValue += pos.quantity * pos.currentPrice;
    }

    const totalValue = this.cash + positionValue;
    const dailyPnl = unrealizedPnl + realizedPnl;

    return {
      timestamp: Date.now(),
      totalValue,
      cash: this.cash,
      buyingPower: this.cash,
      positions,
      unrealizedPnl,
      realizedPnl,
      dailyPnl,
    };
  }

  getTotalReturnPct(): number {
    const snapshot = this.getSnapshot();
    return ((snapshot.totalValue - this.initialCash) / this.initialCash) * 100;
  }

  updateCash(delta: number): void {
    this.cash += delta;
  }
}

export { PortfolioManager as default };
