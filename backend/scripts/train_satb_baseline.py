from __future__ import annotations

import argparse
import csv
from pathlib import Path
import sys

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

try:
    import joblib
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.metrics import accuracy_score, classification_report
    from sklearn.model_selection import train_test_split
except ImportError as exc:  # pragma: no cover - import guidance only
    raise SystemExit(
        "Install scikit-learn and joblib first: pip install scikit-learn joblib"
    ) from exc


FEATURE_COLUMNS = [
    "measure_number",
    "offset",
    "midi_pitch",
    "duration_quarter_length",
    "octave",
    "staff_number",
    "is_treble_clef",
    "is_bass_clef",
    "pitch_class",
    "beat_strength",
    "voice_hint",
]


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Train a baseline SATB note classifier from the extracted dataset."
    )
    parser.add_argument(
        "dataset_csv",
        type=Path,
        help="CSV created by build_satb_dataset.py",
    )
    parser.add_argument(
        "--model-output",
        type=Path,
        default=Path("artifacts") / "satb_random_forest.joblib",
        help="Path for the trained baseline model artifact.",
    )
    args = parser.parse_args()

    rows = []
    with args.dataset_csv.open("r", encoding="utf-8") as csv_file:
        reader = csv.DictReader(csv_file)
        rows.extend(reader)

    if not rows:
        raise SystemExit("Dataset CSV is empty.")

    features = [
        [float(row[column]) for column in FEATURE_COLUMNS]
        for row in rows
    ]
    labels = [int(row["label_id"]) for row in rows]

    x_train, x_test, y_train, y_test = train_test_split(
        features,
        labels,
        test_size=0.2,
        random_state=42,
        stratify=labels,
    )

    classifier = RandomForestClassifier(
        n_estimators=200,
        max_depth=12,
        random_state=42,
    )
    classifier.fit(x_train, y_train)

    predictions = classifier.predict(x_test)
    accuracy = accuracy_score(y_test, predictions)

    args.model_output.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(
        {
            "model": classifier,
            "feature_columns": FEATURE_COLUMNS,
            "label_map": {
                0: "Soprano",
                1: "Alto",
                2: "Tenor",
                3: "Bass",
            },
        },
        args.model_output,
    )

    print(f"Baseline SATB accuracy: {accuracy:.4f}")
    print(classification_report(y_test, predictions))
    print(f"Model saved to {args.model_output}")


if __name__ == "__main__":
    main()
