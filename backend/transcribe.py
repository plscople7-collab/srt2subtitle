from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path


class TranscriptionError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class RecognizedSegment:
    speaker_id: str
    source_audio: str
    start_sec: float
    end_sec: float
    text: str
    confidence: float | None
    words: list[dict] | None = None

    def to_dict(self) -> dict:
        return {
            "speaker_id": self.speaker_id,
            "source_audio": self.source_audio,
            "start_sec": self.start_sec,
            "end_sec": self.end_sec,
            "text": self.text,
            "confidence": self.confidence,
            "words": self.words or [],
        }


class WhisperWorkerTranscriber:
    def __init__(
        self,
        python_launcher: str = "py",
        python_version: str = "-3.12",
        model_name: str = "small",
        language: str = "ja",
    ) -> None:
        self.python_launcher = python_launcher
        self.python_version = python_version
        self.model_name = model_name
        self.language = language

    def transcribe(self, audio_path: str, speaker_id: str) -> list[RecognizedSegment]:
        worker = Path(__file__).with_name("asr_worker.py")
        command = [
            self.python_launcher,
            self.python_version,
            str(worker),
            "--audio",
            audio_path,
            "--model",
            self.model_name,
            "--language",
            self.language,
        ]
        try:
            result = subprocess.run(command, check=True, capture_output=True, text=False)
        except FileNotFoundError as exc:
            raise TranscriptionError("ERR-ASR-001", "Python 3.12 ワーカーが見つかりません。") from exc
        except subprocess.CalledProcessError as exc:
            detail = _decode_process_output(exc.stderr).strip() or _decode_process_output(exc.stdout).strip()
            raise TranscriptionError("ERR-ASR-001", detail or "音声認識ワーカーの実行に失敗しました。") from exc

        try:
            data = json.loads(_decode_process_output(result.stdout))
        except json.JSONDecodeError as exc:
            raise TranscriptionError("ERR-ASR-001", "音声認識ワーカーの応答を解析できませんでした。") from exc

        return _recognized_segments_from_payload(data, Path(audio_path), speaker_id)


def _recognized_segments_from_payload(data: object, audio_file: Path, speaker_id: str) -> list[RecognizedSegment]:
    if not isinstance(data, list):
        raise TranscriptionError("ERR-ASR-001", "認識結果は配列である必要があります。")

    segments: list[RecognizedSegment] = []
    for item in data:
        start_sec = float(item["start_sec"])
        end_sec = float(item["end_sec"])
        if start_sec >= end_sec:
            raise TranscriptionError("ERR-ASR-001", "start_sec は end_sec より小さい必要があります。")
        segments.append(
            RecognizedSegment(
                speaker_id=speaker_id,
                source_audio=audio_file.name,
                start_sec=start_sec,
                end_sec=end_sec,
                text=str(item["text"]).strip(),
                confidence=float(item["confidence"]) if item.get("confidence") is not None else None,
                words=item.get("words") or [],
            )
        )
    return segments


def _decode_process_output(value: bytes | str | None) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    for encoding in ("utf-8", "cp932"):
        try:
            return value.decode(encoding)
        except UnicodeDecodeError:
            continue
    return value.decode("utf-8", errors="replace")
