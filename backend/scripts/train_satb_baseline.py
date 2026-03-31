from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
import sys

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

try:
    import joblib
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.metrics import accuracy_score, classification_report
    from sklearn.model_selection import GroupShuffleSplit
except ImportError as exc:  # pragma: no cover - import guidance only
    raise SystemExit(
        "Install scikit-learn and joblib first: pip install scikit-learn joblib"
    ) from exc

from app.ml.dataset import FEATURE_COLUMNS, rows_to_training_arrays


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
    parser.add_argument(
        "--metrics-output",
        type=Path,
        default=Path("artifacts") / "satb_random_forest_metrics.json",
        help="Path for evaluation metrics JSON.",
    )
    args = parser.parse_args()

    rows = []
    with args.dataset_csv.open("r", encoding="utf-8") as csv_file:
        reader = csv.DictReader(csv_file)
        rows.extend(reader)

    if not rows:
        raise SystemExit("Dataset CSV is empty.")

    features, labels, groups = rows_to_training_arrays(rows)
    unique_groups = sorted(set(groups))
    if len(unique_groups) < 2:
        raise SystemExit("Need at least two distinct score files for score-level evaluation.")

    splitter = GroupShuffleSplit(
        n_splits=1,
        test_size=0.2,
        random_state=42,
    )
    train_indices, test_indices = next(splitter.split(features, labels, groups))

    x_train = [features[index] for index in train_indices]
    x_test = [features[index] for index in test_indices]
    y_train = [labels[index] for index in train_indices]
    y_test = [labels[index] for index in test_indices]
    train_groups = sorted({groups[index] for index in train_indices})
    test_groups = sorted({groups[index] for index in test_indices})

    classifier = RandomForestClassifier(
        n_estimators=200,
        max_depth=12,
        random_state=42,
    )
    classifier.fit(x_train, y_train)

    predictions = classifier.predict(x_test)
    accuracy = accuracy_score(y_test, predictions)
    report_dict = classification_report(y_test, predictions, output_dict=True)

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

    metrics_payload = {
        "accuracy": accuracy,
        "feature_columns": FEATURE_COLUMNS,
        "train_files": train_groups,
        "test_files": test_groups,
        "train_note_count": len(train_indices),
        "test_note_count": len(test_indices),
        "report": report_dict,
    }
    args.metrics_output.parent.mkdir(parents=True, exist_ok=True)
    args.metrics_output.write_text(
        json.dumps(metrics_payload, indent=2),
        encoding="utf-8",
    )

    print(f"Baseline SATB accuracy: {accuracy:.4f}")
    print(f"Train files ({len(train_groups)}): {train_groups}")
    print(f"Test files ({len(test_groups)}): {test_groups}")
    print(classification_report(y_test, predictions))
    print(f"Model saved to {args.model_output}")
    print(f"Metrics saved to {args.metrics_output}")


if __name__ == "__main__":
    main()
