# Trading AI - Autonomous Trading System

## Architecture

```
market-data → feature-engine → ml-signal → risk-manager → execution → portfolio
```

## Core Principles

1. **Paper trading by default** — no real money at risk until explicitly enabled
2. **Risk-first** — kill-switch, position limits, stop-loss enforced at every layer
3. **Auditability** — every decision and order logged immutably
4. **Modular** — market data, execution, risk, and strategy are swappable

## Getting Started

```bash
cd trading-ai
cp .env.example .env
# Edit .env with your settings (keep TRADING_MODE=paper)
npm install
npm run build
npm start
```

## Safety

- Never commit real API keys to version control
- Start with paper trading (TRADING_MODE=paper)
- Validate strategies with backtesting before live deployment
- Maintain human-in-the-loop for all capital decisions

## Disclaimer

This software is for educational and research purposes. It is not financial advice.
Automated trading carries substantial risk of loss. The authors are not liable for
any financial losses incurred through the use of this software.
