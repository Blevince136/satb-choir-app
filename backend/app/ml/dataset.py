from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from music21 import clef, converter, note, pitch, stream


VOICE_TO_LABEL = {
    "Soprano": 0,
    "Alto": 1,
    "Tenor": 2,
    "Bass": 3,
}
LABEL_TO_VOICE = {value: key for key, value in VOICE_TO_LABEL.items()}
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


@dataclass
class NoteFeatureRow:
    source_file: str
    part_name: str
    measure_number: int
    offset: float
    midi_pitch: int
    duration_quarter_length: float
    octave: int
    staff_number: int
    is_treble_clef: int
    is_bass_clef: int
    pitch_class: int
    beat_strength: float
    voice_hint: int
    label_name: str
    label_id: int

    def to_dict(self) -> dict[str, str | int | float]:
        return asdict(self)


def extract_labeled_note_rows(score_path: Path) -> list[NoteFeatureRow]:
    parsed_score = converter.parse(str(score_path))
    extracted_rows: list[NoteFeatureRow] = []

    for current_note in parsed_score.recurse().notes:
        if not isinstance(current_note, note.Note):
            continue

        label_name = infer_label_from_context(current_note)
        if label_name is None:
            continue

        current_pitch = current_note.pitch
        current_clef = current_note.getContextByClass(clef.Clef)
        measure = current_note.getContextByClass(stream.Measure)
        part = current_note.getContextByClass(stream.Part)
        feature_values = build_feature_values(current_note)

        extracted_rows.append(
            NoteFeatureRow(
                source_file=score_path.name,
                part_name=(part.partName or part.id) if part is not None else "",
                measure_number=int(feature_values["measure_number"]),
                offset=float(feature_values["offset"]),
                midi_pitch=int(feature_values["midi_pitch"]),
                duration_quarter_length=float(feature_values["duration_quarter_length"]),
                octave=int(feature_values["octave"]),
                staff_number=int(feature_values["staff_number"]),
                is_treble_clef=int(feature_values["is_treble_clef"]),
                is_bass_clef=int(feature_values["is_bass_clef"]),
                pitch_class=int(feature_values["pitch_class"]),
                beat_strength=float(feature_values["beat_strength"]),
                voice_hint=int(feature_values["voice_hint"]),
                label_name=label_name,
                label_id=VOICE_TO_LABEL[label_name],
            )
        )

    return extracted_rows


def build_feature_values(
    current_note: note.Note,
    midi_override: int | None = None,
) -> dict[str, float]:
    current_pitch = current_note.pitch
    pitch_midi = int(midi_override if midi_override is not None else current_pitch.midi)
    current_clef = current_note.getContextByClass(clef.Clef)
    measure = current_note.getContextByClass(stream.Measure)
    voice_stream = current_note.getContextByClass(stream.Voice)

    return {
        "measure_number": float(measure.number if measure is not None and measure.number else 0),
        "offset": float(current_note.offset),
        "midi_pitch": float(pitch_midi),
        "duration_quarter_length": float(current_note.duration.quarterLength),
        "octave": float(current_pitch.octave or 0),
        "staff_number": float(int(getattr(current_note, "staffNumber", 0) or 0)),
        "is_treble_clef": float(int(isinstance(current_clef, clef.TrebleClef))),
        "is_bass_clef": float(int(isinstance(current_clef, clef.BassClef))),
        "pitch_class": float(int(pitch_midi % 12)),
        "beat_strength": float(current_note.beatStrength or 0.0),
        "voice_hint": float(_normalize_voice_hint(voice_stream.id if voice_stream else None)),
    }


def feature_vector_from_note(
    current_note: note.Note,
    midi_override: int | None = None,
) -> list[float]:
    values = build_feature_values(current_note, midi_override)
    return [float(values[column]) for column in FEATURE_COLUMNS]


def rows_to_training_arrays(
    rows: list[dict[str, Any]],
) -> tuple[list[list[float]], list[int], list[str]]:
    features = [
        [float(row[column]) for column in FEATURE_COLUMNS]
        for row in rows
    ]
    labels = [int(row["label_id"]) for row in rows]
    groups = [str(row["source_file"]) for row in rows]
    return features, labels, groups


def infer_label_from_context(current_note: note.Note) -> str | None:
    part = current_note.getContextByClass(stream.Part)
    part_name = ((part.partName or part.id) if part is not None else "").lower()

    for voice_name in VOICE_TO_LABEL:
        if voice_name.lower() in part_name:
            return voice_name

    current_pitch = int(current_note.pitch.midi)
    current_clef = current_note.getContextByClass(clef.Clef)
    voice_stream = current_note.getContextByClass(stream.Voice)
    voice_hint = str(voice_stream.id).strip() if voice_stream and voice_stream.id is not None else ""

    if isinstance(current_clef, clef.TrebleClef):
        if voice_hint == "1":
            return "Soprano"
        if voice_hint == "2":
            return "Alto"
        return "Soprano" if current_pitch >= pitch.Pitch("C5").midi else "Alto"

    if isinstance(current_clef, clef.BassClef):
        if voice_hint == "1":
            return "Tenor"
        if voice_hint == "2":
            return "Bass"
        return "Tenor" if current_pitch >= pitch.Pitch("C4").midi else "Bass"

    return closest_range_label(current_pitch)


def closest_range_label(midi_pitch: int) -> str:
    ranges = {
        "Soprano": (pitch.Pitch("C4").midi, pitch.Pitch("A5").midi),
        "Alto": (pitch.Pitch("G3").midi, pitch.Pitch("D5").midi),
        "Tenor": (pitch.Pitch("C3").midi, pitch.Pitch("G4").midi),
        "Bass": (pitch.Pitch("E2").midi, pitch.Pitch("C4").midi),
    }

    best_label = "Alto"
    best_distance: float | None = None

    for label, (low, high) in ranges.items():
        midpoint = (low + high) / 2
        distance = abs(midi_pitch - midpoint)
        if best_distance is None or distance < best_distance:
            best_distance = distance
            best_label = label

    return best_label


def _normalize_voice_hint(voice_id: object | None) -> int:
    if voice_id is None:
        return 0

    try:
        return int(str(voice_id))
    except ValueError:
        return 0
