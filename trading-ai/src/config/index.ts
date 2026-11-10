import { loadConfig, TradingEnv } from "./env.schema";

let config: TradingEnv;

export function getConfig(): TradingEnv {
  if (!config) {
    config = loadConfig();
  }
  return config;
}

export function resetConfig(): void {
  config = loadConfig();
}
