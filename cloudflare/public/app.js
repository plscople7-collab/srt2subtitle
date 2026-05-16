const state = {
  speakers: [],
  segments: [],
  analysis: null,
  output: {
    exoContent: "",
    srtContent: "",
    jsonContent: "",
    previewHtml: "",
  },
};

const speakerList = document.querySelector("#speakerList");
const speakerTemplate = document.querySelector("#speakerTemplate");
const projectStatus = document.querySelector("#projectStatus");
const generationStatus = document.querySelector("#generationStatus");
const convertButton = document.querySelector("#convertButton");
const saveBundleButton = document.querySelector("#saveBundleButton");
const loadBundleButton = document.querySelector("#loadBundleButton");
const bundleFileInput = document.querySelector("#bundleFileInput");
const downloadExoButton = document.querySelector("#downloadExoButton");
const downloadSrtButton = document.querySelector("#downloadSrtButton");
const downloadJsonButton = document.querySelector("#downloadJsonButton");
const downloadPreviewButton = document.querySelector("#downloadPreviewButton");
const analysisSummary = document.querySelector("#analysisSummary");
const analysisList = document.querySelector("#analysisList");
const previewFrame = document.querySelector("#previewFrame");
const segmentTableBody = document.querySelector("#segmentTableBody");
const speakerFilter = document.querySelector("#speakerFilter");

document.querySelector("#addSpeakerButton").addEventListener("click", () => addSpeakerCard());
convertButton.addEventListener("click", convertProject);
saveBundleButton.addEventListener("click", saveProjectBundle);
loadBundleButton.addEventListener("click", () => bundleFileInput.click());
bundleFileInput.addEventListener("change", loadProjectBundle);
speakerFilter.addEventListener("change", renderSegments);
downloadExoButton.addEventListener("click", () => downloadText(outputName("exo"), state.output.exoContent));
downloadSrtButton.addEventListener("click", () => downloadText(outputName("srt"), state.output.srtContent));
downloadJsonButton.addEventListener("click", () => downloadText(outputName("json"), state.output.jsonContent));
downloadPreviewButton.addEventListener("click", () => downloadText(outputName("preview.html"), state.output.previewHtml));

addSpeakerCard();
renderAnalysis();
renderPreview();

function addSpeakerCard(initialData = null) {
  const fragment = speakerTemplate.content.cloneNode(true);
  const card = fragment.querySelector(".speaker-card");
  card.querySelector(".remove-speaker").addEventListener("click", () => {
    card.remove();
    if (!speakerList.children.length) addSpeakerCard();
  });
  card.querySelector('[name="srt_file"]').addEventListener("change", () => refreshCardStatus(card));
  card.querySelector('[name="template_exo"]').addEventListener("change", async () => {
    await refreshTemplatePreview(card);
    refreshCardStatus(card);
  });
  if (initialData) hydrateSpeakerCard(card, initialData);
  refreshCardStatus(card);
  speakerList.appendChild(fragment);
}

async function convertProject() {
  try {
    setBusy(convertButton, true);
    generationStatus.textContent = "変換しています...";
    const project = readProjectForm();
    const speakers = await Promise.all([...speakerList.querySelectorAll(".speaker-card")].map(buildSpeakerPayload));
    if (speakers.length === 0) {
      throw new Error("話者を1件以上指定してください。");
    }
    const response = await fetchJson("/api/v2/convert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project, speakers }),
    });
    state.segments = response.segments || [];
    state.analysis = response.analysis || null;
    state.output.exoContent = response.exo_content || "";
    state.output.srtContent = response.srt_content || "";
    state.output.jsonContent = response.json_content || "";
    state.output.previewHtml = response.preview_html || "";
    state.speakers = (response.project?.speakers || []).map((speaker) => ({
      speaker_id: speaker.speaker_id,
      display_name: speaker.display_name,
    }));
    generationStatus.textContent = `${state.segments.length} 件の字幕を生成しました。`;
    projectStatus.textContent = `変換済み: ${project.name}`;
    setDownloadDisabled(false);
    rebuildSpeakerFilter();
    renderSegments();
    renderAnalysis();
    renderPreview();
  } catch (error) {
    generationStatus.textContent = formatError(error, "変換に失敗しました。");
    setDownloadDisabled(true);
  } finally {
    setBusy(convertButton, false);
  }
}

async function saveProjectBundle() {
  try {
    setBusy(saveBundleButton, true);
    const project = readProjectForm();
    const speakers = await Promise.all([...speakerList.querySelectorAll(".speaker-card")].map(serializeSpeakerCard));
    const bundle = {
      schema_version: "0.2-cloudflare-local",
      project,
      speakers,
    };
    downloadText(`${project.output_name || "output_v2"}.project.json`, JSON.stringify(bundle, null, 2));
    projectStatus.textContent = `ローカル保存: ${project.name}`;
  } catch (error) {
    projectStatus.textContent = formatError(error, "ローカル保存に失敗しました。");
  } finally {
    setBusy(saveBundleButton, false);
  }
}

async function loadProjectBundle(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    setBusy(loadBundleButton, true);
    const payload = JSON.parse(await file.text());
    applyProjectBundle(payload);
    projectStatus.textContent = `読込済み: ${payload.project?.name || file.name}`;
  } catch (error) {
    projectStatus.textContent = formatError(error, "ローカル読込に失敗しました。");
  } finally {
    event.target.value = "";
    setBusy(loadBundleButton, false);
  }
}

async function buildSpeakerPayload(card) {
  const displayName = card.querySelector('[name="display_name"]').value.trim();
  if (!displayName) {
    throw new Error("話者名を入力してください。");
  }
  const srtFile = await resolveCardFile(card, "srt");
  const templateFile = await resolveCardFile(card, "template");
  if (!srtFile) {
    throw new Error(`${displayName} の SRT を指定してください。`);
  }
  if (!templateFile) {
    throw new Error(`${displayName} の見本 EXO を指定してください。`);
  }
  const [srtBase64, templateBase64] = await Promise.all([fileToBase64(srtFile), fileToBase64(templateFile)]);
  return {
    display_name: displayName,
    base_layer: Number(card.querySelector('[name="base_layer"]').value),
    subtitle_rule: readSubtitleRule(card),
    srt_name: srtFile.name,
    srt_content_b64: srtBase64,
    template_name: templateFile.name,
    template_content_b64: templateBase64,
  };
}

async function serializeSpeakerCard(card) {
  const displayName = card.querySelector('[name="display_name"]').value.trim();
  const srtFile = await resolveCardFile(card, "srt");
  const templateFile = await resolveCardFile(card, "template");
  if (!displayName && !srtFile && !templateFile) {
    return null;
  }
  if (!displayName || !srtFile || !templateFile) {
    throw new Error("ローカル保存するには各話者で話者名、SRT、見本 EXO が必要です。");
  }
  return {
    display_name: displayName,
    base_layer: Number(card.querySelector('[name="base_layer"]').value),
    subtitle_rule: readSubtitleRule(card),
    template_preview_meta: card._templatePreviewMeta || null,
    srt_file: {
      name: srtFile.name,
      mime_type: srtFile.type || "application/octet-stream",
      content_b64: await fileToBase64(srtFile),
    },
    template_exo: {
      name: templateFile.name,
      mime_type: templateFile.type || "application/octet-stream",
      content_b64: await fileToBase64(templateFile),
    },
  };
}

function applyProjectBundle(payload) {
  const form = document.querySelector("#projectForm");
  for (const [key, value] of Object.entries(payload.project || {})) {
    const input = form.querySelector(`[name="${key}"]`);
    if (input) input.value = value;
  }
  speakerList.innerHTML = "";
  const speakers = (payload.speakers || []).filter(Boolean);
  for (const speaker of speakers) {
    addSpeakerCard(speaker);
  }
  if (speakers.length === 0) {
    addSpeakerCard();
  }
  state.speakers = [];
  state.segments = [];
  state.analysis = null;
  state.output = { exoContent: "", srtContent: "", jsonContent: "", previewHtml: "" };
  setDownloadDisabled(true);
  rebuildSpeakerFilter();
  renderSegments();
  renderAnalysis();
  renderPreview();
}

function hydrateSpeakerCard(card, data) {
  card.querySelector('[name="display_name"]').value = data.display_name || "";
  card.querySelector('[name="max_chars_per_line"]').value = data.subtitle_rule?.max_chars_per_line ?? 18;
  card.querySelector('[name="max_lines"]').value = data.subtitle_rule?.max_lines ?? 2;
  card.querySelector('[name="min_duration_sec"]').value = data.subtitle_rule?.min_duration_sec ?? 0.8;
  card.querySelector('[name="max_duration_sec"]').value = data.subtitle_rule?.max_duration_sec ?? 4.0;
  card.querySelector('[name="base_layer"]').value = data.base_layer ?? 1;
  card._storedSrtFile = data.srt_file || null;
  card._storedTemplateFile = data.template_exo || null;
  card._templatePreviewMeta = data.template_preview_meta || null;
}

function readProjectForm() {
  const form = document.querySelector("#projectForm");
  const payload = Object.fromEntries(new FormData(form).entries());
  return {
    name: String(payload.name || "srt_project"),
    fps: Number(payload.fps || 60),
    width: Number(payload.width || 1920),
    height: Number(payload.height || 1080),
    output_name: String(payload.output_name || "output_v2"),
  };
}

function readSubtitleRule(card) {
  return {
    max_chars_per_line: Number(card.querySelector('[name="max_chars_per_line"]').value),
    max_lines: Number(card.querySelector('[name="max_lines"]').value),
    min_duration_sec: Number(card.querySelector('[name="min_duration_sec"]').value),
    max_duration_sec: Number(card.querySelector('[name="max_duration_sec"]').value),
  };
}

function renderSegments() {
  segmentTableBody.innerHTML = "";
  const filterValue = speakerFilter.value;
  const rows = state.segments.filter((segment) => !filterValue || segment.speaker_id === filterValue);
  for (const segment of rows) {
    const speaker = state.speakers.find((item) => item.speaker_id === segment.speaker_id);
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(speaker ? speaker.display_name : segment.speaker_id)}</td>
      <td>${Number(segment.start_sec).toFixed(2)}</td>
      <td>${Number(segment.end_sec).toFixed(2)}</td>
      <td>${escapeHtml(segment.text).replaceAll("\n", "<br>")}</td>
      <td>${escapeHtml((segment.warnings || []).join(", "))}</td>
    `;
    segmentTableBody.appendChild(row);
  }
}

function rebuildSpeakerFilter() {
  speakerFilter.innerHTML = '<option value="">全話者</option>';
  for (const speaker of state.speakers) {
    const option = document.createElement("option");
    option.value = speaker.speaker_id;
    option.textContent = speaker.display_name;
    speakerFilter.appendChild(option);
  }
}

function renderAnalysis() {
  analysisList.innerHTML = "";
  if (!state.analysis) {
    analysisSummary.textContent = "まだ変換していません。";
    return;
  }
  const warningCount = Number(state.analysis.warning_count || 0);
  analysisSummary.textContent = warningCount === 0 ? "警告はありません。" : `警告 ${warningCount} 件`;
  for (const item of state.analysis.warnings || []) {
    const li = document.createElement("li");
    li.textContent = item.message;
    analysisList.appendChild(li);
  }
}

function renderPreview() {
  if (!state.output.previewHtml) {
    previewFrame.srcdoc = '<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"></head><body style="font-family: sans-serif; color: #74614f; padding: 24px;">まだプレビューはありません。</body></html>';
    return;
  }
  previewFrame.srcdoc = state.output.previewHtml;
}

function refreshCardStatus(card, suffix = "") {
  const status = card.querySelector(".speaker-source-status");
  const srtInput = card.querySelector('[name="srt_file"]').files[0];
  const templateInput = card.querySelector('[name="template_exo"]').files[0];
  const srtLabel = srtInput ? srtInput.name : card._storedSrtFile?.name || "未選択";
  const templateLabel = templateInput ? templateInput.name : card._storedTemplateFile?.name || "未選択";
  const preview = card._templatePreviewMeta
    ? `\nfont: ${card._templatePreviewMeta.font || "-"} / size: ${card._templatePreviewMeta.size || "-"} / color: ${card._templatePreviewMeta.color || "-"} / layer: ${card._templatePreviewMeta.layer || "-"}`
    : "";
  status.textContent = `SRT: ${srtLabel}\nEXO: ${templateLabel}${preview}${suffix ? `\n${suffix}` : ""}`;
}

async function refreshTemplatePreview(card) {
  const templateFile = await resolveCardFile(card, "template");
  if (!templateFile) {
    card._templatePreviewMeta = null;
    return;
  }
  const response = await fetchJson("/api/v2/template-preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      template_name: templateFile.name,
      template_content_b64: await fileToBase64(templateFile),
    }),
  });
  card._templatePreviewMeta = response.template_preview_meta || null;
}

async function resolveCardFile(card, kind) {
  const inputName = kind === "srt" ? "srt_file" : "template_exo";
  const selected = card.querySelector(`[name="${inputName}"]`).files[0];
  if (selected) return selected;
  const stored = kind === "srt" ? card._storedSrtFile : card._storedTemplateFile;
  if (!stored) return null;
  return new File([base64ToBytes(stored.content_b64)], stored.name, { type: stored.mime_type || "application/octet-stream" });
}

async function fetchJson(path, options) {
  const response = await fetch(path, options);
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
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

function setDownloadDisabled(disabled) {
  downloadExoButton.disabled = disabled;
  downloadSrtButton.disabled = disabled;
  downloadJsonButton.disabled = disabled;
  downloadPreviewButton.disabled = disabled;
}

function downloadText(filename, content) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function fileToBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
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

function outputName(extension) {
  const project = readProjectForm();
  return `${project.output_name}.${extension}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatError(error, fallbackMessage) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallbackMessage;
}
