import { Signal, Symbol } from "../types";
import { MarketFeatures } from "./features";

export interface MlModel {
  predict(features: MarketFeatures): { side: "buy" | "sell"; confidence: number };
}

export class RuleBasedModel implements MlModel {
  predict(features: MarketFeatures): { side: "buy" | "sell"; confidence: number } {
    let score = 0;

    if (features.momentum > 0) score += 0.3;
    else score -= 0.3;

    if (features.return5m > 0.001) score += 0.2;
    else if (features.return5m < -0.001) score -= 0.2;

    if (features.rsi < 30) score += 0.2;
    else if (features.rsi > 70) score -= 0.2;

    if (features.volumeImbalance > 0.1) score += 0.15;
    else if (features.volumeImbalance < -0.1) score -= 0.15;

    if (features.bidAskImbalance > 0) score += 0.1;
    else score -= 0.1;

    const confidence = Math.min(Math.abs(score), 1);
    const side = score > 0 ? "buy" : "sell";
    return { side, confidence };
  }
}

export class MlSignalEngine {
  private model: MlModel;
  private confidenceThreshold: number;
  private lastSignal: Map<Symbol, Signal> = new Map();
  private minIntervalMs: number;

  constructor(model: MlModel, confidenceThreshold: number = 0.6, minIntervalMs: number = 1000) {
    this.model = model;
    this.confidenceThreshold = confidenceThreshold;
    this.minIntervalMs = minIntervalMs;
  }

  evaluate(features: MarketFeatures): Signal | null {
    const prediction = this.model.predict(features);

    if (prediction.confidence < this.confidenceThreshold) {
      return null;
    }

    const now = Date.now();
    const last = this.lastSignal.get(features.symbol);
    if (last && now - last.timestamp < this.minIntervalMs) {
      return null;
    }

    const signal: Signal = {
      id: `SIG_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      symbol: features.symbol,
      side: prediction.side,
      strength:
        prediction.confidence > 0.8
          ? "strong"
          : prediction.confidence > 0.7
          ? "moderate"
          : "weak",
      confidence: prediction.confidence,
      price: features.price,
      timestamp: now,
      source: "ml_signal_engine",
      metadata: {
        return1m: features.return1m,
        return5m: features.return5m,
        volatility: features.volatility,
        rsi: features.rsi,
        momentum: features.momentum,
        volumeImbalance: features.volumeImbalance,
      },
    };

    this.lastSignal.set(features.symbol, signal);
    return signal;
  }

  setConfidenceThreshold(threshold: number): void {
    this.confidenceThreshold = threshold;
  }

  setModel(model: MlModel): void {
    this.model = model;
  }
}


