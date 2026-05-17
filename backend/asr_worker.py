from __future__ import annotations

import argparse
import shutil
import json
import os
import sys
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent.parent
DEPS_DIR = ROOT_DIR / ".deps312"
if str(DEPS_DIR) not in sys.path:
    sys.path.insert(0, str(DEPS_DIR))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", required=True)
    parser.add_argument("--model", default="small")
    parser.add_argument("--language", default="ja")
    args = parser.parse_args()

    try:
        whisper = _load_whisper()
        if whisper is None:
            raise ModuleNotFoundError("No usable whisper module found")
    except Exception as exc:  # noqa: BLE001
        print(f"openai-whisper が見つかりません: {exc}", file=sys.stderr)
        return 1

    imageio_ffmpeg = _load_imageio_ffmpeg()

    if imageio_ffmpeg is not None:
        ffmpeg_exe = Path(imageio_ffmpeg.get_ffmpeg_exe())
        ffmpeg_dir = ROOT_DIR / ".tmp" / "ffmpeg-bin"
        ffmpeg_dir.mkdir(parents=True, exist_ok=True)
        ffmpeg_alias = ffmpeg_dir / "ffmpeg.exe"
        if not ffmpeg_alias.exists():
            shutil.copy2(ffmpeg_exe, ffmpeg_alias)
        os.environ["PATH"] = str(ffmpeg_dir) + os.pathsep + os.environ.get("PATH", "")
    elif shutil.which("ffmpeg") is None:
        print("ffmpeg が見つかりません。imageio-ffmpeg を入れるか、ffmpeg を PATH に追加してください。", file=sys.stderr)
        return 1

    try:
        model = whisper.load_model(args.model)
        result = model.transcribe(
            args.audio,
            language=args.language,
            task="transcribe",
            fp16=False,
            verbose=False,
            word_timestamps=True,
        )
    except Exception as exc:  # noqa: BLE001
        print(str(exc), file=sys.stderr)
        return 1

    segments = []
    for segment in result.get("segments", []):
        words = []
        for word in segment.get("words", []):
            token = str(word.get("word", "")).strip()
            start_sec = word.get("start")
            end_sec = word.get("end")
            if not token or start_sec is None or end_sec is None:
                continue
            words.append(
                {
                    "start_sec": float(start_sec),
                    "end_sec": float(end_sec),
                    "text": token,
                }
            )
        segments.append(
            {
                "start_sec": float(segment["start"]),
                "end_sec": float(segment["end"]),
                "text": str(segment["text"]).strip(),
                "confidence": None,
                "words": words,
            }
        )
    print(json.dumps(segments, ensure_ascii=False))
    return 0


def _load_whisper():
    try:
        import whisper
        if hasattr(whisper, "load_model"):
            return whisper
    except Exception:  # noqa: BLE001
        pass

    sys.modules.pop("whisper", None)
    removed = False
    if str(DEPS_DIR) in sys.path:
        sys.path.remove(str(DEPS_DIR))
        removed = True
    try:
        import whisper
        if hasattr(whisper, "load_model"):
            return whisper
    except Exception:  # noqa: BLE001
        return None
    if removed:
        sys.path.insert(0, str(DEPS_DIR))
    return None


def _load_imageio_ffmpeg():
    try:
        import imageio_ffmpeg
        if hasattr(imageio_ffmpeg, "get_ffmpeg_exe"):
            return imageio_ffmpeg
    except Exception:  # noqa: BLE001
        pass

    # A broken target install can appear as an empty namespace package. In that
    # case, try the normal Python site-packages fallback for imageio-ffmpeg.
    sys.modules.pop("imageio_ffmpeg", None)
    removed = False
    if str(DEPS_DIR) in sys.path:
        sys.path.remove(str(DEPS_DIR))
        removed = True
    try:
        import imageio_ffmpeg
        if hasattr(imageio_ffmpeg, "get_ffmpeg_exe"):
            return imageio_ffmpeg
    except Exception:  # noqa: BLE001
        return None
    if removed:
        sys.path.insert(0, str(DEPS_DIR))
    return None


if __name__ == "__main__":
    raise SystemExit(main())
