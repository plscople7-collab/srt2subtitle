from __future__ import annotations

import json
from copy import deepcopy

from .exo_parser import ExoSection, encode_text_value, render_exo


def assign_frames(segments: list[dict], fps: float, speaker_order: dict[str, int]) -> list[dict]:
    sorted_segments = sorted(
        segments,
        key=lambda item: (
            float(item["start_sec"]),
            float(item["end_sec"]) - float(item["start_sec"]),
            speaker_order.get(item["speaker_id"], 9999),
        ),
    )

    previous_by_speaker: dict[str, dict] = {}
    for index, segment in enumerate(sorted_segments, start=1):
        start_frame = round(float(segment["start_sec"]) * fps) + 1
        end_frame = max(start_frame, round(float(segment["end_sec"]) * fps))
        prev = previous_by_speaker.get(segment["speaker_id"])
        if prev is not None and start_frame <= prev["end_frame"]:
            start_frame = prev["end_frame"] + 1
            end_frame = max(start_frame, end_frame)
        segment["subtitle_id"] = f"sub_{index:06d}"
        segment["start_frame"] = start_frame
        segment["end_frame"] = end_frame
        previous_by_speaker[segment["speaker_id"]] = segment
    return sorted_segments


def build_exo(project: dict, segments: list[dict]) -> str:
    speakers = project["speakers"]
    template_map = {speaker["speaker_id"]: speaker["template_meta"] for speaker in speakers}
    base_settings = deepcopy(next(iter(template_map.values()))["base_settings"])
    base_settings["width"] = str(project["project"]["width"])
    base_settings["height"] = str(project["project"]["height"])
    base_settings["rate"] = str(int(project["project"]["fps"]) if float(project["project"]["fps"]).is_integer() else project["project"]["fps"])
    base_settings["audio_rate"] = str(project["project"]["audio_rate"])
    base_settings["audio_ch"] = str(project["project"]["audio_ch"])
    base_settings["length"] = str(max((segment["end_frame"] for segment in segments), default=1))

    output_sections = [ExoSection("[exedit]", list(base_settings.items()))]
    for object_index, segment in enumerate(segments):
        template = template_map.get(segment["speaker_id"])
        if template is None:
            raise ValueError("ERR-EXO-SPEAKER-001")
        text_section_key = template["text_section_key"]
        for section_payload in template["object_sections"]:
            section = ExoSection.from_dict(section_payload)
            new_name = _renumber_section_name(section.name, object_index)
            section.name = new_name
            if "." not in new_name.strip("[]"):
                section.set("start", str(segment["start_frame"]))
                section.set("end", str(segment["end_frame"]))
                if segment.get("base_layer") is not None:
                    section.set("layer", str(segment["base_layer"]))
            if section_payload["name"] == text_section_key:
                original_value = section.get("text", "")
                section.set("text", encode_text_value(segment["text"], template["text_encoding"], original_value))
            output_sections.append(section)
    return render_exo(output_sections)


def build_srt(segments: list[dict]) -> str:
    blocks: list[str] = []
    for index, segment in enumerate(segments, start=1):
        blocks.append(
            "\n".join(
                [
                    str(index),
                    f"{_format_srt_time(segment['start_sec'])} --> {_format_srt_time(segment['end_sec'])}",
                    segment["text"],
                ]
            )
        )
    return "\n\n".join(blocks) + ("\n" if blocks else "")


def build_segments_json(segments: list[dict]) -> str:
    return json.dumps({"segments": segments}, ensure_ascii=False, indent=2)


def _renumber_section_name(name: str, index: int) -> str:
    inner = name.strip("[]")
    parts = inner.split(".")
    parts[0] = str(index)
    return "[" + ".".join(parts) + "]"


def _format_srt_time(value: float) -> str:
    total_ms = max(0, round(float(value) * 1000))
    hours, remain = divmod(total_ms, 3_600_000)
    minutes, remain = divmod(remain, 60_000)
    seconds, millis = divmod(remain, 1000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d},{millis:03d}"
