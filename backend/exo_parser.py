from __future__ import annotations

from dataclasses import dataclass


class ExoTemplateError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class ExoSection:
    name: str
    items: list[tuple[str, str]]

    def to_dict(self) -> dict:
        return {"name": self.name, "items": self.items}

    @classmethod
    def from_dict(cls, payload: dict) -> "ExoSection":
        return cls(name=payload["name"], items=[tuple(item) for item in payload["items"]])

    def get(self, key: str, default: str | None = None) -> str | None:
        for current_key, current_value in self.items:
            if current_key == key:
                return current_value
        return default

    def set(self, key: str, value: str) -> None:
        for index, (current_key, _) in enumerate(self.items):
            if current_key == key:
                self.items[index] = (key, value)
                return
        self.items.append((key, value))


def parse_exo_template(content: str, speaker_id: str, source_name: str, file_encoding: str) -> dict:
    sections = _parse_sections(content)
    exedit = next((section for section in sections if section.name == "[exedit]"), None)
    if exedit is None:
        raise ExoTemplateError("ERR-EXO-TEMPLATE-001", "EXO の [exedit] セクションが見つかりません。")

    text_sections: list[tuple[ExoSection, str, str]] = []
    candidates: list[tuple[ExoSection, list[ExoSection]]] = []
    for section in sections:
        if not section.name.endswith(".0]"):
            continue
        if section.get("_name") != "テキスト":
            continue
        decoded_text, encoding = decode_text_value(section.get("text", ""))
        text_sections.append((section, decoded_text, encoding))
        if decoded_text == "字幕テスト":
            parent_name = section.name.split(".")[0] + "]"
            sibling_sections = [item for item in sections if item.name == parent_name or item.name.startswith(parent_name[:-1] + ".")]
            candidates.append((section, sibling_sections))

    if not candidates and len(text_sections) == 1:
        section, decoded_text, encoding = text_sections[0]
        parent_name = section.name.split(".")[0] + "]"
        sibling_sections = [item for item in sections if item.name == parent_name or item.name.startswith(parent_name[:-1] + ".")]
        candidates.append((section, sibling_sections))
        placeholder_text = decoded_text
    elif not candidates:
        raise ExoTemplateError("ERR-EXO-TEMPLATE-001", "本文が「字幕テスト」のテキストオブジェクトが見つかりません。")
    else:
        placeholder_text = "字幕テスト"

    if len(candidates) > 1:
        raise ExoTemplateError("ERR-EXO-TEMPLATE-002", "「字幕テスト」に一致する候補が複数あります。")

    text_section, object_sections = candidates[0]
    parent_section = next(section for section in object_sections if "." not in section.name.strip("[]"))
    preview = {
        "font": text_section.get("font", ""),
        "size": text_section.get("サイズ", ""),
        "color": text_section.get("color", ""),
        "color2": text_section.get("color2", ""),
        "layer": parent_section.get("layer", ""),
    }
    _, encoding = decode_text_value(text_section.get("text", ""))

    return {
        "speaker_id": speaker_id,
        "template_source": source_name,
        "object_sections": [section.to_dict() for section in object_sections],
        "text_section_key": text_section.name,
        "placeholder_text": placeholder_text,
        "text_encoding": encoding,
        "file_encoding": file_encoding,
        "base_settings": dict(exedit.items),
        "preview": preview,
    }


def decode_exo_bytes(raw: bytes) -> tuple[str, str]:
    for encoding in ("utf-8-sig", "utf-8", "cp932"):
        try:
            return raw.decode(encoding), encoding
        except UnicodeDecodeError:
            continue
    raise ExoTemplateError("ERR-EXO-ENCODING-001", "対応できない EXO エンコーディングです。")


def decode_text_value(value: str) -> tuple[str, str]:
    stripped = value.strip()
    if stripped and len(stripped) % 2 == 0 and all(char in "0123456789abcdefABCDEF" for char in stripped):
        raw = bytes.fromhex(stripped)
        chunks: list[bytes] = []
        for index in range(0, len(raw), 2):
            chunk = raw[index : index + 2]
            if chunk == b"\x00\x00":
                break
            chunks.append(chunk)
        return b"".join(chunks).decode("utf-16le", errors="ignore"), "utf16le_hex"
    return stripped, "plain"


def encode_text_value(text: str, encoding: str, original_value: str) -> str:
    if encoding == "utf16le_hex":
        raw = text.encode("utf-16le") + b"\x00\x00"
        original_len = len(original_value.strip()) // 2
        if original_len > len(raw):
            raw = raw.ljust(original_len, b"\x00")
        return raw.hex()
    return text


def render_exo(sections: list[ExoSection]) -> str:
    lines: list[str] = []
    for section in sections:
        lines.append(section.name)
        for key, value in section.items:
            lines.append(f"{key}={value}")
    return "\n".join(lines) + "\n"


def _parse_sections(content: str) -> list[ExoSection]:
    sections: list[ExoSection] = []
    current_name: str | None = None
    current_items: list[tuple[str, str]] = []
    for raw_line in content.splitlines():
        line = raw_line.strip("\r")
        if not line:
            continue
        if line.startswith("[") and line.endswith("]"):
            if current_name is not None:
                sections.append(ExoSection(current_name, current_items))
            current_name = line
            current_items = []
            continue
        if "=" in line and current_name is not None:
            key, value = line.split("=", 1)
            current_items.append((key, value))
    if current_name is not None:
        sections.append(ExoSection(current_name, current_items))
    return sections
