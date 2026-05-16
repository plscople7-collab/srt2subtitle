import type { ProjectSpeaker, Segment } from "./types";

export function analyzeSegments(speakers: ProjectSpeaker[], segments: Segment[]) {
  const speakerNames = new Map(speakers.map((speaker) => [speaker.speaker_id, speaker.display_name]));
  const warnings: Array<{ type: string; message: string }> = [];
  const byLayer = new Map<number, Segment[]>();
  for (const segment of segments) {
    const layer = segment.base_layer ?? 1;
    const bucket = byLayer.get(layer) ?? [];
    bucket.push(segment);
    byLayer.set(layer, bucket);
    const duration = segment.end_sec - segment.start_sec;
    if (duration > 6.0) {
      warnings.push({ type: "long_duration", message: `${speakerNames.get(segment.speaker_id) ?? segment.speaker_id}: 表示秒数が長めです (${duration.toFixed(2)}秒)` });
    }
  }
  for (const [layer, items] of byLayer.entries()) {
    const sorted = [...items].sort((a, b) => a.start_sec - b.start_sec || a.end_sec - b.end_sec);
    for (let index = 1; index < sorted.length; index += 1) {
      if (sorted[index].start_sec < sorted[index - 1].end_sec) {
        warnings.push({ type: "layer_overlap", message: `レイヤー ${layer} で字幕が重なっています。` });
      }
    }
  }
  return { warning_count: warnings.length, warnings };
}

export function buildPreviewHtml(project: { name: string }, speakers: ProjectSpeaker[], segments: Segment[], analysis: { warnings: Array<{ message: string }> }) {
  const speakerNames = new Map(speakers.map((speaker) => [speaker.speaker_id, speaker.display_name]));
  const rows = segments.map((segment) => {
    const text = escapeHtml(segment.text).replace(/\n/g, "<br>");
    return `<tr><td>${escapeHtml(speakerNames.get(segment.speaker_id) ?? segment.speaker_id)}</td><td>${segment.start_sec.toFixed(2)}</td><td>${segment.end_sec.toFixed(2)}</td><td>${segment.base_layer ?? 1}</td><td>${text}</td></tr>`;
  }).join("");
  const warningItems = analysis.warnings.length > 0
    ? analysis.warnings.map((item) => `<li>${escapeHtml(item.message)}</li>`).join("")
    : "<li>警告はありません。</li>";
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escapeHtml(project.name)} preview</title></head><body><h1>${escapeHtml(project.name)}</h1><h2>警告</h2><ul>${warningItems}</ul><h2>字幕一覧</h2><table><thead><tr><th>話者</th><th>開始</th><th>終了</th><th>レイヤー</th><th>本文</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}
