from __future__ import annotations

import hashlib
import json
import shutil
from dataclasses import dataclass
from pathlib import Path

from .exo_writer import build_srt
from .transcribe import TranscriptionError, WhisperWorkerTranscriber


ALLOWED_MEDIA_SUFFIXES = {".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg", ".opus", ".wma", ".webm", ".mp4", ".mov", ".mkv"}


@dataclass
class MediaInput:
    filename: str
    content: bytes


def transcribe_media_to_srt(
    media_inputs: list[MediaInput],
    *,
    root_dir: Path,
    model_name: str,
    language: str,
    engine: str = "whisper",
) -> dict:
    if engine != "whisper":
        raise TranscriptionError("ERR-ASR-ENGINE-001", f"未対応の音声認識エンジンです: {engine}")
    if not media_inputs:
        raise TranscriptionError("ERR-ASR-INPUT-001", "音声または動画ファイルを指定してください。")

    work_dir = root_dir / ".tmp" / "local-transcriber"
    cache_dir = root_dir / "data" / "transcriber_cache"
    work_dir.mkdir(parents=True, exist_ok=True)
    cache_dir.mkdir(parents=True, exist_ok=True)

    transcriber = WhisperWorkerTranscriber(model_name=model_name, language=language)
    outputs = []
    for index, item in enumerate(media_inputs, start=1):
        suffix = Path(item.filename).suffix.lower()
        if suffix not in ALLOWED_MEDIA_SUFFIXES:
            raise TranscriptionError("ERR-AUDIO-FORMAT-001", f"未対応の音声/動画形式です: {item.filename}")

        digest = hashlib.sha256(item.content).hexdigest()
        cache_path = cache_dir / f"{digest}.whisper.{model_name}.{language}.json"
        if cache_path.exists():
            segments = json.loads(cache_path.read_text(encoding="utf-8"))
            cached = True
        else:
            safe_name = f"{digest[:16]}_{index}{suffix}"
            media_path = work_dir / safe_name
            media_path.write_bytes(item.content)
            try:
                recognized = transcriber.transcribe(str(media_path), f"speaker_{index:02d}")
                segments = [segment.to_dict() for segment in recognized]
                for segment in segments:
                    segment["source_audio"] = item.filename
                cache_path.write_text(json.dumps(segments, ensure_ascii=False, indent=2), encoding="utf-8", newline="\n")
                cached = False
            finally:
                _safe_unlink(media_path)

        srt_text = build_srt(segments)
        json_text = json.dumps({"segments": segments}, ensure_ascii=False, indent=2)
        stem = Path(item.filename).stem or f"speaker_{index:02d}"
        outputs.append(
            {
                "filename": item.filename,
                "base_name": stem,
                "srt_name": f"{stem}.srt",
                "json_name": f"{stem}.segments.json",
                "srt_content": srt_text,
                "json_content": json_text,
                "segment_count": len(segments),
                "cached": cached,
            }
        )

    return {
        "engine": engine,
        "model": model_name,
        "language": language,
        "outputs": outputs,
    }


def clear_transcriber_work_dir(root_dir: Path) -> None:
    work_dir = root_dir / ".tmp" / "local-transcriber"
    if work_dir.exists():
        shutil.rmtree(work_dir, ignore_errors=True)


def _safe_unlink(path: Path) -> None:
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass
