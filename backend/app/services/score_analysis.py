from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import subprocess
from typing import Iterable
import shutil

from music21 import chord, clef, converter, note, pitch, stream

from app.config import settings
from app.ml.dataset import feature_vector_from_note
from app.ml.inference import predict_voice_label
from app.schemas import ScoreAnalysisResult, VoicePartSummary


SATB_RANGES = {
    "Soprano": (pitch.Pitch("C4").midi, pitch.Pitch("A5").midi),
    "Alto": (pitch.Pitch("G3").midi, pitch.Pitch("D5").midi),
    "Tenor": (pitch.Pitch("C3").midi, pitch.Pitch("G4").midi),
    "Bass": (pitch.Pitch("E2").midi, pitch.Pitch("C4").midi),
}

STAFF_VOICE_PAIRS = {
    "treble": ("Soprano", "Alto"),
    "bass": ("Tenor", "Bass"),
}


@dataclass
class ParsedTone:
    voice_part: str
    midi: int
    name_with_octave: str
    classifier_used: str = "range-fallback"
    source_voice: str | None = None
    source_staff: str | None = None
    source_part: str | None = None
    offset_quarters: float = 0.0
    duration_quarters: float = 1.0


def analyze_score_file(file_path: Path, source_format: str) -> ScoreAnalysisResult:
    normalized_format = source_format.upper()
    parser_used = "music21+staff-stem"
    warnings: list[str] = []
    parse_target = file_path

    if normalized_format == "PDF":
        warnings.extend(
            [
                "PDF scores are not parsed directly as music data.",
                "PDF input must be converted to MusicXML before SATB extraction.",
            ]
        )

        parse_target, pdf_warnings, parser_used = _prepare_pdf_input(file_path)
        warnings.extend(pdf_warnings)

        if parse_target is None:
            return ScoreAnalysisResult(
                source_format="PDF",
                conversion_required=True,
                parser_used=parser_used,
                prepared_source_path=None,
                voices=[],
                warnings=warnings,
            )

    try:
        parsed_score = converter.parse(str(parse_target))
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f"Unable to parse {normalized_format} score: {exc}") from exc

    tones = extract_classified_tones(parsed_score)

    if not tones:
        warnings.append("No note events were detected in the uploaded score.")

    if normalized_format == "MIDI":
        warnings.append(
            "MIDI analysis is heuristic because staff and clef information may be missing."
        )

    classifier_names = sorted({tone.classifier_used for tone in tones})
    if classifier_names:
        parser_used = f"music21+{'+'.join(classifier_names)}"

    voices = [_build_summary(name, tones) for name in ("Soprano", "Alto", "Tenor", "Bass")]

    return ScoreAnalysisResult(
        source_format=normalized_format,
        conversion_required=False,
        parser_used=parser_used,
        prepared_source_path=str(parse_target),
        voices=voices,
        warnings=warnings,
    )


def extract_classified_tones(parsed_score: stream.Score) -> list[ParsedTone]:
    extracted: list[ParsedTone] = []

    for current_element in parsed_score.recurse().notes:
        offset_quarters = float(current_element.getOffsetInHierarchy(parsed_score))
        duration_quarters = float(current_element.duration.quarterLength)
        source_voice = _get_source_voice(current_element)
        source_staff = _get_source_staff(current_element)
        source_part = _get_source_part(current_element)

        if isinstance(current_element, note.Note):
            voice_assignments = _classify_note_assignments(current_element)
            for voice_part, classifier_used in voice_assignments:
                extracted.append(
                    ParsedTone(
                        voice_part=voice_part,
                        midi=int(current_element.pitch.midi),
                        name_with_octave=current_element.pitch.nameWithOctave,
                        classifier_used=classifier_used,
                        source_voice=source_voice,
                        source_staff=source_staff,
                        source_part=source_part,
                        offset_quarters=offset_quarters,
                        duration_quarters=duration_quarters,
                    )
                )
            continue

        if isinstance(current_element, chord.Chord):
            for chord_pitch, voice_part, classifier_used in _classify_chord_assignments(current_element):
                extracted.append(
                    ParsedTone(
                        voice_part=voice_part,
                        midi=int(chord_pitch.midi),
                        name_with_octave=chord_pitch.nameWithOctave,
                        classifier_used=classifier_used,
                        source_voice=source_voice,
                        source_staff=source_staff,
                        source_part=source_part,
                        offset_quarters=offset_quarters,
                        duration_quarters=duration_quarters,
                    )
                )

    return extracted


def _classify_note_assignments(current_note: note.Note) -> list[tuple[str, str]]:
    part_name = (_get_source_part(current_note) or "").lower()
    named_part = _voice_from_part_name(part_name)
    if named_part:
        return [(named_part, "part-name")]

    pair_name = _resolve_staff_pair_name(current_note)
    voice_hint = (_get_source_voice(current_note) or "").strip()
    stem_direction = _normalize_stem_direction(getattr(current_note, "stemDirection", None))
    midi_value = int(current_note.pitch.midi)

    if pair_name is not None:
        upper_voice, lower_voice = STAFF_VOICE_PAIRS[pair_name]

        if voice_hint == "1":
            return [(upper_voice, "voice-id")]
        if voice_hint == "2":
            return [(lower_voice, "voice-id")]

        if _is_unison_context(current_note, pair_name):
            return [(upper_voice, "staff-unison"), (lower_voice, "staff-unison")]

        if stem_direction == "up":
            return [(upper_voice, "staff-stem")]
        if stem_direction == "down":
            return [(lower_voice, "staff-stem")]

        return [(_classify_with_pair(current_note, midi_value, pair_name), "staff-pitch")]

    predicted = predict_voice_label(feature_vector_from_note(current_note))
    if predicted is not None:
        return [(predicted, "ml-fallback")]

    return [(_closest_range_voice(midi_value), "range-fallback")]


def _classify_chord_assignments(current_chord: chord.Chord) -> list[tuple[pitch.Pitch, str, str]]:
    part_name = (_get_source_part(current_chord) or "").lower()
    named_part = _voice_from_part_name(part_name)
    if named_part:
        return [(current_pitch, named_part, "part-name") for current_pitch in current_chord.pitches]

    pair_name = _resolve_staff_pair_name(current_chord)
    voice_hint = (_get_source_voice(current_chord) or "").strip()
    stem_direction = _normalize_stem_direction(getattr(current_chord, "stemDirection", None))
    ordered_pitches = sorted(current_chord.pitches, key=lambda current_pitch: current_pitch.midi)

    if pair_name is not None:
        upper_voice, lower_voice = STAFF_VOICE_PAIRS[pair_name]

        if voice_hint == "1":
            return [(current_pitch, upper_voice, "voice-id") for current_pitch in ordered_pitches]
        if voice_hint == "2":
            return [(current_pitch, lower_voice, "voice-id") for current_pitch in ordered_pitches]

        if len(ordered_pitches) == 1:
            only_pitch = ordered_pitches[0]
            return [
                (only_pitch, upper_voice, "staff-unison"),
                (only_pitch, lower_voice, "staff-unison"),
            ]

        if stem_direction == "up":
            return [(current_pitch, upper_voice, "staff-stem") for current_pitch in ordered_pitches]
        if stem_direction == "down":
            return [(current_pitch, lower_voice, "staff-stem") for current_pitch in ordered_pitches]

        assignments: list[tuple[pitch.Pitch, str, str]] = [
            (ordered_pitches[-1], upper_voice, "staff-chord"),
            (ordered_pitches[0], lower_voice, "staff-chord"),
        ]
        if len(ordered_pitches) > 2:
            for middle_pitch in ordered_pitches[1:-1]:
                assigned_voice = _classify_with_pair(current_chord, int(middle_pitch.midi), pair_name)
                assignments.append((middle_pitch, assigned_voice, "staff-pitch"))
        return assignments

    assignments = []
    for current_pitch in ordered_pitches:
        predicted = predict_voice_label(feature_vector_from_note(current_chord, int(current_pitch.midi)))
        if predicted is not None:
            assignments.append((current_pitch, predicted, "ml-fallback"))
        else:
            assignments.append((current_pitch, _closest_range_voice(int(current_pitch.midi)), "range-fallback"))
    return assignments


def _classify_voice_part(
    current_note: note.NotRest,
    midi_override: int | None = None,
) -> tuple[str, str]:
    if isinstance(current_note, note.Note):
        assignments = _classify_note_assignments(current_note)
        if len(assignments) == 1:
            return assignments[0]
        midi_value = int(midi_override if midi_override is not None else current_note.pitch.midi)
        ordered_assignments = sorted(
            assignments,
            key=lambda assignment: abs(midi_value - ((SATB_RANGES[assignment[0]][0] + SATB_RANGES[assignment[0]][1]) / 2)),
        )
        return ordered_assignments[0]

    if isinstance(current_note, chord.Chord):
        midi_value = int(midi_override if midi_override is not None else current_note.sortAscending().pitches[-1].midi)
        assignments = _classify_chord_assignments(current_note)
        matching = [assignment for assignment in assignments if int(assignment[0].midi) == midi_value]
        if matching:
            return matching[0][1], matching[0][2]
        return assignments[-1][1], assignments[-1][2]

    return _closest_range_voice(int(midi_override or 60)), "range-fallback"


def _resolve_staff_pair_name(current_note: note.NotRest) -> str | None:
    current_clef = current_note.getContextByClass(clef.Clef)
    if isinstance(current_clef, clef.TrebleClef):
        return "treble"
    if isinstance(current_clef, clef.BassClef):
        return "bass"

    staff_number = _get_source_staff(current_note)
    if staff_number == "1":
        return "treble"
    if staff_number == "2":
        return "bass"
    return None


def _classify_with_pair(current_note: note.NotRest, midi_value: int, pair_name: str) -> str:
    upper_voice, lower_voice = STAFF_VOICE_PAIRS[pair_name]
    predicted = predict_voice_label(feature_vector_from_note(current_note, midi_value))
    if predicted in {upper_voice, lower_voice}:
        return predicted

    upper_midpoint = sum(SATB_RANGES[upper_voice]) / 2
    lower_midpoint = sum(SATB_RANGES[lower_voice]) / 2
    if abs(midi_value - upper_midpoint) <= abs(midi_value - lower_midpoint):
        return upper_voice
    return lower_voice


def _normalize_stem_direction(stem_direction: str | None) -> str | None:
    if stem_direction is None:
        return None
    lowered = stem_direction.strip().lower()
    if lowered in {"up", "down"}:
        return lowered
    return None


def _is_unison_context(current_note: note.Note, pair_name: str) -> bool:
    measure = current_note.getContextByClass(stream.Measure)
    if measure is None:
        return False

    same_time_items = [
        item
        for item in measure.notes
        if abs(float(item.offset) - float(current_note.offset)) < 1e-6
        and _resolve_staff_pair_name(item) == pair_name
    ]
    return len(same_time_items) == 1


def _voice_from_part_name(part_name: str) -> str | None:
    voice_names = ("soprano", "alto", "tenor", "bass")
    for voice_name in voice_names:
        if voice_name in part_name:
            return voice_name.capitalize()

    return None


def _get_source_voice(current_note: note.NotRest) -> str | None:
    voice_stream = current_note.getContextByClass(stream.Voice)
    if voice_stream and voice_stream.id is not None:
        return str(voice_stream.id)

    voice_attr = getattr(current_note, "voice", None)
    if voice_attr:
        return str(voice_attr)

    return None


def _get_source_staff(current_note: note.NotRest) -> str | None:
    staff_number = getattr(current_note, "staffNumber", None)
    if staff_number is not None:
        return str(staff_number)

    return None


def _get_source_part(current_note: note.NotRest) -> str | None:
    part_stream = current_note.getContextByClass(stream.Part)
    if part_stream is None:
        return None

    return part_stream.partName or part_stream.id


def _closest_range_voice(midi_value: int) -> str:
    best_voice = "Alto"
    best_distance: float | None = None

    for voice_name, (low, high) in SATB_RANGES.items():
        if low <= midi_value <= high:
            midpoint = (low + high) / 2
            distance = abs(midi_value - midpoint)
        else:
            distance = min(abs(midi_value - low), abs(midi_value - high)) + 12

        if best_distance is None or distance < best_distance:
            best_distance = distance
            best_voice = voice_name

    return best_voice


def _build_summary(voice_name: str, tones: Iterable[ParsedTone]) -> VoicePartSummary:
    filtered = [tone for tone in tones if tone.voice_part == voice_name]
    if not filtered:
        return VoicePartSummary(
            voice_part=voice_name,
            detected_notes=0,
            confidence=0,
        )

    midis = [tone.midi for tone in filtered]
    lowest = min(filtered, key=lambda tone: tone.midi)
    highest = max(filtered, key=lambda tone: tone.midi)

    return VoicePartSummary(
        voice_part=voice_name,
        detected_notes=len(filtered),
        average_pitch_midi=round(sum(midis) / len(midis), 2),
        lowest_pitch=lowest.name_with_octave,
        highest_pitch=highest.name_with_octave,
        confidence=_estimate_confidence(voice_name, midis),
    )


def _estimate_confidence(voice_name: str, midis: list[int]) -> int:
    low, high = SATB_RANGES[voice_name]
    in_range = sum(1 for midi_value in midis if low <= midi_value <= high)
    return round((in_range / len(midis)) * 100)


def _audiveris_hint() -> str:
    if settings.audiveris_command:
        return (
            f"Audiveris command configured as '{settings.audiveris_command}', "
            "and PDF conversion will be attempted before SATB extraction."
        )

    return "Set AUDIVERIS_COMMAND in backend/.env to document the conversion tool path."


def _prepare_pdf_input(file_path: Path) -> tuple[Path | None, list[str], str]:
    existing_export = _find_existing_export(file_path)
    if existing_export is not None:
        return (
            existing_export,
            ["Existing MusicXML conversion reused for SATB analysis."],
            "audiveris+music21",
        )

    if not settings.audiveris_command:
        return (
            None,
            [
                "Audiveris is not configured, so this PDF cannot yet be converted automatically.",
                _audiveris_hint(),
            ],
            "audiveris-required",
        )

    output_dir = file_path.parent / "_audiveris_output"
    if output_dir.exists():
        shutil.rmtree(output_dir, ignore_errors=True)
    output_dir.mkdir(parents=True, exist_ok=True)

    command = [
        settings.audiveris_command,
        "-batch",
        "-transcribe",
        "-export",
        "-output",
        str(output_dir),
        str(file_path),
    ]

    try:
        completed = subprocess.run(
            command,
            capture_output=True,
            text=True,
            check=False,
        )
    except FileNotFoundError:
        return (
            None,
            [
                "Configured Audiveris command was not found on this machine.",
                _audiveris_hint(),
            ],
            "audiveris-required",
        )

    if completed.returncode != 0:
        stderr = completed.stderr.strip() or completed.stdout.strip() or "Unknown Audiveris error."
        return (
            None,
            [
                "Audiveris conversion failed before SATB extraction.",
                stderr,
            ],
            "audiveris",
        )

    exported_files = sorted(
        [
            *output_dir.rglob("*.musicxml"),
            *output_dir.rglob("*.xml"),
            *output_dir.rglob("*.mxl"),
        ]
    )

    if not exported_files:
        return (
            None,
            ["Audiveris finished, but no MusicXML export was produced."],
            "audiveris",
        )

    exported_path = exported_files[0]
    persisted_output = file_path.with_suffix(exported_path.suffix)
    persisted_output.write_bytes(exported_path.read_bytes())
    shutil.rmtree(output_dir, ignore_errors=True)
    return (
        persisted_output,
        ["PDF converted to MusicXML before SATB analysis."],
        "audiveris+music21",
    )


def _find_existing_export(file_path: Path) -> Path | None:
    for suffix in (".musicxml", ".xml", ".mxl"):
        candidate = file_path.with_suffix(suffix)
        if candidate.exists():
            return candidate
    return None
