import { error, json, notFound, readJson } from "./lib/http";
import { assignFrames, buildExo, buildSegmentsJson, buildSrt, decodeExoBytes, parseExoTemplate } from "./lib/exo";
import { analyzeSegments, buildPreviewHtml } from "./lib/preview";
import { decodeSrtBytes, parseSrt } from "./lib/srt";
import { splitSegments } from "./lib/split";
import type { ProjectPayload, ProjectSpeaker, Segment, SubtitleRule, WorkerEnv } from "./lib/types";

type ProjectRecord = {
  project_id?: string;
  project: ProjectPayload;
  speakers: Array<{
    speaker_id?: string;
    display_name: string;
    base_layer: number;
    subtitle_rule: SubtitleRule;
    template_exo?: string;
    template_meta?: ProjectSpeaker["template_meta"];
  }>;
};

type ConvertRequest = {
  project: ProjectPayload;
  speakers: Array<{
    display_name: string;
    base_layer?: number;
    subtitle_rule: SubtitleRule;
    srt_name: string;
    srt_content?: string;
    srt_content_b64?: string;
    template_name: string;
    template_content?: string;
    template_content_b64?: string;
  }>;
};

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      return json({ ok: true, runtime: "cloudflare-worker" });
    }
    if (url.pathname === "/api/v2/parse-srt" && request.method === "POST") {
      try {
        const payload = await readJson<{ speaker_id: string; srt_content: string }>(request);
        const segments = parseSrt(payload.srt_content, payload.speaker_id || "spk_001");
        return json({ segments });
      } catch (cause) {
        return error(400, "ERR-SRT-001", cause instanceof Error ? cause.message : "SRT parse failed");
      }
    }
    if (url.pathname === "/api/v2/analyze" && request.method === "POST") {
      try {
        const payload = await readJson<{ project: ProjectPayload; speakers: ProjectSpeaker[]; segments: Segment[] }>(request);
        const analysis = analyzeSegments(payload.speakers, payload.segments);
        const preview_html = buildPreviewHtml({ name: payload.project.name }, payload.speakers, payload.segments, analysis);
        return json({ analysis, preview_html });
      } catch (cause) {
        return error(400, "ERR-V2-ANALYZE-001", cause instanceof Error ? cause.message : "Analyze failed");
      }
    }
    if (url.pathname === "/api/v2/template-preview" && request.method === "POST") {
      try {
        const payload = await readJson<{ template_name: string; template_content?: string; template_content_b64?: string }>(request);
        const [templateText, templateEncoding] = resolveTextPayload(
          payload.template_content_b64,
          payload.template_content,
          decodeExoBytes
        );
        const template_meta = parseExoTemplate(templateText, "preview", payload.template_name || "template.exo", templateEncoding);
        return json({ template_preview_meta: template_meta.preview, file_encoding: templateEncoding });
      } catch (cause) {
        return error(400, "ERR-V2-TEMPLATE-001", cause instanceof Error ? cause.message : "Template preview failed");
      }
    }
    if (url.pathname === "/api/v2/convert" && request.method === "POST") {
      try {
        const payload = await readJson<ConvertRequest>(request);
        if (!Array.isArray(payload.speakers) || payload.speakers.length === 0) {
          throw new Error("ERR-V2-CONVERT-001: 話者を1件以上指定してください。");
        }
        const speakerOrder: Record<string, number> = {};
        const speakers: ProjectSpeaker[] = [];
        const rawSegments: Segment[] = [];
        payload.speakers.forEach((speakerInput, index) => {
          const speaker_id = `spk_${String(index + 1).padStart(3, "0")}`;
          speakerOrder[speaker_id] = index + 1;
          const [templateText, templateEncoding] = resolveTextPayload(
            speakerInput.template_content_b64,
            speakerInput.template_content,
            decodeExoBytes
          );
          const template_meta = parseExoTemplate(templateText, speaker_id, speakerInput.template_name, templateEncoding);
          const base_layer = speakerInput.base_layer || Number.parseInt(template_meta.preview.layer || "1", 10) || 1;
          speakers.push({
            speaker_id,
            display_name: speakerInput.display_name,
            base_layer,
            subtitle_rule: speakerInput.subtitle_rule,
            template_exo: speakerInput.template_name,
            template_meta,
          });
          const [srtText] = resolveTextPayload(speakerInput.srt_content_b64, speakerInput.srt_content, decodeSrtBytes);
          const parsed = parseSrt(srtText, speaker_id).map((segment) => ({ ...segment, base_layer }));
          rawSegments.push(...splitSegments(parsed, speakerInput.subtitle_rule));
        });
        const framed = assignFrames(rawSegments, payload.project.fps, speakerOrder);
        const analysis = analyzeSegments(speakers, framed);
        const preview_html = buildPreviewHtml({ name: payload.project.name }, speakers, framed, analysis);
        const exo_text = buildExo(payload.project, speakers, framed);
        const srt_text = buildSrt(framed);
        const json_text = buildSegmentsJson(framed);
        return json({
          project: {
            schema_version: "0.2-cloudflare",
            project_id: "worker-preview",
            project: payload.project,
            speakers,
            segments: framed,
          },
          segments: framed,
          analysis,
          exo_content: exo_text,
          srt_content: srt_text,
          json_content: json_text,
          preview_html,
        });
      } catch (cause) {
        return error(400, "ERR-V2-CONVERT-001", cause instanceof Error ? cause.message : "Convert failed");
      }
    }
    if (url.pathname === "/api/v2/projects" && request.method === "GET") {
      if (!env.DB) {
        return json({ projects: [] });
      }
      const result = await env.DB.prepare("SELECT project_id, name, updated_at FROM projects ORDER BY updated_at DESC").all();
      return json({ projects: result.results ?? [] });
    }
    if (url.pathname === "/api/v2/projects" && request.method === "POST") {
      if (!env.DB) {
        return error(500, "ERR-DB-001", "D1 binding is not configured.");
      }
      const payload = await readJson<ProjectRecord>(request);
      const projectId = payload.project_id || crypto.randomUUID();
      const now = new Date().toISOString();
      await env.DB.prepare(
        "INSERT OR REPLACE INTO projects (project_id, name, payload_json, created_by, created_at, updated_at) VALUES (?1, ?2, ?3, 'local-dev', COALESCE((SELECT created_at FROM projects WHERE project_id = ?1), ?4), ?5)"
      )
        .bind(projectId, payload.project.name, JSON.stringify(payload), now, now)
        .run();
      return json({ project_id: projectId, saved: true });
    }
    if (url.pathname === "/api/v2/presets" && request.method === "GET") {
      if (!env.DB) {
        return json({ presets: [] });
      }
      const result = await env.DB.prepare("SELECT preset_id, name, updated_at FROM presets ORDER BY updated_at DESC").all();
      return json({ presets: result.results ?? [] });
    }
    if (url.pathname === "/api/v2/presets" && request.method === "POST") {
      if (!env.DB) {
        return error(500, "ERR-DB-001", "D1 binding is not configured.");
      }
      const payload = await readJson<{ preset_id?: string; name: string; payload: unknown }>(request);
      const presetId = payload.preset_id || crypto.randomUUID();
      const now = new Date().toISOString();
      await env.DB.prepare(
        "INSERT OR REPLACE INTO presets (preset_id, name, payload_json, created_by, created_at, updated_at) VALUES (?1, ?2, ?3, 'local-dev', COALESCE((SELECT created_at FROM presets WHERE preset_id = ?1), ?4), ?5)"
      )
        .bind(presetId, payload.name, JSON.stringify(payload.payload), now, now)
        .run();
      return json({ preset_id: presetId, saved: true });
    }
    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }
    return notFound();
  },
};

function resolveTextPayload(
  contentB64: string | undefined,
  fallbackText: string | undefined,
  decoder: (raw: Uint8Array) => [string, string]
): [string, string] {
  if (contentB64) {
    return decoder(base64ToBytes(contentB64));
  }
  if (typeof fallbackText === "string" && fallbackText.length > 0) {
    return [fallbackText, "utf-8"];
  }
  throw new Error("ERR-REQUEST-001: ファイル内容が不足しています。");
}

function base64ToBytes(contentB64: string): Uint8Array {
  const binary = atob(contentB64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
