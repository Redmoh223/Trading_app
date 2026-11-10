import { Position, PortfolioSnapshot, Signal } from "../types";
import { eventBus, TradingEventBus } from "../events";
import { logAudit } from "../logger";

export interface RiskLimits {
  maxPositionSizeUsd: number;
  maxDailyLossUsd: number;
  maxPortfolioRiskPct: number;
  maxConcurrentPositions: number;
  killSwitchDailyLossPct: number;
}

export interface RiskContext {
  portfolio: PortfolioSnapshot;
  signal: Signal;
  existingPosition?: Position;
  openOrdersCount: number;
  estimatedQuantity?: number;
}

export class RiskManager {
  private limits: RiskLimits;
  private dailyLossUsd = 0;
  private killSwitchActive = false;
  private lastResetDay = 0;

  constructor(limits: RiskLimits) {
    this.limits = limits;
    this.resetDailyIfNeeded(Date.now());
  }

  private resetDailyIfNeeded(now: number): void {
    const today = new Date(now).toDateString();
    const todayNum = Date.parse(today);
    if (todayNum !== this.lastResetDay) {
      this.dailyLossUsd = 0;
      this.lastResetDay = todayNum;
    }
  }

  check(signal: Signal, context: RiskContext): boolean {
    this.resetDailyIfNeeded(Date.now());

    if (this.killSwitchActive) {
      logAudit("critical", "risk", "Order blocked - kill switch active", {
        symbol: signal.symbol,
        side: signal.side,
      });
      eventBus.emit(TradingEventBus.RISK_VIOLATION, {
        type: "kill_switch",
        symbol: signal.symbol,
      });
      return false;
    }

    const warnings: string[] = [];

    if (context.openOrdersCount >= this.limits.maxConcurrentPositions) {
      warnings.push("Max concurrent positions reached");
    }

    const estimatedQty = context.estimatedQuantity ?? 0;
    const positionValue = signal.price * estimatedQty;
    if (estimatedQty > 0 && positionValue > this.limits.maxPositionSizeUsd) {
      warnings.push("Position size exceeds max limit");
    }

    const portfolioRiskPct =
      (Math.abs(context.portfolio.dailyPnl) / context.portfolio.totalValue) *
      100;
    if (portfolioRiskPct >= this.limits.killSwitchDailyLossPct) {
      this.killSwitchActive = true;
      logAudit("critical", "risk", "Kill switch triggered", {
        dailyLossPct: portfolioRiskPct,
        threshold: this.limits.killSwitchDailyLossPct,
      });
      eventBus.emit(TradingEventBus.KILL_SWITCH_TRIGGERED, {
        dailyLossPct: portfolioRiskPct,
      });
      return false;
    }

    if (warnings.length > 0) {
      logAudit("warn", "risk", "Order warnings", {
        symbol: signal.symbol,
        warnings,
      });
    }

    return true;
  }

  recordDailyLoss(lossUsd: number): void {
    this.dailyLossUsd += Math.abs(lossUsd);
  }

  getDailyLossUsd(): number {
    return this.dailyLossUsd;
  }

  isKillSwitchActive(): boolean {
    return this.killSwitchActive;
  }

  deactivateKillSwitch(): void {
    this.killSwitchActive = false;
    logAudit("info", "risk", "Kill switch deactivated manually", {});
  }

  updateLimits(limits: Partial<RiskLimits>): void {
    this.limits = { ...this.limits, ...limits };
  }
}

export function defaultRiskLimits(): RiskLimits {
  return {
    maxPositionSizeUsd: 1000,
    maxDailyLossUsd: 500,
    maxPortfolioRiskPct: 2,
    maxConcurrentPositions: 5,
    killSwitchDailyLossPct: 5,
  };
}
