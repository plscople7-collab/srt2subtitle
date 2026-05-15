from __future__ import annotations


class ValidationError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def validate_project_payload(payload: dict) -> dict:
    name = str(payload.get("name", "")).strip()
    if not name:
        raise ValidationError("ERR-PROJECT-001", "プロジェクト名は必須です。")

    fps = _coerce_float(payload.get("fps"))
    width = _coerce_int(payload.get("width"))
    height = _coerce_int(payload.get("height"))

    if fps < 1 or fps > 240:
        raise ValidationError("ERR-PROJECT-001", "fps は 1 以上 240 以下で指定してください。")
    if width < 1 or height < 1:
        raise ValidationError("ERR-PROJECT-001", "解像度は正の整数で指定してください。")

    return {
        "name": name,
        "fps": fps,
        "width": width,
        "height": height,
        "audio_rate": _coerce_int(payload.get("audio_rate", 48000)),
        "audio_ch": _coerce_int(payload.get("audio_ch", 2)),
        "output_name": str(payload.get("output_name", "output")).strip() or "output",
        "asr_model": _validate_asr_model(payload.get("asr_model", "base")),
    }


def validate_subtitle_rule(payload: dict) -> dict:
    max_chars = _coerce_int(payload.get("max_chars_per_line", payload.get("max_chars")))
    max_lines = _coerce_int(payload.get("max_lines"))
    min_duration = _coerce_float(payload.get("min_duration_sec"))
    max_duration = _coerce_float(payload.get("max_duration_sec"))

    if not 1 <= max_chars <= 80:
        raise ValidationError("ERR-SUBTITLE-RULE-001", "最大文字数/行は 1 以上 80 以下で指定してください。")
    if not 1 <= max_lines <= 4:
        raise ValidationError("ERR-SUBTITLE-RULE-001", "最大行数は 1 以上 4 以下で指定してください。")
    if min_duration < 0.1:
        raise ValidationError("ERR-SUBTITLE-RULE-001", "最短表示時間は 0.1 秒以上で指定してください。")
    if max_duration < min_duration or max_duration > 10.0:
        raise ValidationError("ERR-SUBTITLE-RULE-001", "最長表示時間は最短以上 10.0 秒以下で指定してください。")

    return {
        "max_chars_per_line": max_chars,
        "max_lines": max_lines,
        "min_duration_sec": min_duration,
        "max_duration_sec": max_duration,
    }


def validate_speaker_payload(
    display_name: str,
    subtitle_rule: dict,
    audio_files: list[str],
    template_exo: str | None,
    transcript_json: str | None = None,
    preset_id: str | None = None,
    base_layer: object | None = None,
) -> dict:
    display_name = display_name.strip()
    if not display_name:
        raise ValidationError("ERR-SPEAKER-001", "話者名は必須です。")
    if not audio_files or (not template_exo and not preset_id):
        raise ValidationError("ERR-SPEAKER-001", "音声ファイルとサンプル EXO の両方を登録してください。")
    return {
        "display_name": display_name,
        "audio_files": audio_files,
        "template_exo": template_exo,
        "transcript_json": transcript_json or "",
        "preset_id": (preset_id or "").strip(),
        "base_layer": _coerce_layer(base_layer),
        "subtitle_rule": validate_subtitle_rule(subtitle_rule),
    }


def _coerce_int(value: object) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError) as exc:
        raise ValidationError("ERR-PROJECT-001", "整数値の解析に失敗しました。") from exc


def _coerce_float(value: object) -> float:
    try:
        return float(value)
    except (TypeError, ValueError) as exc:
        raise ValidationError("ERR-PROJECT-001", "数値の解析に失敗しました。") from exc


def _validate_asr_model(value: object) -> str:
    model = str(value or "base").strip().lower()
    allowed = {"tiny", "base", "small", "medium"}
    if model not in allowed:
        raise ValidationError("ERR-PROJECT-001", f"asr_model は {', '.join(sorted(allowed))} のいずれかで指定してください。")
    return model


def _coerce_layer(value: object | None) -> int | None:
    if value in (None, ""):
        return None
    layer = _coerce_int(value)
    if layer < 1:
        raise ValidationError("ERR-SPEAKER-001", "レイヤーは 1 以上で指定してください。")
    return layer
