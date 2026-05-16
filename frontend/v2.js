const v2State = {
  project: null,
  speakers: [],
  segments: [],
  output: {
    exoContentB64: "",
    srtContent: "",
    jsonContent: "",
    previewHtml: "",
  },
  analysis: null,
};

const V2_API_BASE = window.location.protocol === "file:" ? "http://127.0.0.1:8000" : "";
const v2SpeakerList = document.querySelector("#v2SpeakerList");
const v2SpeakerTemplate = document.querySelector("#v2SpeakerTemplate");
const v2ProjectStatus = document.querySelector("#v2ProjectStatus");
const v2GenerationStatus = document.querySelector("#v2GenerationStatus");
const v2SegmentTableBody = document.querySelector("#v2SegmentTableBody");
const v2SpeakerFilter = document.querySelector("#v2SpeakerFilter");
const v2ConvertButton = document.querySelector("#v2ConvertButton");
const v2SaveProjectButton = document.querySelector("#v2SaveProjectButton");
const v2SaveServerProjectButton = document.querySelector("#v2SaveServerProjectButton");
const v2LoadProjectButton = document.querySelector("#v2LoadProjectButton");
const v2ProjectFileInput = document.querySelector("#v2ProjectFileInput");
const v2ProjectPicker = document.querySelector("#v2ProjectPicker");
const v2ReloadProjectsButton = document.querySelector("#v2ReloadProjectsButton");
const v2OpenServerProjectButton = document.querySelector("#v2OpenServerProjectButton");
const v2PresetPicker = document.querySelector("#v2PresetPicker");
const v2ReloadPresetsButton = document.querySelector("#v2ReloadPresetsButton");
const v2ApplyPresetButton = document.querySelector("#v2ApplyPresetButton");
const v2DownloadExoButton = document.querySelector("#v2DownloadExoButton");
const v2DownloadSrtButton = document.querySelector("#v2DownloadSrtButton");
const v2DownloadJsonButton = document.querySelector("#v2DownloadJsonButton");
const v2DownloadPreviewButton = document.querySelector("#v2DownloadPreviewButton");
const v2AnalysisSummary = document.querySelector("#v2AnalysisSummary");
const v2AnalysisList = document.querySelector("#v2AnalysisList");
const v2PreviewFrame = document.querySelector("#v2PreviewFrame");

document.querySelector("#v2AddSpeakerButton").addEventListener("click", addV2SpeakerCard);
v2ConvertButton.addEventListener("click", convertV2Project);
v2SaveProjectButton.addEventListener("click", saveV2ProjectBundle);
v2SaveServerProjectButton.addEventListener("click", saveV2ProjectToServer);
v2LoadProjectButton.addEventListener("click", () => v2ProjectFileInput.click());
v2ProjectFileInput.addEventListener("change", loadV2ProjectBundle);
v2ReloadProjectsButton.addEventListener("click", loadV2Projects);
v2OpenServerProjectButton.addEventListener("click", openSelectedV2Project);
v2ReloadPresetsButton.addEventListener("click", loadV2Presets);
v2ApplyPresetButton.addEventListener("click", applySelectedV2Preset);
v2SpeakerFilter.addEventListener("change", renderV2Segments);
v2DownloadExoButton.addEventListener("click", () => {
  downloadBase64(v2OutputName("exo"), v2State.output.exoContentB64, "application/octet-stream");
});
v2DownloadSrtButton.addEventListener("click", () => {
  downloadText(v2OutputName("srt"), v2State.output.srtContent);
});
v2DownloadJsonButton.addEventListener("click", () => {
  downloadText(v2OutputName("json"), v2State.output.jsonContent);
});
v2DownloadPreviewButton.addEventListener("click", () => {
  downloadText(v2OutputName("preview.html"), v2State.output.previewHtml);
});

addV2SpeakerCard();
void loadV2Projects();
void loadV2Presets();

function addV2SpeakerCard(initialData = null) {
  const fragment = v2SpeakerTemplate.content.cloneNode(true);
  const card = fragment.querySelector(".speaker-card");
  card.querySelector(".remove-speaker").addEventListener("click", () => card.remove());
  card.querySelector(".save-preset").addEventListener("click", () => saveV2PresetFromCard(card));
  card.querySelector('[name="srt_file"]').addEventListener("change", () => refreshCardSourceStatus(card));
  card.querySelector('[name="template_exo"]').addEventListener("change", async () => {
    await refreshTemplatePreview(card);
    refreshCardSourceStatus(card);
  });
  if (initialData) {
    hydrateV2SpeakerCard(card, initialData);
  } else {
    refreshCardSourceStatus(card);
  }
  v2SpeakerList.appendChild(fragment);
}

async function convertV2Project() {
  try {
    setBusy(v2ConvertButton, true);
    v2GenerationStatus.textContent = "SRT と EXO を解析しています...";
    const formData = new FormData();
    const projectForm = document.querySelector("#v2ProjectForm");
    const projectPayload = Object.fromEntries(new FormData(projectForm).entries());
    formData.append("project_json", JSON.stringify(projectPayload));

    const cards = [...v2SpeakerList.querySelectorAll(".speaker-card")];
    formData.append("speaker_count", String(cards.length));
    for (const [index, card] of cards.entries()) {
      formData.append(`speaker_${index}_display_name`, card.querySelector('[name="display_name"]').value);
      formData.append(
        `speaker_${index}_subtitle_rule_json`,
        JSON.stringify({
          max_chars_per_line: Number(card.querySelector('[name="max_chars_per_line"]').value),
          max_lines: Number(card.querySelector('[name="max_lines"]').value),
          min_duration_sec: Number(card.querySelector('[name="min_duration_sec"]').value),
          max_duration_sec: Number(card.querySelector('[name="max_duration_sec"]').value),
        }),
      );
      formData.append(`speaker_${index}_base_layer`, card.querySelector('[name="base_layer"]').value);

      const srtFile = await resolveCardFile(card, "srt");
      const templateFile = await resolveCardFile(card, "template");
      if (srtFile) {
        formData.append(`speaker_${index}_srt_file`, srtFile, srtFile.name);
      }
      if (templateFile) {
        formData.append(`speaker_${index}_template_exo`, templateFile, templateFile.name);
      }
    }

    const response = await fetchJson("/api/v2/convert", {
      method: "POST",
      body: formData,
    });
    v2State.project = response.project;
    v2State.segments = response.segments;
    v2State.speakers = response.project.speakers.map((speaker) => ({
      speaker_id: speaker.speaker_id,
      display_name: speaker.display_name,
    }));
    v2State.output.exoContentB64 = response.exo_content_b64;
    v2State.output.srtContent = response.srt_content;
    v2State.output.jsonContent = response.json_content;
    v2State.output.previewHtml = response.preview_html;
    v2State.analysis = response.analysis;
    v2ProjectStatus.textContent = `変換対象: ${response.project.project.name}`;
    v2GenerationStatus.textContent = `${response.segments.length} 件の字幕を生成しました。`;
    toggleV2DownloadButtons(false);
    renderV2Analysis();
    renderV2HtmlPreview();
    rebuildV2SpeakerFilter();
    renderV2Segments();
  } catch (error) {
    v2GenerationStatus.textContent = formatV2Error(error, "v0.2 変換に失敗しました。");
    toggleV2DownloadButtons(true);
  } finally {
    setBusy(v2ConvertButton, false);
  }
}

async function saveV2ProjectBundle() {
  try {
    setBusy(v2SaveProjectButton, true);
    const bundle = {
      schema_version: "0.2-local-project",
      project: Object.fromEntries(new FormData(document.querySelector("#v2ProjectForm")).entries()),
      speakers: await Promise.all(
        [...v2SpeakerList.querySelectorAll(".speaker-card")].map(async (card) => ({
          display_name: card.querySelector('[name="display_name"]').value,
          subtitle_rule: {
            max_chars_per_line: Number(card.querySelector('[name="max_chars_per_line"]').value),
            max_lines: Number(card.querySelector('[name="max_lines"]').value),
            min_duration_sec: Number(card.querySelector('[name="min_duration_sec"]').value),
            max_duration_sec: Number(card.querySelector('[name="max_duration_sec"]').value),
          },
          base_layer: Number(card.querySelector('[name="base_layer"]').value),
          srt_file: await serializeCardFile(card, "srt"),
          template_exo: await serializeCardFile(card, "template"),
        })),
      ),
    };
    downloadText(`${bundle.project.output_name || "v2_project"}.project.json`, JSON.stringify(bundle, null, 2));
    v2ProjectStatus.textContent = `保存用 JSON を出力しました: ${bundle.project.name}`;
  } catch (error) {
    v2ProjectStatus.textContent = formatV2Error(error, "v2 プロジェクト保存に失敗しました。");
  } finally {
    setBusy(v2SaveProjectButton, false);
  }
}

async function saveV2ProjectToServer() {
  try {
    setBusy(v2SaveServerProjectButton, true);
    const payload = await buildV2ProjectBundle();
    const response = await fetchJson("/api/v2/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, project_id: v2State.project?.project_id || "" }),
    });
    v2State.project = { ...(v2State.project || {}), project_id: response.project_id, project: response.project };
    v2ProjectStatus.textContent = `一覧へ保存しました: ${response.project_id}`;
    await loadV2Projects();
  } catch (error) {
    v2ProjectStatus.textContent = formatV2Error(error, "v2 プロジェクトの一覧保存に失敗しました。");
  } finally {
    setBusy(v2SaveServerProjectButton, false);
  }
}

async function loadV2ProjectBundle(event) {
  const file = event.target.files[0];
  if (!file) {
    return;
  }
  try {
    setBusy(v2LoadProjectButton, true);
    const payload = JSON.parse(await file.text());
    applyProjectBundle(payload);
    v2ProjectStatus.textContent = `読込済み: ${payload.project?.name || file.name}`;
  } catch (error) {
    v2ProjectStatus.textContent = formatV2Error(error, "v2 プロジェクト読込に失敗しました。");
  } finally {
    event.target.value = "";
    setBusy(v2LoadProjectButton, false);
  }
}

async function loadV2Projects() {
  const response = await fetchJson("/api/v2/projects", { method: "GET" });
  v2ProjectPicker.innerHTML = '<option value="">選択してください</option>';
  for (const project of response.projects) {
    const option = document.createElement("option");
    option.value = project.project_id;
    option.textContent = `${project.name} (${project.project_id}) / ${project.speaker_count}話者`;
    v2ProjectPicker.appendChild(option);
  }
}

async function openSelectedV2Project() {
  if (!v2ProjectPicker.value) {
    v2ProjectStatus.textContent = "保存済み v2 プロジェクトを選択してください。";
    return;
  }
  const payload = await fetchJson(`/api/v2/projects/${v2ProjectPicker.value}`, { method: "GET" });
  applyProjectBundle(payload);
  v2State.project = { project_id: payload.project_id, project: payload.project };
  v2ProjectStatus.textContent = `一覧から読込済み: ${payload.project_id}`;
}

async function loadV2Presets() {
  const response = await fetchJson("/api/v2/presets", { method: "GET" });
  v2PresetPicker.innerHTML = '<option value="">選択してください</option>';
  for (const preset of response.presets) {
    const option = document.createElement("option");
    option.value = preset.preset_id;
    option.textContent = `${preset.name} / layer ${preset.base_layer}`;
    v2PresetPicker.appendChild(option);
  }
}

async function saveV2PresetFromCard(card) {
  try {
    await refreshTemplatePreview(card);
    const templateExo = await serializeCardFile(card, "template");
    const payload = {
      name: card.querySelector('[name="preset_name"]').value || card.querySelector('[name="display_name"]').value || "preset",
      subtitle_rule: {
        max_chars_per_line: Number(card.querySelector('[name="max_chars_per_line"]').value),
        max_lines: Number(card.querySelector('[name="max_lines"]').value),
        min_duration_sec: Number(card.querySelector('[name="min_duration_sec"]').value),
        max_duration_sec: Number(card.querySelector('[name="max_duration_sec"]').value),
      },
      base_layer: Number(card.querySelector('[name="base_layer"]').value),
      template_exo: templateExo,
      preset_id: card.dataset.presetId || "",
    };
    const response = await fetchJson("/api/v2/presets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    card.dataset.presetId = response.preset_id;
    card.querySelector('[name="preset_name"]').value = response.name;
    card._templatePreviewMeta = response.template_preview_meta || card._templatePreviewMeta || null;
    refreshCardSourceStatus(card, `プリセット保存済み: ${response.name}`);
    await loadV2Presets();
  } catch (error) {
    v2ProjectStatus.textContent = formatV2Error(error, "v2 プリセット保存に失敗しました。");
  }
}

async function applySelectedV2Preset() {
  if (!v2PresetPicker.value) {
    v2ProjectStatus.textContent = "共有プリセットを選択してください。";
    return;
  }
  const cards = [...v2SpeakerList.querySelectorAll(".speaker-card")];
  const card = cards[cards.length - 1];
  if (!card) {
    v2ProjectStatus.textContent = "先に話者カードを追加してください。";
    return;
  }
  const preset = await fetchJson(`/api/v2/presets/${v2PresetPicker.value}`, { method: "GET" });
  card.dataset.presetId = preset.preset_id;
  card.querySelector('[name="preset_name"]').value = preset.name;
  card.querySelector('[name="max_chars_per_line"]').value = preset.subtitle_rule.max_chars_per_line;
  card.querySelector('[name="max_lines"]').value = preset.subtitle_rule.max_lines;
  card.querySelector('[name="min_duration_sec"]').value = preset.subtitle_rule.min_duration_sec;
  card.querySelector('[name="max_duration_sec"]').value = preset.subtitle_rule.max_duration_sec;
  card.querySelector('[name="base_layer"]').value = preset.base_layer;
  card._storedTemplateFile = preset.template_exo;
  card._templatePreviewMeta = preset.template_preview_meta || null;
  refreshCardSourceStatus(card, `共有プリセット適用: ${preset.name}`);
}

function renderV2Segments() {
  v2SegmentTableBody.innerHTML = "";
  const filterValue = v2SpeakerFilter.value;
  const rows = v2State.segments.filter((segment) => !filterValue || segment.speaker_id === filterValue);
  for (const segment of rows) {
    const speaker = v2State.speakers.find((item) => item.speaker_id === segment.speaker_id);
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(speaker ? speaker.display_name : segment.speaker_id)}</td>
      <td>${Number(segment.start_sec).toFixed(2)}</td>
      <td>${Number(segment.end_sec).toFixed(2)}</td>
      <td>${escapeHtml(segment.text).replaceAll("\n", "<br>")}</td>
      <td>${escapeHtml((segment.warnings || []).join(", "))}</td>
    `;
    v2SegmentTableBody.appendChild(row);
  }
}

function rebuildV2SpeakerFilter() {
  v2SpeakerFilter.innerHTML = '<option value="">全話者</option>';
  for (const speaker of v2State.speakers) {
    const option = document.createElement("option");
    option.value = speaker.speaker_id;
    option.textContent = speaker.display_name;
    v2SpeakerFilter.appendChild(option);
  }
}

function toggleV2DownloadButtons(disabled) {
  v2DownloadExoButton.disabled = disabled;
  v2DownloadSrtButton.disabled = disabled;
  v2DownloadJsonButton.disabled = disabled;
  v2DownloadPreviewButton.disabled = disabled;
}

function applyProjectBundle(payload) {
  const form = document.querySelector("#v2ProjectForm");
  for (const [key, value] of Object.entries(payload.project || {})) {
    const input = form.querySelector(`[name="${key}"]`);
    if (input) {
      input.value = value;
    }
  }
  v2SpeakerList.innerHTML = "";
  for (const speaker of payload.speakers || []) {
    addV2SpeakerCard(speaker);
  }
  if (!payload.speakers || payload.speakers.length === 0) {
    addV2SpeakerCard();
  }
  v2State.project = null;
  v2State.speakers = [];
  v2State.segments = [];
  v2State.output = { exoContentB64: "", srtContent: "", jsonContent: "", previewHtml: "" };
  v2State.analysis = null;
  toggleV2DownloadButtons(true);
  renderV2Analysis();
  renderV2HtmlPreview();
  rebuildV2SpeakerFilter();
  renderV2Segments();
}

async function buildV2ProjectBundle() {
  const cards = [...v2SpeakerList.querySelectorAll(".speaker-card")];
  const speakers = [];
  for (const [index, card] of cards.entries()) {
    const displayName = card.querySelector('[name="display_name"]').value.trim();
    const hasSrt = Boolean(card.querySelector('[name="srt_file"]').files[0] || card._storedSrtFile);
    const hasTemplate = Boolean(card.querySelector('[name="template_exo"]').files[0] || card._storedTemplateFile);
    const isCompletelyEmpty = !displayName && !hasSrt && !hasTemplate;
    if (isCompletelyEmpty) {
      continue;
    }
    if (!displayName) {
      throw new Error(`話者${index + 1} の話者名を入力してください。`);
    }
    if (!hasSrt) {
      throw new Error(`話者${index + 1} の SRT を指定してください。`);
    }
    if (!hasTemplate) {
      throw new Error(`話者${index + 1} のテンプレート EXO を指定してください。`);
    }
    speakers.push({
      display_name: displayName,
      preset_id: card.dataset.presetId || "",
      preset_name: card.querySelector('[name="preset_name"]').value || "",
      subtitle_rule: {
        max_chars_per_line: Number(card.querySelector('[name="max_chars_per_line"]').value),
        max_lines: Number(card.querySelector('[name="max_lines"]').value),
        min_duration_sec: Number(card.querySelector('[name="min_duration_sec"]').value),
        max_duration_sec: Number(card.querySelector('[name="max_duration_sec"]').value),
      },
      base_layer: Number(card.querySelector('[name="base_layer"]').value),
      template_preview_meta: card._templatePreviewMeta || null,
      srt_file: await serializeCardFile(card, "srt"),
      template_exo: await serializeCardFile(card, "template"),
    });
  }
  return {
    schema_version: "0.2-local-project",
    project: Object.fromEntries(new FormData(document.querySelector("#v2ProjectForm")).entries()),
    speakers,
  };
}

function v2OutputName(extension) {
  const form = document.querySelector("#v2ProjectForm");
  const outputName = form.querySelector('[name="output_name"]').value || "output_v2";
  return `${outputName}.${extension}`;
}

function formatV2Error(error, fallbackMessage) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallbackMessage;
}

function renderV2Analysis() {
  v2AnalysisList.innerHTML = "";
  if (!v2State.analysis) {
    v2AnalysisSummary.textContent = "まだ検証していません。";
    return;
  }
  const warningCount = Number(v2State.analysis.warning_count || 0);
  v2AnalysisSummary.textContent = warningCount === 0 ? "警告はありません。" : `警告 ${warningCount} 件`;
  for (const item of v2State.analysis.warnings || []) {
    const li = document.createElement("li");
    li.textContent = item.message;
    v2AnalysisList.appendChild(li);
  }
}

function renderV2HtmlPreview() {
  if (!v2State.output.previewHtml) {
    v2PreviewFrame.srcdoc = "<!DOCTYPE html><html lang=\"ja\"><head><meta charset=\"UTF-8\"></head><body style=\"font-family: sans-serif; color: #74614f; padding: 24px;\">まだプレビューはありません。</body></html>";
    return;
  }
  v2PreviewFrame.srcdoc = v2State.output.previewHtml;
}

async function fetchJson(path, options) {
  const response = await fetch(`${V2_API_BASE}${path}`, options);
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error(`ERR-NONJSON-001: ${text}`);
  }
  if (!response.ok) {
    throw new Error(data.message || data.error || "Request failed");
  }
  return data;
}

function setBusy(button, busy) {
  button.disabled = busy;
}

function downloadText(filename, content) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  downloadBlob(filename, blob);
}

function downloadBase64(filename, contentB64, mimeType) {
  const byteCharacters = atob(contentB64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let index = 0; index < byteCharacters.length; index += 1) {
    byteNumbers[index] = byteCharacters.charCodeAt(index);
  }
  const blob = new Blob([new Uint8Array(byteNumbers)], { type: mimeType });
  downloadBlob(filename, blob);
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function resolveCardFile(card, kind) {
  const inputName = kind === "srt" ? "srt_file" : "template_exo";
  const input = card.querySelector(`[name="${inputName}"]`);
  const selectedFile = input.files[0];
  if (selectedFile) {
    return selectedFile;
  }
  const stored = kind === "srt" ? card._storedSrtFile : card._storedTemplateFile;
  if (!stored) {
    return null;
  }
  return new File([base64ToBytes(stored.content_b64)], stored.name, { type: stored.mime_type || "application/octet-stream" });
}

async function serializeCardFile(card, kind) {
  const file = await resolveCardFile(card, kind);
  if (!file) {
    throw new Error(kind === "srt" ? "SRT を指定してください。" : "テンプレート EXO を指定してください。");
  }
  const bytes = await file.arrayBuffer();
  return {
    name: file.name,
    mime_type: file.type || "application/octet-stream",
    content_b64: bytesToBase64(new Uint8Array(bytes)),
  };
}

function hydrateV2SpeakerCard(card, data) {
  card.querySelector('[name="display_name"]').value = data.display_name || "";
  card.querySelector('[name="preset_name"]').value = data.preset_name || "";
  card.querySelector('[name="max_chars_per_line"]').value = data.subtitle_rule?.max_chars_per_line ?? 18;
  card.querySelector('[name="max_lines"]').value = data.subtitle_rule?.max_lines ?? 2;
  card.querySelector('[name="min_duration_sec"]').value = data.subtitle_rule?.min_duration_sec ?? 0.8;
  card.querySelector('[name="max_duration_sec"]').value = data.subtitle_rule?.max_duration_sec ?? 4.0;
  card.querySelector('[name="base_layer"]').value = data.base_layer ?? 1;
  card.dataset.presetId = data.preset_id || "";
  card._storedSrtFile = data.srt_file || null;
  card._storedTemplateFile = data.template_exo || null;
  card._templatePreviewMeta = data.template_preview_meta || null;
  refreshCardSourceStatus(card);
}

function refreshCardSourceStatus(card, suffix = "") {
  const status = card.querySelector(".speaker-source-status");
  const srtInput = card.querySelector('[name="srt_file"]').files[0];
  const templateInput = card.querySelector('[name="template_exo"]').files[0];
  const srtLabel = srtInput ? srtInput.name : card._storedSrtFile?.name || "未設定";
  const templateLabel = templateInput ? templateInput.name : card._storedTemplateFile?.name || "未設定";
  const sourceMode = card._storedSrtFile || card._storedTemplateFile ? "保存済みデータあり" : "新規入力";
  const preview = card._templatePreviewMeta
    ? `\nfont: ${card._templatePreviewMeta.font || "-"} / size: ${card._templatePreviewMeta.size || "-"} / color: ${card._templatePreviewMeta.color || "-"} / layer: ${card._templatePreviewMeta.layer || "-"}`
    : "";
  status.textContent = `SRT: ${srtLabel}\nEXO: ${templateLabel}\n状態: ${sourceMode}${preview}${suffix ? `\n${suffix}` : ""}`;
}

async function refreshTemplatePreview(card) {
  const templateFile = await resolveCardFile(card, "template");
  if (!templateFile) {
    card._templatePreviewMeta = null;
    return;
  }
  const formData = new FormData();
  formData.append("template_exo", templateFile, templateFile.name);
  const response = await fetchJson("/api/v2/template-preview", {
    method: "POST",
    body: formData,
  });
  card._templatePreviewMeta = response.template_preview_meta || null;
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }
  return btoa(binary);
}

function base64ToBytes(contentB64) {
  const binary = atob(contentB64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
