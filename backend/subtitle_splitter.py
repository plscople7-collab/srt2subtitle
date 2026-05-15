from __future__ import annotations

import math
import re


PREFERRED_BREAK_PATTERN = re.compile(r"(?<=[。！？!?、,])")
SECONDARY_BREAK_PATTERN = re.compile(r"(?<=\s)")
LINE_BREAK_CHARS = set("。、？！!? ")
HEAD_PROHIBITED = set("、。，．？！)]｝」』】〉》")
TAIL_PROHIBITED = set("([｛「『【〈《")


def split_segments(recognized_segments: list[dict], subtitle_rule: dict) -> list[dict]:
    results: list[dict] = []
    for segment in recognized_segments:
        pieces = _split_segment(segment, subtitle_rule)
        results.extend(pieces)
    return _merge_short_segments(results, subtitle_rule)


def _split_segment(segment: dict, rule: dict) -> list[dict]:
    text = str(segment["text"]).strip()
    duration = float(segment["end_sec"]) - float(segment["start_sec"])
    max_chars_total = int(rule["max_chars_per_line"]) * int(rule["max_lines"])
    max_duration = float(rule["max_duration_sec"])
    warnings: list[str] = []
    words = _normalize_words(segment.get("words") or [])

    if len(text) <= max_chars_total and duration <= max_duration:
        return [_finalize_segment(segment, text, warnings, rule)]

    if words:
        timed_chunks = _split_words(words, max_chars_total, max_duration)
        if timed_chunks:
            return [
                _finalize_segment(
                    {
                        **segment,
                        "start_sec": chunk["start_sec"],
                        "end_sec": chunk["end_sec"],
                        "words": chunk["words"],
                    },
                    chunk["text"],
                    warnings.copy(),
                    rule,
                )
                for chunk in timed_chunks
            ]

    tokens = _tokenize_text(text)
    chunks = _pack_tokens(tokens, max_chars_total)
    if not chunks:
        chunks = [text]
    if any(len(chunk) > max_chars_total for chunk in chunks):
        forced_chunks: list[str] = []
        for chunk in chunks:
            if len(chunk) <= max_chars_total:
                forced_chunks.append(chunk)
            else:
                forced_chunks.extend(_force_split(chunk, int(rule["max_chars_per_line"])))
        chunks = forced_chunks
        warnings.append("WARN-SUBTITLE-LONG-001")

    total_chars = max(sum(max(len(chunk), 1) for chunk in chunks), 1)
    cursor = float(segment["start_sec"])
    results: list[dict] = []
    for index, chunk in enumerate(chunks):
        proportion = max(len(chunk), 1) / total_chars
        piece_duration = duration * proportion
        end_sec = float(segment["end_sec"]) if index == len(chunks) - 1 else cursor + piece_duration
        results.append(
            _finalize_segment(
                {
                    **segment,
                    "start_sec": cursor,
                    "end_sec": end_sec,
                },
                chunk,
                warnings.copy(),
                rule,
            )
        )
        cursor = end_sec
    return results


def _normalize_words(words: list[dict]) -> list[dict]:
    normalized: list[dict] = []
    for item in words:
        try:
            text = str(item["text"]).strip()
            start_sec = float(item["start_sec"])
            end_sec = float(item["end_sec"])
        except (KeyError, TypeError, ValueError):
            continue
        if not text or start_sec >= end_sec:
            continue
        normalized.append({"text": text, "start_sec": start_sec, "end_sec": end_sec})
    return normalized


def _split_words(words: list[dict], max_chars_total: int, max_duration: float) -> list[dict]:
    chunks: list[dict] = []
    current_words: list[dict] = []
    current_text = ""

    for word in words:
        candidate_text = f"{current_text}{word['text']}".strip()
        if current_words:
            candidate_duration = word["end_sec"] - current_words[0]["start_sec"]
            if len(candidate_text) > max_chars_total or candidate_duration > max_duration:
                chunks.append(_build_chunk(current_words))
                current_words = [word]
                current_text = word["text"]
                continue
        else:
            current_text = word["text"]
            current_words = [word]
            continue

        current_words.append(word)
        current_text = candidate_text

    if current_words:
        chunks.append(_build_chunk(current_words))
    return chunks


def _build_chunk(words: list[dict]) -> dict:
    return {
        "start_sec": words[0]["start_sec"],
        "end_sec": words[-1]["end_sec"],
        "text": "".join(word["text"] for word in words).strip(),
        "words": words,
    }


def _tokenize_text(text: str) -> list[str]:
    tokens = [token for token in PREFERRED_BREAK_PATTERN.split(text) if token]
    if len(tokens) == 1:
        tokens = [token for token in SECONDARY_BREAK_PATTERN.split(text) if token]
    if len(tokens) == 1:
        return [text]
    return [token.strip() for token in tokens if token.strip()]


def _pack_tokens(tokens: list[str], max_chars_total: int) -> list[str]:
    chunks: list[str] = []
    current = ""
    for token in tokens:
        candidate = f"{current}{token}".strip()
        if current and len(candidate) > max_chars_total:
            chunks.append(current.strip())
            current = token
        else:
            current = candidate
    if current.strip():
        chunks.append(current.strip())
    return chunks


def _force_split(text: str, max_chars_per_line: int) -> list[str]:
    chunks: list[str] = []
    cursor = 0
    window = max(max_chars_per_line, 1)
    while cursor < len(text):
        end = min(len(text), cursor + window)
        chunks.append(text[cursor:end].strip())
        cursor = end
    return [chunk for chunk in chunks if chunk]


def _merge_short_segments(segments: list[dict], rule: dict) -> list[dict]:
    if not segments:
        return []
    min_duration = float(rule["min_duration_sec"])
    max_chars_total = int(rule["max_chars_per_line"]) * int(rule["max_lines"])
    max_duration = float(rule["max_duration_sec"])

    merged: list[dict] = []
    for segment in segments:
        duration = float(segment["end_sec"]) - float(segment["start_sec"])
        if merged and duration < min_duration:
            prev = merged[-1]
            gap = float(segment["start_sec"]) - float(prev["end_sec"])
            combined_text = f"{prev['text'].replace(chr(10), '')}{segment['text'].replace(chr(10), '')}"
            combined_duration = float(segment["end_sec"]) - float(prev["start_sec"])
            if gap <= 0.3 and len(combined_text) <= max_chars_total and combined_duration <= max_duration:
                prev["end_sec"] = segment["end_sec"]
                prev["text"] = _apply_line_breaks(combined_text, rule)
                prev["words"] = (prev.get("words") or []) + (segment.get("words") or [])
                prev["warnings"] = sorted(set(prev["warnings"]) | set(segment["warnings"]))
                continue
            segment["warnings"] = sorted(set(segment["warnings"]) | {"WARN-SUBTITLE-SHORT-001"})
        merged.append(segment)
    return merged


def _finalize_segment(segment: dict, text: str, warnings: list[str], rule: dict) -> dict:
    return {
        **segment,
        "text": _apply_line_breaks(text, rule),
        "warnings": sorted(set(warnings)),
    }


def _apply_line_breaks(text: str, rule: dict) -> str:
    text = text.strip()
    max_lines = int(rule["max_lines"])
    max_chars = int(rule["max_chars_per_line"])
    if max_lines <= 1 or len(text) <= max_chars:
        return text

    lines_needed = min(max_lines, max(1, math.ceil(len(text) / max_chars)))
    target_len = max(1, round(len(text) / lines_needed))
    lines: list[str] = []
    remaining = text
    while len(lines) < lines_needed - 1 and len(remaining) > max_chars:
        split_at = _find_best_breakpoint(remaining, target_len, max_chars)
        lines.append(remaining[:split_at].strip())
        remaining = remaining[split_at:].strip()
    lines.append(remaining)
    return "\n".join(filter(None, lines[:max_lines]))


def _find_best_breakpoint(text: str, target_len: int, max_chars: int) -> int:
    limit = min(len(text) - 1, max_chars)
    candidates: list[int] = []
    for index, char in enumerate(text[: limit + 1], start=1):
        if char in LINE_BREAK_CHARS:
            candidates.append(index)
    if not candidates:
        return limit

    best = min(candidates, key=lambda value: abs(value - target_len))
    if best < len(text) and text[best] in HEAD_PROHIBITED and best > 1:
        return best - 1
    if text[best - 1] in TAIL_PROHIBITED and best < limit:
        return best + 1
    return best
