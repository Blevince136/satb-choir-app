from __future__ import annotations

import argparse
import csv
from pathlib import Path
import sys

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.ml.dataset import extract_labeled_note_rows


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Extract note-level SATB training rows from MusicXML and MIDI files."
    )
    parser.add_argument(
        "input_dir",
        type=Path,
        help="Folder containing MusicXML, XML, MXL, MID, or MIDI files.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("data") / "satb_note_dataset.csv",
        help="CSV output path for the extracted dataset.",
    )
    args = parser.parse_args()

    score_files = sorted(
        [
            *args.input_dir.rglob("*.musicxml"),
            *args.input_dir.rglob("*.xml"),
            *args.input_dir.rglob("*.mxl"),
            *args.input_dir.rglob("*.mid"),
            *args.input_dir.rglob("*.midi"),
        ]
    )

    if not score_files:
        raise SystemExit("No MusicXML/MIDI files found in the input directory.")

    rows = []
    for score_file in score_files:
        rows.extend(extract_labeled_note_rows(score_file))

    args.output.parent.mkdir(parents=True, exist_ok=True)

    with args.output.open("w", newline="", encoding="utf-8") as csv_file:
        writer = csv.DictWriter(csv_file, fieldnames=list(rows[0].to_dict().keys()))
        writer.writeheader()
        for row in rows:
            writer.writerow(row.to_dict())

    print(f"Extracted {len(rows)} labeled note rows from {len(score_files)} scores.")
    print(f"Dataset saved to {args.output}")


if __name__ == "__main__":
    main()
