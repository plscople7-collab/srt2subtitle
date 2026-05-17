from __future__ import annotations

from .exo_parser import decode_exo_bytes, parse_exo_template
from .exo_writer import assign_frames, build_exo, build_segments_json, build_srt
from .v2_preview import analyze_segments
from .srt_parser import decode_srt_bytes, parse_srt
from .subtitle_splitter import split_segments
from .validators import validate_project_payload, validate_v2_speaker_payload


def convert_srt_project(project_payload: dict, speaker_specs: list[dict]) -> dict:
    if not speaker_specs:
        raise ValueError("speaker_specs must not be empty")

    _normalize_speaker_layers(speaker_specs)

    project = {
        "schema_version": "0.2-draft",
        "project_id": "v2_preview",
        "project": validate_project_payload(project_payload),
        "speakers": [],
        "segments": [],
    }

    recognized_segments: list[dict] = []
    speaker_order: dict[str, int] = {}
    for index, speaker_spec in enumerate(speaker_specs, start=1):
        speaker_id = f"spk_{index:03d}"
        validated_speaker = validate_v2_speaker_payload(
            speaker_spec.get("display_name", ""),
            speaker_spec.get("subtitle_rule", {}),
            speaker_spec.get("base_layer"),
        )

        template_name = str(speaker_spec["template_name"])
        template_bytes = speaker_spec["template_bytes"]
        template_text, file_encoding = decode_exo_bytes(template_bytes)
        template_meta = parse_exo_template(template_text, speaker_id, template_name, file_encoding)

        srt_name = str(speaker_spec["srt_name"])
        srt_text, srt_encoding = decode_srt_bytes(speaker_spec["srt_bytes"])
        del srt_encoding
        base_layer = validated_speaker["base_layer"] or int(template_meta["preview"].get("layer") or 1)

        raw_segments = parse_srt(srt_text, speaker_id)
        for segment in raw_segments:
            segment["base_layer"] = base_layer
        split_result = split_segments(raw_segments, validated_speaker["subtitle_rule"])
        recognized_segments.extend(split_result)
        speaker_order[speaker_id] = index

        project["speakers"].append(
            {
                "speaker_id": speaker_id,
                "display_name": validated_speaker["display_name"],
                "audio_files": [],
                "template_exo": template_name,
                "transcript_json": srt_name,
                "preset_id": "",
                "base_layer": base_layer,
                "subtitle_rule": validated_speaker["subtitle_rule"],
                "template_meta": template_meta,
            }
        )

    framed_segments = assign_frames(recognized_segments, float(project["project"]["fps"]), speaker_order)
    project["segments"] = framed_segments
    exo_text = build_exo(project, framed_segments)
    srt_text = build_srt(framed_segments)
    json_text = build_segments_json(framed_segments)
    analysis = analyze_segments(project, framed_segments)
    exo_encoding = project["speakers"][0]["template_meta"].get("file_encoding", "utf-8")
    exo_bytes = exo_text.encode(exo_encoding, errors="strict")
    return {
        "project": project,
        "segments": framed_segments,
        "analysis": analysis,
        "exo_text": exo_text,
        "exo_bytes": exo_bytes,
        "srt_text": srt_text,
        "json_text": json_text,
    }


def _normalize_speaker_layers(speaker_specs: list[dict]) -> None:
    used: set[int] = set()
    for speaker_spec in speaker_specs:
        try:
            value = int(speaker_spec.get("base_layer") or 1)
        except (TypeError, ValueError):
            value = 1
        if value < 1:
            value = 1
        while value in used:
            value += 1
        used.add(value)
        speaker_spec["base_layer"] = value
