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
    import torch
    from torch import nn
    from torch.utils.data import DataLoader, TensorDataset
    TORCH_AVAILABLE = True
    TORCH_ERROR: str | None = None
except Exception as exc:  # noqa: BLE001
    torch = None  # type: ignore[assignment]
    nn = None  # type: ignore[assignment]
    DataLoader = None  # type: ignore[assignment]
    TensorDataset = None  # type: ignore[assignment]
    TORCH_AVAILABLE = False
    TORCH_ERROR = str(exc)

from sklearn.metrics import accuracy_score, classification_report
from sklearn.model_selection import GroupShuffleSplit
from sklearn.neural_network import MLPClassifier

from app.ml.dataset import FEATURE_COLUMNS, rows_to_training_arrays


if TORCH_AVAILABLE:
    class SatbNet(nn.Module):
        def __init__(self, input_dim: int, output_dim: int = 4) -> None:
            super().__init__()
            self.network = nn.Sequential(
                nn.Linear(input_dim, 64),
                nn.ReLU(),
                nn.Dropout(0.2),
                nn.Linear(64, 32),
                nn.ReLU(),
                nn.Linear(32, output_dim),
            )

        def forward(self, inputs: torch.Tensor) -> torch.Tensor:
            return self.network(inputs)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Train a neural-network SATB classifier from the extracted dataset."
    )
    parser.add_argument("dataset_csv", type=Path, help="CSV created by build_satb_dataset.py")
    parser.add_argument(
        "--model-output",
        type=Path,
        default=Path("artifacts") / "satb_neural.pt",
        help="Path for the trained neural-network artifact.",
    )
    parser.add_argument(
        "--metrics-output",
        type=Path,
        default=Path("artifacts") / "satb_neural_metrics.json",
        help="Path for neural evaluation metrics JSON.",
    )
    parser.add_argument("--epochs", type=int, default=30, help="Training epochs.")
    parser.add_argument("--batch-size", type=int, default=128, help="Training batch size.")
    args = parser.parse_args()

    rows = []
    with args.dataset_csv.open("r", encoding="utf-8") as csv_file:
        rows.extend(csv.DictReader(csv_file))

    if not rows:
        raise SystemExit("Dataset CSV is empty.")

    features, labels, groups = rows_to_training_arrays(rows)
    unique_groups = sorted(set(groups))
    if len(unique_groups) < 2:
        raise SystemExit("Need at least two distinct score files for score-level evaluation.")

    splitter = GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=42)
    train_indices, test_indices = next(splitter.split(features, labels, groups))

    x_train = [features[index] for index in train_indices]
    x_test = [features[index] for index in test_indices]
    y_train = [labels[index] for index in train_indices]
    y_test_list = [labels[index] for index in test_indices]

    model_backend = "sklearn-mlp"
    artifact_payload: dict[str, object]

    if TORCH_AVAILABLE:
        x_train_tensor = torch.tensor(x_train, dtype=torch.float32)
        x_test_tensor = torch.tensor(x_test, dtype=torch.float32)
        y_train_tensor = torch.tensor(y_train, dtype=torch.long)

        train_mean = x_train_tensor.mean(dim=0, keepdim=True)
        train_std = x_train_tensor.std(dim=0, keepdim=True)
        train_std[train_std == 0] = 1.0

        x_train_tensor = (x_train_tensor - train_mean) / train_std
        x_test_tensor = (x_test_tensor - train_mean) / train_std

        train_loader = DataLoader(
            TensorDataset(x_train_tensor, y_train_tensor),
            batch_size=args.batch_size,
            shuffle=True,
        )

        model = SatbNet(input_dim=len(FEATURE_COLUMNS))
        optimizer = torch.optim.Adam(model.parameters(), lr=0.001)
        criterion = nn.CrossEntropyLoss()

        model.train()
        for epoch in range(args.epochs):
            epoch_loss = 0.0
            for batch_features, batch_labels in train_loader:
                optimizer.zero_grad()
                outputs = model(batch_features)
                loss = criterion(outputs, batch_labels)
                loss.backward()
                optimizer.step()
                epoch_loss += float(loss.item())

            print(
                f"Epoch {epoch + 1}/{args.epochs} - loss: "
                f"{epoch_loss / max(len(train_loader), 1):.4f}"
            )

        model.eval()
        with torch.no_grad():
            logits = model(x_test_tensor)
            predictions = torch.argmax(logits, dim=1).cpu().tolist()

        artifact_payload = {
            "backend": "pytorch",
            "state_dict": model.state_dict(),
            "feature_columns": FEATURE_COLUMNS,
            "train_mean": train_mean,
            "train_std": train_std,
            "label_map": {
                0: "Soprano",
                1: "Alto",
                2: "Tenor",
                3: "Bass",
            },
        }
        model_backend = "pytorch"
    else:
        print("PyTorch unavailable, using sklearn MLP fallback.")
        if TORCH_ERROR:
            print(f"PyTorch issue: {TORCH_ERROR}")

        model = MLPClassifier(
            hidden_layer_sizes=(64, 32, 16),
            activation="relu",
            solver="adam",
            learning_rate_init=0.001,
            max_iter=args.epochs,
            random_state=42,
        )
        model.fit(x_train, y_train)
        predictions = model.predict(x_test).tolist()

        artifact_payload = {
            "backend": "sklearn-mlp",
            "model": model,
            "feature_columns": FEATURE_COLUMNS,
            "label_map": {
                0: "Soprano",
                1: "Alto",
                2: "Tenor",
                3: "Bass",
            },
            "torch_error": TORCH_ERROR,
        }

    accuracy = accuracy_score(y_test_list, predictions)
    report_dict = classification_report(y_test_list, predictions, output_dict=True)

    args.model_output.parent.mkdir(parents=True, exist_ok=True)
    if model_backend == "pytorch":
        torch.save(artifact_payload, args.model_output)
    else:
        import joblib

        joblib.dump(artifact_payload, args.model_output.with_suffix(".joblib"))

    metrics_payload = {
        "accuracy": accuracy,
        "backend": model_backend,
        "feature_columns": FEATURE_COLUMNS,
        "train_files": sorted({groups[index] for index in train_indices}),
        "test_files": sorted({groups[index] for index in test_indices}),
        "train_note_count": len(train_indices),
        "test_note_count": len(test_indices),
        "epochs": args.epochs,
        "batch_size": args.batch_size,
        "report": report_dict,
    }
    args.metrics_output.parent.mkdir(parents=True, exist_ok=True)
    args.metrics_output.write_text(json.dumps(metrics_payload, indent=2), encoding="utf-8")

    print(f"Neural SATB accuracy: {accuracy:.4f}")
    print(classification_report(y_test_list, predictions))
    if model_backend == "pytorch":
        print(f"Neural model saved to {args.model_output}")
    else:
        print(f"Neural model saved to {args.model_output.with_suffix('.joblib')}")
    print(f"Metrics saved to {args.metrics_output}")


if __name__ == "__main__":
    main()
