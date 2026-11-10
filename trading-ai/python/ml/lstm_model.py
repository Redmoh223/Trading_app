import numpy as np
import tensorflow as tf
from tensorflow import keras
from tensorflow.keras import layers
from typing import Dict, List, Optional, Tuple
import os
import joblib


class LstmMarketModel:
    """LSTM-based model for millisecond-resolution market direction prediction.

    Architecture: LSTM -> Dense -> Dropout -> Dense(sigmoid)
    Input: sequence of tick features (window_size x feature_dim)
    Output: probability of upward movement (buy signal confidence)
    """

    FEATURE_COLUMNS = [
        "return_1m",
        "return_5m",
        "return_15m",
        "volatility",
        "bid_ask_imbalance",
        "volume_imbalance",
        "rsi",
        "momentum",
    ]

    def __init__(
        self,
        window_size: int = 50,
        feature_dim: int = 8,
        lstm_units: int = 64,
        dropout: float = 0.2,
        learning_rate: float = 0.001,
        model_path: Optional[str] = None,
    ):
        self.window_size = window_size
        self.feature_dim = feature_dim
        self.lstm_units = lstm_units
        self.dropout = dropout
        self.learning_rate = learning_rate
        self.model_path = model_path
        self.model: Optional[keras.Model] = None
        self.scaler_mean: Optional[np.ndarray] = None
        self.scaler_std: Optional[np.ndarray] = None

        if model_path and os.path.exists(model_path):
            self.load(model_path)
        else:
            self._build()

    def _build(self) -> None:
        inputs = keras.Input(shape=(self.window_size, self.feature_dim))
        x = layers.LSTM(self.lstm_units, return_sequences=True)(inputs)
        x = layers.Dropout(self.dropout)(x)
        x = layers.LSTM(self.lstm_units // 2)(x)
        x = layers.Dropout(self.dropout)(x)
        x = layers.Dense(32, activation="relu")(x)
        x = layers.Dropout(self.dropout)(x)
        outputs = layers.Dense(1, activation="sigmoid")(x)

        self.model = keras.Model(inputs, outputs)
        self.model.compile(
            optimizer=keras.optimizers.Adam(learning_rate=self.learning_rate),
            loss="binary_crossentropy",
            metrics=["accuracy", keras.metrics.AUC()],
        )

    def fit(
        self,
        X: np.ndarray,
        y: np.ndarray,
        validation_split: float = 0.2,
        epochs: int = 50,
        batch_size: int = 32,
    ) -> keras.callbacks.History:
        if self.model is None:
            self._build()

        X = self._fit_scaler(X)
        y = y.astype(np.float32)

        early_stop = keras.callbacks.EarlyStopping(
            monitor="val_loss", patience=10, restore_best_weights=True
        )
        reduce_lr = keras.callbacks.ReduceLROnPlateau(
            monitor="val_loss", factor=0.5, patience=5, min_lr=1e-6
        )

        history = self.model.fit(
            X,
            y,
            validation_split=validation_split,
            epochs=epochs,
            batch_size=batch_size,
            callbacks=[early_stop, reduce_lr],
            verbose=1,
        )
        return history

    def _fit_scaler(self, X: np.ndarray) -> np.ndarray:
        """Fit and apply standard scaler on flattened features."""
        flat = X.reshape(-1, X.shape[-1])
        self.scaler_mean = np.mean(flat, axis=0)
        self.scaler_std = np.std(flat, axis=0) + 1e-8
        X_scaled = (X - self.scaler_mean) / self.scaler_std
        return X_scaled.astype(np.float32)

    def _transform_scaler(self, X: np.ndarray) -> np.ndarray:
        if self.scaler_mean is None or self.scaler_std is None:
            return X.astype(np.float32)
        return ((X - self.scaler_mean) / self.scaler_std).astype(np.float32)

    def predict_proba(self, X: np.ndarray) -> np.ndarray:
        if self.model is None:
            raise ValueError("Model not built or loaded")
        X_scaled = self._transform_scaler(X)
        return self.model.predict(X_scaled, verbose=0)

    def predict(self, X: np.ndarray, threshold: float = 0.5) -> np.ndarray:
        proba = self.predict_proba(X)
        return (proba >= threshold).astype(np.int32)

    def predict_single(self, features: np.ndarray) -> Dict[str, float]:
        """Predict on a single feature vector (window_size x feature_dim)."""
        X = features.reshape(1, self.window_size, self.feature_dim)
        proba = float(self.predict_proba(X)[0][0])
        side = "buy" if proba >= 0.5 else "sell"
        return {
            "side": side,
            "confidence": proba if side == "buy" else 1.0 - proba,
            "probability_up": proba,
        }

    def save(self, path: str) -> None:
        if self.model is None:
            raise ValueError("No model to save")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        self.model.save(path)
        scaler_path = path.replace(".h5", "_scaler.joblib").replace(".keras", "_scaler.joblib")
        joblib.dump(
            {"mean": self.scaler_mean, "std": self.scaler_std},
            scaler_path,
        )

    def load(self, path: str) -> None:
        self.model = keras.models.load_model(path)
        scaler_path = path.replace(".h5", "_scaler.joblib").replace(".keras", "_scaler.joblib")
        if os.path.exists(scaler_path):
            scaler = joblib.load(scaler_path)
            self.scaler_mean = scaler["mean"]
            self.scaler_std = scaler["std"]

    def summary(self) -> str:
        if self.model is None:
            return "Model not built"
        lines: List[str] = []
        self.model.summary(print_fn=lambda x: lines.append(x))
        return "\n".join(lines)


class TransformerMarketModel:
    """Transformer/Attention model for high-frequency market microstructure prediction.

    Uses multi-head self-attention over tick sequences to capture
    long-range dependencies at millisecond resolution.
    """

    def __init__(
        self,
        window_size: int = 50,
        feature_dim: int = 8,
        num_heads: int = 4,
        ff_dim: int = 64,
        num_layers: int = 2,
        dropout: float = 0.2,
        learning_rate: float = 0.001,
        model_path: Optional[str] = None,
    ):
        self.window_size = window_size
        self.feature_dim = feature_dim
        self.num_heads = num_heads
        self.ff_dim = ff_dim
        self.num_layers = num_layers
        self.dropout = dropout
        self.learning_rate = learning_rate
        self.model_path = model_path
        self.model: Optional[keras.Model] = None

        if model_path and os.path.exists(model_path):
            self.model = keras.models.load_model(model_path)
        else:
            self._build()

    def _build(self) -> None:
        inputs = keras.Input(shape=(self.window_size, self.feature_dim))
        x = layers.Dense(self.ff_dim, activation="relu")(inputs)

        for _ in range(self.num_layers):
            attn_output = layers.MultiHeadAttention(
                num_heads=self.num_heads, key_dim=self.ff_dim // self.num_heads
            )(x, x)
            x = layers.LayerNormalization(epsilon=1e-6)(x + attn_output)
            ffn_output = layers.Dense(self.ff_dim, activation="relu")(x)
            ffn_output = layers.Dense(self.feature_dim)(ffn_output)
            x = layers.LayerNormalization(epsilon=1e-6)(x + ffn_output)
            x = layers.Dropout(self.dropout)(x)

        x = layers.GlobalAveragePooling1D()(x)
        x = layers.Dense(32, activation="relu")(x)
        x = layers.Dropout(self.dropout)(x)
        outputs = layers.Dense(1, activation="sigmoid")(x)

        self.model = keras.Model(inputs, outputs)
        self.model.compile(
            optimizer=keras.optimizers.Adam(learning_rate=self.learning_rate),
            loss="binary_crossentropy",
            metrics=["accuracy"],
        )

    def fit(
        self,
        X: np.ndarray,
        y: np.ndarray,
        validation_split: float = 0.2,
        epochs: int = 50,
        batch_size: int = 32,
    ) -> keras.callbacks.History:
        y = y.astype(np.float32)
        early_stop = keras.callbacks.EarlyStopping(
            monitor="val_loss", patience=10, restore_best_weights=True
        )
        return self.model.fit(
            X,
            y,
            validation_split=validation_split,
            epochs=epochs,
            batch_size=batch_size,
            callbacks=[early_stop],
            verbose=1,
        )

    def predict_proba(self, X: np.ndarray) -> np.ndarray:
        if self.model is None:
            raise ValueError("Model not built or loaded")
        return self.model.predict(X.astype(np.float32), verbose=0)

    def predict_single(self, features: np.ndarray) -> Dict[str, float]:
        X = features.reshape(1, self.window_size, self.feature_dim)
        proba = float(self.predict_proba(X)[0][0])
        side = "buy" if proba >= 0.5 else "sell"
        return {
            "side": side,
            "confidence": proba if side == "buy" else 1.0 - proba,
            "probability_up": proba,
        }

    def save(self, path: str) -> None:
        if self.model is None:
            raise ValueError("No model to save")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        self.model.save(path)

    def load(self, path: str) -> None:
        self.model = keras.models.load_model(path)


class OnlineLearningModel:
    """Lightweight online learning model using SGD for real-time adaptation.

    Suitable for millisecond-level inference where model weights are
    updated incrementally after each trade outcome.
    """

    def __init__(self, feature_dim: int = 8, learning_rate: float = 0.01):
        self.feature_dim = feature_dim
        self.learning_rate = learning_rate
        self.weights = np.random.randn(feature_dim) * 0.01
        self.bias = 0.0
        self.history: List[Tuple[np.ndarray, int]] = []

    def predict_proba(self, features: np.ndarray) -> float:
        z = float(np.dot(features, self.weights) + self.bias)
        return float(1.0 / (1.0 + np.exp(-z)))

    def predict(self, features: np.ndarray, threshold: float = 0.5) -> Dict[str, float]:
        proba = self.predict_proba(features)
        side = "buy" if proba >= threshold else "sell"
        return {
            "side": side,
            "confidence": proba if side == "buy" else 1.0 - proba,
            "probability_up": proba,
        }

    def update(self, features: np.ndarray, label: int) -> None:
        """SGD update on logistic loss."""
        proba = self.predict_proba(features)
        error = proba - label
        self.weights -= self.learning_rate * error * features
        self.bias -= self.learning_rate * error
        self.history.append((features.copy(), label))

        if len(self.history) > 10000:
            self.history = self.history[-10000:]
