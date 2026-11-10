import { RiskManager, defaultRiskLimits } from "../src/core/risk/manager";
import { PortfolioSnapshot, Signal } from "../src/core/types";

function makeSnapshot(cash: number, dailyPnl: number): PortfolioSnapshot {
  return {
    timestamp: Date.now(),
    totalValue: cash + 10000,
    cash,
    buyingPower: cash,
    positions: [],
    unrealizedPnl: 0,
    realizedPnl: 0,
    dailyPnl,
  };
}

function makeSignal(side: "buy" | "sell", price: number): Signal {
  return {
    id: "SIG_TEST",
    symbol: "AAPL",
    side,
    strength: "strong",
    confidence: 0.9,
    price,
    timestamp: Date.now(),
    source: "test",
    metadata: {},
  };
}

describe("RiskManager", () => {
  it("allows order within limits", () => {
    const rm = new RiskManager(defaultRiskLimits());
    const ctx = {
      portfolio: makeSnapshot(100000, 0),
      signal: makeSignal("buy", 150),
      existingPosition: undefined,
      openOrdersCount: 0,
    };
    expect(rm.check(makeSignal("buy", 150), ctx)).toBe(true);
  });

  it("blocks when kill switch active", () => {
    const rm = new RiskManager(defaultRiskLimits());
    const ctx = {
      portfolio: makeSnapshot(100000, -6000),
      signal: makeSignal("buy", 150),
      existingPosition: undefined,
      openOrdersCount: 0,
    };
    rm.check(makeSignal("buy", 150), ctx);
    expect(rm.isKillSwitchActive()).toBe(true);
    expect(rm.check(makeSignal("buy", 150), ctx)).toBe(false);
  });

  it("deactivates kill switch manually", () => {
    const rm = new RiskManager(defaultRiskLimits());
    rm.deactivateKillSwitch();
    expect(rm.isKillSwitchActive()).toBe(false);
  });
});

describe("PortfolioManager", () => {
  const { PortfolioManager } = require("../src/core/portfolio/manager");

  it("tracks cash and positions", () => {
    const pm = new PortfolioManager(100000);
    expect(pm.getCash()).toBe(100000);
    const snap = pm.getSnapshot();
    expect(snap.totalValue).toBe(100000);
  });
});
