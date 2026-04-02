from __future__ import annotations

import hashlib
import io
import math
import wave
from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory

from music21 import chord, converter, note, stream

from app.services.score_analysis import _prepare_pdf_input, extract_classified_tones


PLAYBACK_CACHE_ROOT = Path(__file__).resolve().parents[2] / "storage" / "playback-cache"
PLAYBACK_CACHE_ROOT.mkdir(parents=True, exist_ok=True)
PLAYBACK_CACHE_VERSION = "v4"


@dataclass
class VoicePlaybackEvent:
    voice_part: str
    offset_quarters: float
    duration_quarters: float
    midi_pitches: list[int]


def render_voice_part_audio(
    file_path: Path,
    source_format: str,
    voice_part: str,
    tempo: int,
) -> bytes:
    cache_path = _playback_cache_path(file_path, source_format, voice_part, tempo)
    if cache_path.exists():
        return cache_path.read_bytes()

    parse_target = file_path
    normalized_format = source_format.upper()

    if normalized_format == "PDF":
        parse_target, warnings, _ = _prepare_pdf_input(file_path)
        if parse_target is None:
            warning_text = " ".join(warnings) if warnings else "PDF conversion failed."
            raise ValueError(warning_text)

    parsed_score = converter.parse(str(parse_target))
    events = _extract_voice_events(parsed_score, voice_part)

    if not events:
        raise ValueError(f"No {voice_part} notes were found in this score.")

    audio_bytes = _synthesize_wav(events, tempo)
    cache_path.write_bytes(audio_bytes)
    return audio_bytes


def export_voice_file(
    file_path: Path,
    source_format: str,
    voice_part: str,
    tempo: int,
    export_format: str,
) -> tuple[bytes, str, str]:
    normalized_export = export_format.lower()
    if normalized_export == "audio":
        return (
            render_voice_part_audio(file_path, source_format, voice_part, tempo),
            "wav",
            "audio/wav",
        )

    parse_target = file_path
    normalized_format = source_format.upper()

    if normalized_format == "PDF":
        parse_target, warnings, _ = _prepare_pdf_input(file_path)
        if parse_target is None:
            warning_text = " ".join(warnings) if warnings else "PDF conversion failed."
            raise ValueError(warning_text)

    parsed_score = converter.parse(str(parse_target))
    events = _extract_voice_events(parsed_score, voice_part)

    if not events:
        raise ValueError(f"No {voice_part} notes were found in this score.")

    voice_stream = _build_voice_stream(events, voice_part)

    with TemporaryDirectory() as output_dir:
        if normalized_export == "midi":
            target_path = Path(output_dir) / f"{voice_part.lower()}.mid"
            voice_stream.write("midi", fp=str(target_path))
            return target_path.read_bytes(), "mid", "audio/midi"

        if normalized_export == "musicxml":
            target_path = Path(output_dir) / f"{voice_part.lower()}.musicxml"
            voice_stream.write("musicxml", fp=str(target_path))
            return target_path.read_bytes(), "musicxml", "application/vnd.recordare.musicxml+xml"

    raise ValueError("Unsupported export format.")


def _extract_voice_events(parsed_score: stream.Score, selected_voice_part: str) -> list[VoicePlaybackEvent]:
    if selected_voice_part == "Harmony":
        grouped_events: dict[tuple[float, float], list[int]] = {}
        for current_element in parsed_score.recurse().notes:
            offset_quarters = float(current_element.getOffsetInHierarchy(parsed_score))
            duration_quarters = float(current_element.duration.quarterLength)
            key = (offset_quarters, duration_quarters)
            if isinstance(current_element, note.Note):
                grouped_events.setdefault(key, []).append(int(current_element.pitch.midi))
            elif isinstance(current_element, chord.Chord):
                grouped_events.setdefault(key, []).extend(
                    int(current_pitch.midi) for current_pitch in current_element.pitches
                )

        return [
            VoicePlaybackEvent(
                voice_part=selected_voice_part,
                offset_quarters=offset_quarters,
                duration_quarters=duration_quarters,
                midi_pitches=sorted(set(midi_pitches)),
            )
            for (offset_quarters, duration_quarters), midi_pitches in sorted(grouped_events.items())
        ]

    grouped_events: dict[tuple[float, float], list[int]] = {}
    for tone in extract_classified_tones(parsed_score):
        if tone.voice_part != selected_voice_part:
            continue
        key = (tone.offset_quarters, tone.duration_quarters)
        grouped_events.setdefault(key, []).append(tone.midi)

    return [
        VoicePlaybackEvent(
            voice_part=selected_voice_part,
            offset_quarters=offset_quarters,
            duration_quarters=duration_quarters,
            midi_pitches=sorted(midi_pitches),
        )
        for (offset_quarters, duration_quarters), midi_pitches in sorted(grouped_events.items())
    ]


def _build_voice_stream(events: list[VoicePlaybackEvent], voice_part: str) -> stream.Score:
    score = stream.Score(id=f"{voice_part}Export")
    part = stream.Part(id=voice_part)
    for event in events:
        if len(event.midi_pitches) == 1:
            current_element = note.Note(event.midi_pitches[0])
        else:
            current_element = chord.Chord(event.midi_pitches)
        current_element.duration.quarterLength = event.duration_quarters
        part.insert(event.offset_quarters, current_element)
    score.insert(0, part)
    return score


def _synthesize_wav(events: list[VoicePlaybackEvent], tempo: int) -> bytes:
    sample_rate = 32000
    seconds_per_quarter = 60.0 / max(tempo, 30)
    total_seconds = max(
        (event.offset_quarters + (event.duration_quarters * 1.18)) * seconds_per_quarter
        for event in events
    ) + 1.0
    total_samples = int(total_seconds * sample_rate)
    waveform = [0.0] * total_samples

    ordered_events = sorted(events, key=lambda current_event: current_event.offset_quarters)

    for index, event in enumerate(ordered_events):
        start_sample = int(event.offset_quarters * seconds_per_quarter * sample_rate)
        base_duration_seconds = max(event.duration_quarters * seconds_per_quarter, 0.12)
        next_offset_seconds = None
        if index + 1 < len(ordered_events):
            next_offset_seconds = ordered_events[index + 1].offset_quarters * seconds_per_quarter
        note_samples = _piano_like_wave(
            event.midi_pitches,
            base_duration_seconds,
            sample_rate,
            start_seconds=event.offset_quarters * seconds_per_quarter,
            next_onset_seconds=next_offset_seconds,
        )

        for note_index, sample in enumerate(note_samples):
            target_index = start_sample + note_index
            if target_index >= total_samples:
                break
            waveform[target_index] += sample

    max_amplitude = max(max(abs(sample) for sample in waveform), 1e-6)
    normalized = []
    for sample in waveform:
        boosted = (sample / max_amplitude) * 1.35
        clipped = math.tanh(boosted)
        normalized.append(int(max(min(clipped, 1.0), -1.0) * 32767))

    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(
            b"".join(int(sample).to_bytes(2, byteorder="little", signed=True) for sample in normalized)
        )

    return buffer.getvalue()


def _piano_like_wave(
    midi_pitches: list[int],
    duration_seconds: float,
    sample_rate: int,
    start_seconds: float,
    next_onset_seconds: float | None = None,
) -> list[float]:
    release_seconds = min(0.16, max(duration_seconds * 0.32, 0.08))
    overlap_seconds = 0.04
    sounding_seconds = duration_seconds + release_seconds
    if next_onset_seconds is not None:
        time_until_next = max(next_onset_seconds - start_seconds, 0.05)
        sounding_seconds = min(sounding_seconds, time_until_next + overlap_seconds)

    sample_count = max(int(sounding_seconds * sample_rate), 1)
    output = [0.0] * sample_count

    for midi_pitch in midi_pitches:
        frequency = 440.0 * (2 ** ((midi_pitch - 69) / 12))
        phase_step = (2 * math.pi * frequency) / sample_rate
        for index in range(sample_count):
            t = index / sample_rate
            phase = phase_step * index
            attack = min(t / 0.012, 1.0)
            body = math.exp(-1.25 * t / max(duration_seconds, 0.14))
            shimmer = math.exp(-3.5 * t / max(duration_seconds, 0.14))
            release_start = max(sounding_seconds - release_seconds, 0.0)
            if t <= release_start:
                release = 1.0
            else:
                release_progress = (t - release_start) / max(release_seconds, 1e-6)
                release = max(0.0, 1.0 - release_progress) ** 1.8
            vibrato = 1.0 + 0.0018 * math.sin(2 * math.pi * 5.2 * t)
            sample = (
                0.78 * math.sin(phase * vibrato)
                + 0.26 * math.sin((phase * 2) + 0.12)
                + 0.11 * math.sin((phase * 3) + 0.05) * shimmer
                + 0.05 * math.sin((phase * 4) + 0.21) * shimmer
            )
            hammer = math.exp(-28.0 * t) * 0.12
            output[index] += (sample + hammer) * body * attack * release

    divisor = max(math.sqrt(len(midi_pitches)), 1)
    return [sample / divisor for sample in output]


def _playback_cache_path(file_path: Path, source_format: str, voice_part: str, tempo: int) -> Path:
    stat = file_path.stat()
    cache_key = hashlib.sha1(
        f"{PLAYBACK_CACHE_VERSION}|{file_path.resolve()}|{stat.st_mtime_ns}|{stat.st_size}|{source_format}|{voice_part}|{tempo}".encode(
            "utf-8"
        )
    ).hexdigest()
    return PLAYBACK_CACHE_ROOT / f"{cache_key}.wav"
