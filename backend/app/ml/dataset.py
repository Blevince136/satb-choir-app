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
    "event_pitch_count",
    "is_top_note",
    "is_bottom_note",
    "pitch_distance_from_top",
    "pitch_distance_from_bottom",
    "monophonic_passage",
    "treble_primary_voice",
    "bass_primary_voice",
    "part_index",
    "part_count",
    "four_staff_satb_layout",
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
    event_pitch_count: int
    is_top_note: int
    is_bottom_note: int
    pitch_distance_from_top: float
    pitch_distance_from_bottom: float
    monophonic_passage: int
    treble_primary_voice: int
    bass_primary_voice: int
    part_index: int
    part_count: int
    four_staff_satb_layout: int
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
                event_pitch_count=int(feature_values["event_pitch_count"]),
                is_top_note=int(feature_values["is_top_note"]),
                is_bottom_note=int(feature_values["is_bottom_note"]),
                pitch_distance_from_top=float(feature_values["pitch_distance_from_top"]),
                pitch_distance_from_bottom=float(feature_values["pitch_distance_from_bottom"]),
                monophonic_passage=int(feature_values["monophonic_passage"]),
                treble_primary_voice=int(feature_values["treble_primary_voice"]),
                bass_primary_voice=int(feature_values["bass_primary_voice"]),
                part_index=int(feature_values["part_index"]),
                part_count=int(feature_values["part_count"]),
                four_staff_satb_layout=int(feature_values["four_staff_satb_layout"]),
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
    pair_name = _resolve_staff_pair_name(current_note)
    event_pitches = _event_pitches_for_staff_moment(current_note, pair_name) if pair_name else [pitch_midi]
    highest_pitch = max(event_pitches) if event_pitches else pitch_midi
    lowest_pitch = min(event_pitches) if event_pitches else pitch_midi
    monophonic_passage = _is_monophonic_passage(current_note, pair_name) if pair_name else False
    part = current_note.getContextByClass(stream.Part)
    score = current_note.getContextByClass(stream.Score)
    part_index, part_count, four_staff_satb_layout = _part_layout_context(part, score)

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
        "event_pitch_count": float(len(event_pitches)),
        "is_top_note": float(int(pitch_midi >= highest_pitch)),
        "is_bottom_note": float(int(pitch_midi <= lowest_pitch)),
        "pitch_distance_from_top": float(max(highest_pitch - pitch_midi, 0)),
        "pitch_distance_from_bottom": float(max(pitch_midi - lowest_pitch, 0)),
        "monophonic_passage": float(int(monophonic_passage)),
        "treble_primary_voice": float(int(pair_name == "treble" and monophonic_passage)),
        "bass_primary_voice": float(int(pair_name == "bass" and monophonic_passage)),
        "part_index": float(part_index),
        "part_count": float(part_count),
        "four_staff_satb_layout": float(int(four_staff_satb_layout)),
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

    explicit_staff_voice = _explicit_staff_voice(current_note)
    if explicit_staff_voice is not None:
        return explicit_staff_voice

    pair_name = _resolve_staff_pair_name(current_note)
    if pair_name is not None:
        event_pitches = _event_pitches_for_staff_moment(current_note, pair_name)
        if _is_monophonic_passage(current_note, pair_name):
            return "Soprano" if pair_name == "treble" else "Tenor"

        if len(event_pitches) == 1:
            # Shared unison notes are handled directly in parsing and are ambiguous as single-label training examples.
            return None

        current_pitch = int(current_note.pitch.midi)
        upper_voice, lower_voice = ("Soprano", "Alto") if pair_name == "treble" else ("Tenor", "Bass")
        if current_pitch >= max(event_pitches):
            return upper_voice
        if current_pitch <= min(event_pitches):
            return lower_voice

        upper_midpoint = (pitch.Pitch("C5").midi + pitch.Pitch("A5").midi) / 2 if pair_name == "treble" else (pitch.Pitch("C3").midi + pitch.Pitch("G4").midi) / 2
        lower_midpoint = (pitch.Pitch("G3").midi + pitch.Pitch("D5").midi) / 2 if pair_name == "treble" else (pitch.Pitch("E2").midi + pitch.Pitch("C4").midi) / 2
        return upper_voice if abs(current_pitch - upper_midpoint) <= abs(current_pitch - lower_midpoint) else lower_voice

    current_pitch = int(current_note.pitch.midi)
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


def _resolve_staff_pair_name(current_note: note.Note) -> str | None:
    current_clef = current_note.getContextByClass(clef.Clef)
    if isinstance(current_clef, clef.TrebleClef):
        return "treble"
    if isinstance(current_clef, clef.BassClef):
        return "bass"

    staff_number = str(int(getattr(current_note, "staffNumber", 0) or 0))
    if staff_number == "1":
        return "treble"
    if staff_number == "2":
        return "bass"
    return None


def _event_pitches_for_staff_moment(current_note: note.Note, pair_name: str | None) -> list[int]:
    if pair_name is None:
        return [int(current_note.pitch.midi)]

    measure = current_note.getContextByClass(stream.Measure)
    if measure is None:
        return [int(current_note.pitch.midi)]

    same_time_items = [
        item
        for item in measure.notes
        if abs(float(item.offset) - float(current_note.offset)) < 1e-6
        and _resolve_staff_pair_name(item) == pair_name
    ]

    collected_midis: list[int] = []
    for item in same_time_items:
        if isinstance(item, note.Note):
            collected_midis.append(int(item.pitch.midi))
        else:
            collected_midis.extend(int(current_pitch.midi) for current_pitch in item.pitches)

    return sorted(collected_midis) if collected_midis else [int(current_note.pitch.midi)]


def _is_monophonic_passage(current_note: note.Note, pair_name: str | None) -> bool:
    if pair_name is None:
        return False

    measure = current_note.getContextByClass(stream.Measure)
    if measure is None:
        return False

    same_clef_items = [item for item in measure.notes if _resolve_staff_pair_name(item) == pair_name]
    if not same_clef_items:
        return False

    return all(_note_event_pitch_count(item) == 1 for item in same_clef_items)


def _note_event_pitch_count(current_note: note.Note) -> int:
    if isinstance(current_note, note.Note):
        return 1
    return len(current_note.pitches)


def _part_layout_context(
    part: stream.Part | None,
    score: stream.Score | None,
) -> tuple[int, int, bool]:
    if part is None or score is None:
        return 0, 0, False

    ordered_parts = list(score.parts)
    try:
        part_index = ordered_parts.index(part)
    except ValueError:
        part_index = 0

    part_count = len(ordered_parts)
    four_staff_layout = part_count >= 4
    return part_index, part_count, four_staff_layout


def _explicit_staff_voice(current_note: note.Note) -> str | None:
    explicit_staff_map = _explicit_staff_number_voice_map(current_note)
    staff_number = str(int(getattr(current_note, "staffNumber", 0) or 0))
    if staff_number and staff_number in explicit_staff_map:
        return explicit_staff_map[staff_number]

    part = current_note.getContextByClass(stream.Part)
    score = current_note.getContextByClass(stream.Score)
    if part is None or score is None:
        return None

    part_index, part_count, four_staff_layout = _part_layout_context(part, score)
    if not four_staff_layout:
        return None

    current_clef = current_note.getContextByClass(clef.Clef)
    if part_index == 0 and isinstance(current_clef, clef.TrebleClef):
        return "Soprano"
    if part_index == 1 and isinstance(current_clef, clef.TrebleClef):
        return "Alto"
    if part_index == 2 and isinstance(current_clef, clef.BassClef):
        return "Tenor"
    if part_index == 3 and isinstance(current_clef, clef.BassClef):
        return "Bass"

    return None


def _explicit_staff_number_voice_map(current_note: note.Note) -> dict[str, str]:
    score = current_note.getContextByClass(stream.Score)
    if score is None:
        return {}

    staff_numbers = sorted(
        {
            str(int(getattr(item, "staffNumber", 0) or 0))
            for item in score.recurse().notes
            if int(getattr(item, "staffNumber", 0) or 0) > 0
        },
        key=int,
    )

    if len(staff_numbers) < 4:
        return {}

    return {
        staff_numbers[0]: "Soprano",
        staff_numbers[1]: "Alto",
        staff_numbers[2]: "Tenor",
        staff_numbers[3]: "Bass",
    }
