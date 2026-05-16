import { error, json, notFound, readJson } from "./lib/http";
import { analyzeSegments, buildPreviewHtml } from "./lib/preview";
import { parseSrt } from "./lib/srt";
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
