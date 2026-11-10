import numpy as np
import pandas as pd
from typing import Dict, List, Tuple, Optional
from collections import deque


class TickFeatures:
    """Extract millisecond-resolution features from tick data for ML inference."""

    def __init__(self, window_size: int = 100):
        self.window_size = window_size
        self.price_buffers: Dict[str, deque] = {}
        self.volume_buffers: Dict[str, deque] = {}
        self.last_tick: Dict[str, dict] = {}

    def _get_buffer(self, symbol: str) -> deque:
        if symbol not in self.price_buffers:
            self.price_buffers[symbol] = deque(maxlen=self.window_size)
            self.volume_buffers[symbol] = deque(maxlen=self.window_size)
        return self.price_buffers[symbol]

    def extract(self, tick: dict) -> dict:
        symbol = tick["symbol"]
        price = float(tick["last"])
        bid = float(tick["bid"])
        ask = float(tick["ask"])
        volume = float(tick.get("volume", 0))
        timestamp = int(tick["timestamp"])

        buf = self._get_buffer(symbol)
        buf.append(price)
        self.volume_buffers[symbol].append(volume)
        self.last_tick[symbol] = tick

        prices = list(buf)
        volumes = list(self.volume_buffers[symbol])

        n = len(prices)
        if n < 2:
            return self._empty_features(symbol, timestamp, price)

        returns = np.diff(prices) / prices[:-1]
        volatility = float(np.std(returns)) if len(returns) > 0 else 0.0

        ret_1m = (prices[-1] - prices[-2]) / prices[-2] if n >= 2 else 0.0
        ret_5m = (prices[-1] - prices[-min(5, n - 1)]) / prices[-min(5, n - 1)] if n >= 6 else 0.0
        ret_15m = (prices[-1] - prices[-min(15, n - 1)]) / prices[-min(15, n - 1)] if n >= 16 else 0.0

        spread = ask - bid
        mid = (bid + ask) / 2
        bid_ask_imbalance = (bid - ask) / mid if mid > 0 else 0.0

        vol_avg = np.mean(volumes) if volumes else 0
        volume_imbalance = (volume - vol_avg) / vol_avg if vol_avg > 0 else 0.0

        rsi = self._compute_rsi(prices, period=14)
        momentum = prices[-1] - prices[-min(10, n - 1)] if n >= 11 else 0.0

        return {
            "symbol": symbol,
            "timestamp": timestamp,
            "price": price,
            "return_1m": ret_1m,
            "return_5m": ret_5m,
            "return_15m": ret_15m,
            "volatility": volatility,
            "spread": spread,
            "bid_ask_imbalance": bid_ask_imbalance,
            "volume_imbalance": volume_imbalance,
            "rsi": rsi,
            "momentum": momentum,
        }

    def _compute_rsi(self, prices: List[float], period: int = 14) -> float:
        if len(prices) < period + 1:
            return 50.0
        deltas = np.diff(prices)
        gains = np.where(deltas > 0, deltas, 0.0)
        losses = np.where(deltas < 0, -deltas, 0.0)
        avg_gain = np.mean(gains[-period:])
        avg_loss = np.mean(losses[-period:])
        if avg_loss == 0:
            return 100.0
        rs = avg_gain / avg_loss
        return float(100.0 - (100.0 / (1.0 + rs)))

    def _empty_features(self, symbol: str, timestamp: int, price: float) -> dict:
        return {
            "symbol": symbol,
            "timestamp": timestamp,
            "price": price,
            "return_1m": 0.0,
            "return_5m": 0.0,
            "return_15m": 0.0,
            "volatility": 0.0,
            "spread": 0.0,
            "bid_ask_imbalance": 0.0,
            "volume_imbalance": 0.0,
            "rsi": 50.0,
            "momentum": 0.0,
        }


class OrderBookFeatures:
    """Features from L2 order book data for microstructure analysis."""

    def __init__(self, depth_levels: int = 10):
        self.depth_levels = depth_levels

    def extract(self, order_book: dict) -> dict:
        bids = order_book.get("bids", [])
        asks = order_book.get("asks", [])
        symbol = order_book.get("symbol", "")
        timestamp = int(order_book.get("timestamp", 0))

        if not bids or not asks:
            return {
                "symbol": symbol,
                "timestamp": timestamp,
                "bid_ask_spread": 0.0,
                "mid_price": 0.0,
                "book_imbalance": 0.0,
                "weighted_bid_price": 0.0,
                "weighted_ask_price": 0.0,
                "order_book_depth": 0,
            }

        best_bid = float(bids[0][0])
        best_ask = float(asks[0][0])
        spread = best_ask - best_bid
        mid = (best_bid + best_ask) / 2

        bid_size = sum(float(b[1]) for b in bids[: self.depth_levels])
        ask_size = sum(float(a[1]) for a in asks[: self.depth_levels])
        total_size = bid_size + ask_size
        book_imbalance = (bid_size - ask_size) / total_size if total_size > 0 else 0.0

        bid_notional = sum(float(b[0]) * float(b[1]) for b in bids[: self.depth_levels])
        ask_notional = sum(float(a[0]) * float(a[1]) for a in asks[: self.depth_levels])
        weighted_bid = bid_notional / bid_size if bid_size > 0 else 0.0
        weighted_ask = ask_notional / ask_size if ask_size > 0 else 0.0

        return {
            "symbol": symbol,
            "timestamp": timestamp,
            "bid_ask_spread": spread,
            "mid_price": mid,
            "book_imbalance": book_imbalance,
            "weighted_bid_price": weighted_bid,
            "weighted_ask_price": weighted_ask,
            "order_book_depth": len(bids) + len(asks),
        }
