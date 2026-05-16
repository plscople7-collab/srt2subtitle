from __future__ import annotations

import re

from .validators import ValidationError


SRT_TIMECODE_PATTERN = re.compile(
    r"^\s*(?P<start>\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(?P<end>\d{2}:\d{2}:\d{2}[,.]\d{3})\s*$"
)


def decode_srt_bytes(raw: bytes) -> tuple[str, str]:
    for encoding in ("utf-8-sig", "utf-8", "cp932"):
        try:
            return raw.decode(encoding), encoding
        except UnicodeDecodeError:
            continue
    raise ValidationError("ERR-SRT-ENCODING-001", "SRT の文字コードを判別できませんでした。UTF-8 を推奨します。")


def parse_srt(content: str, speaker_id: str) -> list[dict]:
    normalized = content.replace("\r\n", "\n").replace("\r", "\n").strip()
    if not normalized:
        raise ValidationError("ERR-SRT-001", "SRT が空です。")

    blocks = re.split(r"\n\s*\n", normalized)
    segments: list[dict] = []
    for block_index, block in enumerate(blocks, start=1):
        lines = [line.rstrip() for line in block.split("\n") if line.strip() != ""]
        if len(lines) < 2:
            raise ValidationError("ERR-SRT-001", f"SRT の {block_index} ブロックが不正です。")

        cursor = 0
        if lines[0].strip().isdigit():
            cursor = 1
        if cursor >= len(lines):
            raise ValidationError("ERR-SRT-001", f"SRT の {block_index} ブロックにタイムコードがありません。")

        match = SRT_TIMECODE_PATTERN.match(lines[cursor])
        if match is None:
            raise ValidationError("ERR-SRT-001", f"SRT の {block_index} ブロックのタイムコードが不正です。")

        text_lines = lines[cursor + 1 :]
        if not text_lines:
            raise ValidationError("ERR-SRT-001", f"SRT の {block_index} ブロックに本文がありません。")

        text = _normalize_text("\n".join(text_lines))
        start_sec = _parse_srt_time(match.group("start"))
        end_sec = _parse_srt_time(match.group("end"))
        if start_sec >= end_sec:
            raise ValidationError("ERR-SRT-001", f"SRT の {block_index} ブロックで開始時刻と終了時刻が逆転しています。")

        segments.append(
            {
                "speaker_id": speaker_id,
                "start_sec": start_sec,
                "end_sec": end_sec,
                "text": text,
                "warnings": [],
                "words": [],
            }
        )
    return segments


def _parse_srt_time(value: str) -> float:
    hours, minutes, seconds = value.replace(",", ".").split(":")
    return int(hours) * 3600 + int(minutes) * 60 + float(seconds)


def _normalize_text(text: str) -> str:
    collapsed = re.sub(r"\s*\n\s*", " ", text.strip())
    return re.sub(r"[ \t]{2,}", " ", collapsed)
