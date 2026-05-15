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


class Transcriber:
    def transcribe(self, audio_path: str, speaker_id: str, transcript_json_path: str | None = None) -> list[RecognizedSegment]:
        raise NotImplementedError


class WhisperWorkerTranscriber(Transcriber):
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

    def transcribe(self, audio_path: str, speaker_id: str, transcript_json_path: str | None = None) -> list[RecognizedSegment]:
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
            stderr = _decode_process_output(exc.stderr).strip()
            stdout = _decode_process_output(exc.stdout).strip()
            detail = stderr or stdout or "音声認識ワーカーの実行に失敗しました。"
            if "WinError 10061" in detail or "urlopen error" in detail:
                detail = (
                    "選択中の Whisper モデルが未取得です。"
                    " この環境では UI からの初回自動ダウンロードが安定しないため、"
                    " 先にモデルを事前取得してください。"
                    " 例: py -3.12 backend\\asr_worker.py --audio \"20260515テスト用.wav\" --model base --language ja"
                )
            raise TranscriptionError("ERR-ASR-001", detail) from exc

        try:
            data = json.loads(_decode_process_output(result.stdout))
        except json.JSONDecodeError as exc:
            raise TranscriptionError("ERR-ASR-001", "音声認識ワーカーの応答を解析できませんでした。") from exc

        return _recognized_segments_from_payload(data, Path(audio_path), speaker_id)

    def with_model(self, model_name: str) -> "WhisperWorkerTranscriber":
        return WhisperWorkerTranscriber(
            python_launcher=self.python_launcher,
            python_version=self.python_version,
            model_name=model_name,
            language=self.language,
        )


class SidecarJsonTranscriber(Transcriber):
    def transcribe(self, audio_path: str, speaker_id: str, transcript_json_path: str | None = None) -> list[RecognizedSegment]:
        audio_file = Path(audio_path)
        if transcript_json_path:
            explicit = Path(transcript_json_path)
            if explicit.exists():
                return self._load_segments(explicit, audio_file, speaker_id)

        candidates = [
            audio_file.with_suffix(audio_file.suffix + ".segments.json"),
            audio_file.with_suffix(".segments.json"),
            audio_file.with_suffix(".json"),
        ]
        sidecar = next((path for path in candidates if path.exists()), None)
        if sidecar is None:
            raise TranscriptionError(
                "ERR-ASR-001",
                "音声認識エンジンが未設定です。現状は sidecar JSON のみ対応しています。",
            )

        return self._load_segments(sidecar, audio_file, speaker_id)

    def _load_segments(self, sidecar: Path, audio_file: Path, speaker_id: str) -> list[RecognizedSegment]:
        data = json.loads(sidecar.read_text(encoding="utf-8"))
        return _recognized_segments_from_payload(data, audio_file, speaker_id)


class CompositeTranscriber(Transcriber):
    def __init__(self, fallback: Transcriber, primary: Transcriber | None = None) -> None:
        self.primary = primary
        self.fallback = fallback

    def transcribe(self, audio_path: str, speaker_id: str, transcript_json_path: str | None = None) -> list[RecognizedSegment]:
        if transcript_json_path:
            return self.fallback.transcribe(audio_path, speaker_id, transcript_json_path)
        if self.primary is not None:
            return self.primary.transcribe(audio_path, speaker_id, transcript_json_path)
        return self.fallback.transcribe(audio_path, speaker_id, transcript_json_path)


def _recognized_segments_from_payload(data: object, audio_file: Path, speaker_id: str) -> list[RecognizedSegment]:
    if not isinstance(data, list):
        raise TranscriptionError("ERR-ASR-001", "sidecar JSON は配列である必要があります。")

    segments: list[RecognizedSegment] = []
    for item in data:
        start_sec = float(item["start_sec"])
        end_sec = float(item["end_sec"])
        if start_sec >= end_sec:
            raise TranscriptionError("ERR-ASR-001", "start_sec は end_sec より小さくある必要があります。")
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
