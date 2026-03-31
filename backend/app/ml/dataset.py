from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path

from music21 import clef, converter, note, pitch, stream


VOICE_TO_LABEL = {
    "Soprano": 0,
    "Alto": 1,
    "Tenor": 2,
    "Bass": 3,
}


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
        voice_stream = current_note.getContextByClass(stream.Voice)

        extracted_rows.append(
            NoteFeatureRow(
                source_file=score_path.name,
                part_name=(part.partName or part.id) if part is not None else "",
                measure_number=measure.number if measure is not None and measure.number else 0,
                offset=float(current_note.offset),
                midi_pitch=int(current_pitch.midi),
                duration_quarter_length=float(current_note.duration.quarterLength),
                octave=current_pitch.octave or 0,
                staff_number=int(getattr(current_note, "staffNumber", 0) or 0),
                is_treble_clef=int(isinstance(current_clef, clef.TrebleClef)),
                is_bass_clef=int(isinstance(current_clef, clef.BassClef)),
                pitch_class=int(current_pitch.pitchClass),
                beat_strength=float(current_note.beatStrength or 0.0),
                voice_hint=_normalize_voice_hint(voice_stream.id if voice_stream else None),
                label_name=label_name,
                label_id=VOICE_TO_LABEL[label_name],
            )
        )

    return extracted_rows


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
