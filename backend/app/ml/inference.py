from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

import joblib

from app.config import settings
from app.ml.dataset import LABEL_TO_VOICE


@lru_cache(maxsize=1)
def load_satb_classifier() -> dict[str, Any] | None:
    if not settings.use_ml_classifier:
        return None

    model_path = Path(settings.satb_model_path)
    if not model_path.is_absolute():
        model_path = Path(__file__).resolve().parents[2] / model_path

    if not model_path.exists():
        return None

    loaded_artifact = joblib.load(model_path)
    if not isinstance(loaded_artifact, dict):
        return None

    return loaded_artifact


def predict_voice_label(feature_vector: list[float]) -> tuple[str, str] | None:
    artifact = load_satb_classifier()
    if artifact is None:
        return None

    model = artifact.get("model")
    label_map = artifact.get("label_map", LABEL_TO_VOICE)
    if model is None:
        return None

    prediction = model.predict([feature_vector])[0]
    return str(label_map.get(int(prediction), "Alto")), "ml-random-forest"
