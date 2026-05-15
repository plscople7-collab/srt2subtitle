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
        import imageio_ffmpeg
        import whisper
    except Exception as exc:  # noqa: BLE001
        print(str(exc), file=sys.stderr)
        return 1

    ffmpeg_exe = Path(imageio_ffmpeg.get_ffmpeg_exe())
    ffmpeg_dir = ROOT_DIR / ".tmp" / "ffmpeg-bin"
    ffmpeg_dir.mkdir(parents=True, exist_ok=True)
    ffmpeg_alias = ffmpeg_dir / "ffmpeg.exe"
    if not ffmpeg_alias.exists():
        shutil.copy2(ffmpeg_exe, ffmpeg_alias)
    os.environ["PATH"] = str(ffmpeg_dir) + os.pathsep + os.environ.get("PATH", "")

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


if __name__ == "__main__":
    raise SystemExit(main())
