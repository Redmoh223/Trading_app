import { z } from "zod";

export const TradingEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.enum(["error", "warn", "info", "debug"]).default("info"),
  TRADING_MODE: z.enum(["paper", "live"]).default("paper"),
  MAX_POSITION_SIZE_USD: z.coerce.number().default(1000),
  MAX_DAILY_LOSS_USD: z.coerce.number().default(500),
  MAX_PORTFOLIO_RISK_PCT: z.coerce.number().default(2),
  MAX_CONCURRENT_POSITIONS: z.coerce.number().default(5),
  KILL_SWITCH_DAILY_LOSS_PCT: z.coerce.number().default(5),
  BROKER_API_KEY: z.string().optional(),
  BROKER_API_SECRET: z.string().optional(),
  BROKER_BASE_URL: z.string().optional(),
  BROKER_WS_URL: z.string().optional(),
  ML_MODEL_PATH: z.string().optional(),
  ML_INFERENCE_INTERVAL_MS: z.coerce.number().default(100),
  ML_CONFIDENCE_THRESHOLD: z.coerce.number().default(0.7),
  TRADE_SYMBOLS: z.string().default("AAPL,MSFT,GOOGL,TSLA,SPY,QQQ"),
});

export type TradingEnv = z.infer<typeof TradingEnvSchema>;

export function loadConfig(): TradingEnv {
  return TradingEnvSchema.parse(process.env);
}
