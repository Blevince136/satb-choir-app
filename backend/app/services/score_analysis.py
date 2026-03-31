from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
from typing import Iterable

from music21 import chord, clef, converter, note, pitch, stream

from app.config import settings
from app.schemas import ScoreAnalysisResult, VoicePartSummary


SATB_RANGES = {
    "Soprano": (pitch.Pitch("C4").midi, pitch.Pitch("A5").midi),
    "Alto": (pitch.Pitch("G3").midi, pitch.Pitch("D5").midi),
    "Tenor": (pitch.Pitch("C3").midi, pitch.Pitch("G4").midi),
    "Bass": (pitch.Pitch("E2").midi, pitch.Pitch("C4").midi),
}


@dataclass
class ParsedTone:
    voice_part: str
    midi: int
    name_with_octave: str
    source_voice: str | None = None
    source_staff: str | None = None
    source_part: str | None = None


def analyze_score_file(file_path: Path, source_format: str) -> ScoreAnalysisResult:
    normalized_format = source_format.upper()
    parser_used = "music21"
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
                voices=[],
                warnings=warnings,
            )

    try:
        try:
            parsed_score = converter.parse(str(parse_target))
        except Exception as exc:  # noqa: BLE001
            raise ValueError(f"Unable to parse {normalized_format} score: {exc}") from exc

        tones = _extract_tones(parsed_score)
    finally:
        if parse_target != file_path:
            parse_target.unlink(missing_ok=True)

    if not tones:
        warnings.append("No note events were detected in the uploaded score.")

    if normalized_format == "MIDI":
        warnings.append(
            "MIDI analysis is heuristic because staff and clef information may be missing."
        )

    voices = [_build_summary(name, tones) for name in ("Soprano", "Alto", "Tenor", "Bass")]

    return ScoreAnalysisResult(
        source_format=normalized_format,
        conversion_required=False,
        parser_used=parser_used,
        voices=voices,
        warnings=warnings,
    )


def _extract_tones(parsed_score: stream.Score) -> list[ParsedTone]:
    extracted: list[ParsedTone] = []

    for current_note in parsed_score.recurse().notes:
        if isinstance(current_note, note.Note):
            extracted.append(
                ParsedTone(
                    voice_part=_classify_voice_part(current_note),
                    midi=int(current_note.pitch.midi),
                    name_with_octave=current_note.pitch.nameWithOctave,
                    source_voice=_get_source_voice(current_note),
                    source_staff=_get_source_staff(current_note),
                    source_part=_get_source_part(current_note),
                )
            )
        elif isinstance(current_note, chord.Chord):
            for chord_pitch in current_note.pitches:
                extracted.append(
                    ParsedTone(
                        voice_part=_classify_voice_part(current_note, chord_pitch.midi),
                        midi=int(chord_pitch.midi),
                        name_with_octave=chord_pitch.nameWithOctave,
                        source_voice=_get_source_voice(current_note),
                        source_staff=_get_source_staff(current_note),
                        source_part=_get_source_part(current_note),
                    )
                )

    return extracted


def _classify_voice_part(
    current_note: note.NotRest,
    midi_override: int | None = None,
) -> str:
    midi_value = int(midi_override if midi_override is not None else current_note.pitch.midi)
    current_clef = current_note.getContextByClass(clef.Clef)
    part_name = (_get_source_part(current_note) or "").lower()
    voice_hint = (_get_source_voice(current_note) or "").strip()

    named_part = _voice_from_part_name(part_name)
    if named_part:
        return named_part

    if isinstance(current_clef, clef.BassClef):
        if voice_hint == "1":
            return "Tenor"
        if voice_hint == "2":
            return "Bass"
        return "Tenor" if midi_value >= pitch.Pitch("C4").midi else "Bass"

    if isinstance(current_clef, clef.TrebleClef):
        if voice_hint == "1":
            return "Soprano"
        if voice_hint == "2":
            return "Alto"
        return "Soprano" if midi_value >= pitch.Pitch("C5").midi else "Alto"

    return _closest_range_voice(midi_value)


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
    if not settings.audiveris_command:
        return (
            None,
            [
                "Audiveris is not configured, so this PDF cannot yet be converted automatically.",
                _audiveris_hint(),
            ],
            "audiveris-required",
        )

    with TemporaryDirectory() as output_dir:
        command = [
            settings.audiveris_command,
            "-batch",
            "-transcribe",
            "-export",
            "-output",
            output_dir,
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
                *Path(output_dir).rglob("*.musicxml"),
                *Path(output_dir).rglob("*.xml"),
                *Path(output_dir).rglob("*.mxl"),
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
        return (
            persisted_output,
            ["PDF converted to MusicXML before SATB analysis."],
            "audiveris+music21",
        )
