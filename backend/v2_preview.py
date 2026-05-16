from __future__ import annotations

import html


def analyze_segments(project: dict, segments: list[dict]) -> dict:
    speaker_names = {speaker["speaker_id"]: speaker["display_name"] for speaker in project.get("speakers", [])}
    warnings: list[dict] = []
    by_layer: dict[int, list[dict]] = {}
    for segment in segments:
        layer = int(segment.get("base_layer") or 1)
        by_layer.setdefault(layer, []).append(segment)
        duration = float(segment["end_sec"]) - float(segment["start_sec"])
        if duration > 6.0:
            warnings.append(_warning("long_duration", segment, speaker_names, f"表示秒数が長めです: {duration:.2f}秒"))

    for layer, layer_segments in by_layer.items():
        sorted_segments = sorted(layer_segments, key=lambda item: (float(item["start_sec"]), float(item["end_sec"])))
        for prev, current in zip(sorted_segments, sorted_segments[1:]):
            if float(current["start_sec"]) < float(prev["end_sec"]):
                warnings.append(
                    {
                        "type": "layer_overlap",
                        "message": f"同じレイヤー {layer} で字幕が重なっています。",
                        "layer": layer,
                        "segments": [
                            _segment_ref(prev, speaker_names),
                            _segment_ref(current, speaker_names),
                        ],
                    }
                )

    return {"warning_count": len(warnings), "warnings": warnings}


def build_preview_html(project: dict, segments: list[dict], analysis: dict) -> str:
    title = html.escape(project["project"]["name"])
    rows: list[str] = []
    speaker_names = {speaker["speaker_id"]: speaker["display_name"] for speaker in project.get("speakers", [])}
    for segment in segments:
        speaker_name = html.escape(speaker_names.get(segment["speaker_id"], segment["speaker_id"]))
        text = html.escape(str(segment["text"])).replace("\n", "<br>")
        warnings = html.escape(", ".join(segment.get("warnings", [])))
        rows.append(
            "<tr>"
            f"<td>{speaker_name}</td>"
            f"<td>{float(segment['start_sec']):.2f}</td>"
            f"<td>{float(segment['end_sec']):.2f}</td>"
            f"<td>{int(segment.get('base_layer') or 1)}</td>"
            f"<td>{text}</td>"
            f"<td>{warnings}</td>"
            "</tr>"
        )

    warning_items = "".join(f"<li>{html.escape(item['message'])}</li>" for item in analysis.get("warnings", []))
    if not warning_items:
        warning_items = "<li>警告はありません。</li>"

    return f"""<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{title} preview</title>
  <style>
    body {{ margin: 0; padding: 24px; font-family: "Yu Gothic UI", sans-serif; background: #f7f4ef; color: #2b2118; }}
    h1, h2 {{ font-family: "BIZ UDPMincho", serif; }}
    .panel {{ margin-top: 20px; padding: 20px; background: #fffaf2; border: 1px solid #dccdb8; border-radius: 18px; }}
    table {{ width: 100%; border-collapse: collapse; }}
    th, td {{ padding: 10px 12px; border-bottom: 1px solid #e4d7c6; text-align: left; vertical-align: top; }}
  </style>
</head>
<body>
  <h1>{title}</h1>
  <div class="panel">
    <h2>警告</h2>
    <ul>{warning_items}</ul>
  </div>
  <div class="panel">
    <h2>字幕一覧</h2>
    <table>
      <thead>
        <tr><th>話者</th><th>開始</th><th>終了</th><th>レイヤー</th><th>本文</th><th>分割警告</th></tr>
      </thead>
      <tbody>{''.join(rows)}</tbody>
    </table>
  </div>
</body>
</html>
"""


def _warning(kind: str, segment: dict, speaker_names: dict[str, str], message: str) -> dict:
    return {"type": kind, "message": message, "segments": [_segment_ref(segment, speaker_names)]}


def _segment_ref(segment: dict, speaker_names: dict[str, str]) -> dict:
    return {
        "subtitle_id": segment.get("subtitle_id", ""),
        "speaker_id": segment["speaker_id"],
        "speaker_name": speaker_names.get(segment["speaker_id"], segment["speaker_id"]),
        "start_sec": float(segment["start_sec"]),
        "end_sec": float(segment["end_sec"]),
        "base_layer": int(segment.get("base_layer") or 1),
        "text": str(segment["text"]),
    }
