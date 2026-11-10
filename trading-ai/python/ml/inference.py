import sys
import os
import numpy as np
import time

sys.path.insert(0, os.path.dirname(__file__))

from features import TickFeatures, OrderBookFeatures
from lstm_model import LstmMarketModel, TransformerMarketModel, OnlineLearningModel


class MlInferenceEngine:
    """Production inference engine wrapping ML models for millisecond-latency prediction.

    Responsibilities:
    - Load trained model artifacts
    - Run inference on tick features with sub-millisecond overhead
    - Apply confidence thresholds and signal gating
    - Fallback to rule-based model when ML model unavailable
    """

    def __init__(
        self,
        model_type: str = "lstm",
        model_path: Optional[str] = None,
        confidence_threshold: float = 0.7,
        window_size: int = 50,
        feature_dim: int = 8,
    ):
        self.model_type = model_type
        self.confidence_threshold = confidence_threshold
        self.window_size = window_size
        self.feature_dim = feature_dim
        self.tick_extractor = TickFeatures(window_size=window_size)
        self.book_extractor = OrderBookFeatures()
        self.model = None
        self.online_model = OnlineLearningModel(feature_dim=feature_dim)
        self.feature_buffer: List[np.ndarray] = []
        self.last_prediction_time: float = 0.0
        self.prediction_count: int = 0

        self._load_model(model_type, model_path)

    def _load_model(self, model_type: str, model_path: Optional[str]) -> None:
        try:
            if model_type == "lstm":
                self.model = LstmMarketModel(
                    window_size=window_size,
                    feature_dim=feature_dim,
                    model_path=model_path,
                )
            elif model_type == "transformer":
                self.model = TransformerMarketModel(
                    window_size=window_size,
                    feature_dim=feature_dim,
                    model_path=model_path,
                )
            else:
                self.model = None
                print(f"[INFO] No ML model loaded for type={model_type}, using online fallback")
        except Exception as e:
            print(f"[WARN] Failed to load ML model: {e}")
            self.model = None

    def on_tick(self, tick: dict) -> Optional[dict]:
        """Process a tick and return a trading signal if confidence threshold met."""
        start = time.perf_counter()

        features = self.tick_extractor.extract(tick)
        feature_vector = np.array([
            features["return_1m"],
            features["return_5m"],
            features["return_15m"],
            features["volatility"],
            features["bid_ask_imbalance"],
            features["volume_imbalance"],
            features["rsi"],
            features["momentum"],
        ], dtype=np.float32)

        self.feature_buffer.append(feature_vector)
        if len(self.feature_buffer) > self.window_size:
            self.feature_buffer.pop(0)

        signal = None
        if len(self.feature_buffer) == self.window_size:
            X = np.array(self.feature_buffer)

            if self.model is not None:
                result = self.model.predict_single(X)
            else:
                result = self.online_model.predict(feature_vector)

            if result["confidence"] >= self.confidence_threshold:
                signal = {
                    "symbol": features["symbol"],
                    "side": result["side"],
                    "confidence": result["confidence"],
                    "price": features["price"],
                    "timestamp": features["timestamp"],
                    "source": f"ml_{self.model_type or 'online'}",
                    "metadata": features,
                }

            elapsed_ms = (time.perf_counter() - start) * 1000
            self.prediction_count += 1
            self.last_prediction_time = elapsed_ms

            if self.prediction_count % 1000 == 0:
                print(f"[INFO] Inference avg latency: {elapsed_ms:.3f}ms")

        return signal

    def on_order_book(self, order_book: dict) -> dict:
        return self.book_extractor.extract(order_book)

    def update_online(self, features: np.ndarray, label: int) -> None:
        if self.online_model:
            self.online_model.update(features, label)

    def set_confidence_threshold(self, threshold: float) -> None:
        self.confidence_threshold = threshold

    def get_stats(self) -> dict:
        return {
            "model_type": self.model_type,
            "predictions": self.prediction_count,
            "last_latency_ms": self.last_prediction_time,
            "confidence_threshold": self.confidence_threshold,
        }


def main():
    engine = MlInferenceEngine(model_type="lstm", confidence_threshold=0.7)
    print(f"Engine stats: {engine.get_stats()}")

    # Simulate a tick
    tick = {
        "symbol": "AAPL",
        "timestamp": int(time.time() * 1000),
        "bid": 149.98,
        "ask": 150.02,
        "last": 150.00,
        "volume": 50000,
    }

    for i in range(60):
        tick["timestamp"] = int(time.time() * 1000) + i * 100
        tick["last"] = 150.00 + (np.random.randn() * 0.05)
        tick["bid"] = tick["last"] - 0.01
        tick["ask"] = tick["last"] + 0.01
        signal = engine.on_tick(tick)
        if signal:
            print(f"Signal: {signal}")

    print(f"Final stats: {engine.get_stats()}")


if __name__ == "__main__":
    main()
