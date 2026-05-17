const state = {
  presets: [],
  segments: [],
  speakers: [],
  output: {
    exoContentB64: "",
    srtContent: "",
    jsonContent: "",
  },
  activeSpeakerCard: null,
};

const speakerList = document.querySelector("#speakerList");
const speakerTemplate = document.querySelector("#speakerTemplate");
const runAllButton = document.querySelector("#runAllButton");
const addSpeakerButton = document.querySelector("#addSpeakerButton");
const reloadPresetsButton = document.querySelector("#reloadPresetsButton");
const saveActivePresetButton = document.querySelector("#saveActivePresetButton");
const setupStatus = document.querySelector("#setupStatus");
const presetStatus = document.querySelector("#presetStatus");
const presetTableBody = document.querySelector("#presetTableBody");
const progressList = document.querySelector("#progressList");
const analysisSummary = document.querySelector("#analysisSummary");
const analysisList = document.querySelector("#analysisList");
const segmentTableBody = document.querySelector("#segmentTableBody");
const downloadExoButton = document.querySelector("#downloadExoButton");
const downloadSrtButton = document.querySelector("#downloadSrtButton");
const downloadJsonButton = document.querySelector("#downloadJsonButton");
const modelInput = document.querySelector("#modelInput");
const languageInput = document.querySelector("#languageInput");

addSpeakerButton.addEventListener("click", () => addSpeakerCard());
reloadPresetsButton.addEventListener("click", () => void loadPresets(true));
saveActivePresetButton.addEventListener("click", () => void savePresetFromActiveSpeaker());
runAllButton.addEventListener("click", () => void runIntegratedExport());
downloadExoButton.addEventListener("click", () => downloadBase64(outputName("exo"), state.output.exoContentB64, "application/octet-stream"));
downloadSrtButton.addEventListener("click", () => downloadText(outputName("srt"), state.output.srtContent));
downloadJsonButton.addEventListener("click", () => downloadText(outputName("json"), state.output.jsonContent));

addSpeakerCard();
renderPresetTable();
renderSegments();
renderAnalysis(null);
void loadPresets(false);

function addSpeakerCard(initialData = null) {
  const fragment = speakerTemplate.content.cloneNode(true);
  const card = fragment.querySelector(".speaker-card");
  const presetSelect = card.querySelector('[name="preset_select"]');
  const pickButtons = card.querySelectorAll(".pick-file");

  card.querySelector(".save-preset").addEventListener("click", () => void savePresetFromCard(card));
  card.querySelector(".remove-speaker").addEventListener("click", () => {
    if (state.activeSpeakerCard === card) state.activeSpeakerCard = null;
    card.remove();
    if (!speakerList.children.length) addSpeakerCard();
    normalizeSpeakerLayers();
  });
  card.addEventListener("click", () => setActiveSpeakerCard(card));
  presetSelect.addEventListener("change", () => applySelectedPresetFromCard(card));
  card.querySelector('[name="base_layer"]').addEventListener("change", normalizeSpeakerLayers);
  for (const input of card.querySelectorAll('input[type="file"]')) {
    input.addEventListener("change", () => refreshCardStatus(card));
  }
  for (const button of pickButtons) {
    button.addEventListener("click", () => {
      const kind = button.dataset.kind;
      const inputName = kind === "media" ? "media_file" : kind === "srt" ? "srt_file" : "template_exo";
      card.querySelector(`[name="${inputName}"]`).click();
    });
  }
  for (const kind of ["media", "srt", "template"]) bindDropField(card, kind);

  if (initialData) hydrateSpeakerCard(card, initialData);
  else card.querySelector('[name="base_layer"]').value = String(nextSuggestedLayer());
  renderPresetSelectOptions(card);
  refreshCardStatus(card);
  speakerList.appendChild(fragment);
  if (!state.activeSpeakerCard) setActiveSpeakerCard(card);
  normalizeSpeakerLayers();
}

async function runIntegratedExport() {
  try {
    setBusy(true);
    setDownloadDisabled(true);
    state.segments = [];
    state.speakers = [];
    state.output = { exoContentB64: "", srtContent: "", jsonContent: "" };
    renderSegments();
    renderAnalysis(null);
    progressList.innerHTML = "";
    setupStatus.textContent = "処理中";
    normalizeSpeakerLayers();

    const project = readProjectForm();
    const cards = [...speakerList.querySelectorAll(".speaker-card")];
    if (!cards.length) throw new Error("話者を1人以上追加してください。");

    const speakerPayloads = [];
    for (const [index, card] of cards.entries()) {
      const speaker = await prepareSpeaker(card, index + 1);
      speakerPayloads.push(speaker);
    }

    updateProgress("EXO", "変換中", "progress-ok");
    const response = await fetchJson("/api/v2/convert", {
      method: "POST",
      body: buildConvertFormData(project, speakerPayloads),
    });

    state.segments = response.segments || [];
    state.speakers = (response.project?.speakers || []).map((speaker) => ({
      speaker_id: speaker.speaker_id,
      display_name: speaker.display_name,
    }));
    state.output.exoContentB64 = response.exo_content_b64 || "";
    state.output.srtContent = response.srt_content || "";
    state.output.jsonContent = response.json_content || "";
    renderSegments();
    renderAnalysis(response.analysis || null);
    setDownloadDisabled(false);

    downloadBase64(outputName("exo"), state.output.exoContentB64, "application/octet-stream");
    setupStatus.textContent = `${state.segments.length} 件生成、EXO保存`;
    updateProgress("EXO", "保存開始", "progress-ok");
  } catch (error) {
    setupStatus.textContent = formatError(error, "統合出力に失敗しました。");
    updateProgress("エラー", setupStatus.textContent, "progress-error");
    setDownloadDisabled(true);
  } finally {
    setBusy(false);
  }
}

async function prepareSpeaker(card, index) {
  const displayName = card.querySelector('[name="display_name"]').value.trim() || `話者${index}`;
  const mediaFile = card.querySelector('[name="media_file"]').files[0];
  let srtFile = await resolveCardFile(card, "srt");
  const templateFile = await resolveCardFile(card, "template");
  if (!templateFile) throw new Error(`${displayName} の見本EXOまたはプリセットを指定してください。`);

  if (!srtFile) {
    if (!mediaFile) throw new Error(`${displayName} の音声/動画またはSRTを指定してください。`);
    updateProgress(displayName, "文字起こし中", "progress-ok");
    const formData = new FormData();
    formData.append("engine", "whisper");
    formData.append("model", modelInput.value);
    formData.append("language", languageInput.value.trim() || "ja");
    formData.append("media_file", mediaFile, mediaFile.name);
    const response = await fetchJson("/api/transcriber/transcribe", { method: "POST", body: formData });
    const output = response.outputs?.[0];
    if (!output) throw new Error(`${displayName} のSRT生成結果が空です。`);
    srtFile = new File([output.srt_content || ""], output.srt_name || `${displayName}.srt`, {
      type: "text/plain;charset=utf-8",
    });
    card._generatedSrtFile = {
      name: srtFile.name,
      content_b64: await fileToBase64(srtFile),
      mime_type: "text/plain;charset=utf-8",
    };
    refreshCardStatus(card, output.cached ? "SRT生成: キャッシュ" : "SRT生成: 新規");
    updateProgress(displayName, `${output.segment_count || 0} 字幕`, "progress-ok");
  } else {
    updateProgress(displayName, "既存SRT使用", "progress-ok");
  }

  return {
    display_name: displayName,
    base_layer: Number(card.querySelector('[name="base_layer"]').value),
    subtitle_rule: readSubtitleRule(card),
    srtFile,
    templateFile,
  };
}

function buildConvertFormData(project, speakers) {
  const formData = new FormData();
  formData.append("project_json", JSON.stringify(project));
  formData.append("speaker_count", String(speakers.length));
  for (const [index, speaker] of speakers.entries()) {
    formData.append(`speaker_${index}_display_name`, speaker.display_name);
    formData.append(`speaker_${index}_subtitle_rule_json`, JSON.stringify(speaker.subtitle_rule));
    formData.append(`speaker_${index}_base_layer`, String(speaker.base_layer));
    formData.append(`speaker_${index}_srt_file`, speaker.srtFile, speaker.srtFile.name);
    formData.append(`speaker_${index}_template_exo`, speaker.templateFile, speaker.templateFile.name);
  }
  return formData;
}

async function loadPresets(showStatus) {
  try {
    const response = await fetchJson("/api/v2/presets", { method: "GET" });
    state.presets = response.presets || [];
    for (const card of speakerList.querySelectorAll(".speaker-card")) renderPresetSelectOptions(card);
    renderPresetTable();
    presetStatus.textContent = `${state.presets.length} 件`;
    if (showStatus) setupStatus.textContent = "プリセット再読込済み";
  } catch (error) {
    presetStatus.textContent = formatError(error, "プリセット読込失敗");
  }
}

async function savePresetFromActiveSpeaker() {
  if (!state.activeSpeakerCard) {
    presetStatus.textContent = "先に保存元の話者を選択してください。";
    return;
  }
  await savePresetFromCard(state.activeSpeakerCard);
}

async function savePresetFromCard(card) {
  try {
    setActiveSpeakerCard(card);
    const displayName = card.querySelector('[name="display_name"]').value.trim();
    if (!displayName) throw new Error("プリセット保存前に話者名を入力してください。");
    const templateFile = await resolveCardFile(card, "template");
    if (!templateFile) throw new Error("プリセット保存前に見本EXOを選択してください。");
    const existing = state.presets.find((preset) => preset.name === displayName);
    const payload = {
      preset_id: existing?.preset_id || card.dataset.presetId || "",
      name: displayName,
      subtitle_rule: readSubtitleRule(card),
      base_layer: Number(card.querySelector('[name="base_layer"]').value),
      template_exo: await serializeFile(templateFile),
    };
    const response = await fetchJson("/api/v2/presets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    card.dataset.presetId = response.preset_id;
    card._storedTemplateFile = response.template_exo;
    card._templatePreviewMeta = response.template_preview_meta || null;
    await loadPresets(false);
    renderPresetSelectOptions(card);
    card.querySelector('[name="preset_select"]').value = response.preset_id;
    refreshCardStatus(card, "プリセット保存");
    presetStatus.textContent = `保存しました: ${displayName}`;
  } catch (error) {
    presetStatus.textContent = formatError(error, "プリセット保存に失敗しました。");
  }
}

function applySelectedPresetFromCard(card) {
  const presetId = card.querySelector('[name="preset_select"]').value;
  if (!presetId) {
    card.dataset.presetId = "";
    card._storedTemplateFile = null;
    card._templatePreviewMeta = null;
    refreshCardStatus(card, "プリセット解除");
    return;
  }
  const preset = state.presets.find((item) => item.preset_id === presetId);
  if (!preset) return;
  applyPresetToCard(card, preset);
}

function applyPresetToCard(card, preset) {
  card.dataset.presetId = preset.preset_id || "";
  card.querySelector('[name="display_name"]').value = preset.name || "";
  card.querySelector('[name="max_chars_per_line"]').value = preset.subtitle_rule?.max_chars_per_line ?? 18;
  card.querySelector('[name="max_lines"]').value = preset.subtitle_rule?.max_lines ?? 2;
  card.querySelector('[name="min_duration_sec"]').value = preset.subtitle_rule?.min_duration_sec ?? 0.8;
  card.querySelector('[name="max_duration_sec"]').value = preset.subtitle_rule?.max_duration_sec ?? 4.0;
  card.querySelector('[name="base_layer"]').value = preset.base_layer ?? nextSuggestedLayer();
  card.querySelector('[name="preset_select"]').value = preset.preset_id || "";
  card._storedTemplateFile = preset.template_exo || null;
  card._templatePreviewMeta = preset.template_preview_meta || null;
  normalizeSpeakerLayers();
  refreshCardStatus(card, "プリセット適用");
}

function renderPresetSelectOptions(card) {
  const select = card.querySelector('[name="preset_select"]');
  const current = card.dataset.presetId || select.value || "";
  select.innerHTML = '<option value="">未選択</option>';
  for (const preset of state.presets) {
    const option = document.createElement("option");
    option.value = preset.preset_id;
    option.textContent = preset.name || preset.preset_id;
    select.appendChild(option);
  }
  select.value = current;
}

function renderPresetTable() {
  presetTableBody.innerHTML = "";
  if (state.presets.length === 0) {
    presetStatus.textContent = "プリセットなし";
    return;
  }
  for (const preset of state.presets) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td><input data-field="name" value="${escapeAttribute(preset.name || "")}"></td>
      <td><input data-field="base_layer" type="number" min="1" value="${Number(preset.base_layer || 1)}"></td>
      <td><input data-field="max_chars_per_line" type="number" min="1" max="80" value="${Number(preset.subtitle_rule?.max_chars_per_line || 18)}"></td>
      <td><input data-field="max_lines" type="number" min="1" max="4" value="${Number(preset.subtitle_rule?.max_lines || 2)}"></td>
      <td><input data-field="min_duration_sec" type="number" min="0.1" step="0.1" value="${Number(preset.subtitle_rule?.min_duration_sec || 0.8)}"></td>
      <td><input data-field="max_duration_sec" type="number" min="0.1" max="10" step="0.1" value="${Number(preset.subtitle_rule?.max_duration_sec || 4.0)}"></td>
      <td>${escapeHtml(preset.template_exo?.name || "-")}</td>
      <td>${escapeHtml(formatDateTime(preset.updated_at || ""))}</td>
      <td class="row-actions"></td>
    `;
    const actions = row.querySelector(".row-actions");
    actions.appendChild(makeRowButton("適用", () => applyPresetRow(preset.preset_id)));
    actions.appendChild(makeRowButton("保存", () => void savePresetRow(row, preset.preset_id)));
    actions.appendChild(makeRowButton("削除", () => void deletePresetRow(preset.preset_id), "ghost danger"));
    presetTableBody.appendChild(row);
  }
}

function makeRowButton(label, handler, className = "ghost") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", handler);
  return button;
}

function applyPresetRow(presetId) {
  if (!state.activeSpeakerCard) {
    presetStatus.textContent = "先に適用先の話者を選択してください。";
    return;
  }
  const preset = state.presets.find((item) => item.preset_id === presetId);
  if (!preset) return;
  applyPresetToCard(state.activeSpeakerCard, preset);
  presetStatus.textContent = `適用しました: ${preset.name}`;
}

async function savePresetRow(row, presetId) {
  try {
    const preset = state.presets.find((item) => item.preset_id === presetId);
    if (!preset) return;
    const payload = {
      preset_id: presetId,
      name: row.querySelector('[data-field="name"]').value.trim() || "preset",
      base_layer: Number(row.querySelector('[data-field="base_layer"]').value || 1),
      subtitle_rule: {
        max_chars_per_line: Number(row.querySelector('[data-field="max_chars_per_line"]').value || 18),
        max_lines: Number(row.querySelector('[data-field="max_lines"]').value || 2),
        min_duration_sec: Number(row.querySelector('[data-field="min_duration_sec"]').value || 0.8),
        max_duration_sec: Number(row.querySelector('[data-field="max_duration_sec"]').value || 4.0),
      },
      template_exo: preset.template_exo,
    };
    await fetchJson("/api/v2/presets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    await loadPresets(false);
    presetStatus.textContent = `保存しました: ${payload.name}`;
  } catch (error) {
    presetStatus.textContent = formatError(error, "プリセット保存に失敗しました。");
  }
}

async function deletePresetRow(presetId) {
  try {
    await fetchJson("/api/v2/presets/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preset_id: presetId }),
    });
    for (const card of speakerList.querySelectorAll(".speaker-card")) {
      if (card.dataset.presetId !== presetId) continue;
      card.dataset.presetId = "";
      card.querySelector('[name="preset_select"]').value = "";
      card._storedTemplateFile = null;
      card._templatePreviewMeta = null;
      refreshCardStatus(card, "削除済みプリセットを解除");
    }
    await loadPresets(false);
    presetStatus.textContent = "プリセットを削除しました。";
  } catch (error) {
    presetStatus.textContent = formatError(error, "プリセット削除に失敗しました。");
  }
}

function renderSegments() {
  segmentTableBody.innerHTML = "";
  for (const segment of state.segments) {
    const speaker = state.speakers.find((item) => item.speaker_id === segment.speaker_id);
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(speaker ? speaker.display_name : segment.speaker_id)}</td>
      <td>${Number(segment.start_sec).toFixed(2)}</td>
      <td>${Number(segment.end_sec).toFixed(2)}</td>
      <td>${Number(segment.base_layer || 1)}</td>
      <td>${escapeHtml(segment.text).replaceAll("\n", "<br>")}</td>
      <td>${escapeHtml((segment.warnings || []).join(", "))}</td>
    `;
    segmentTableBody.appendChild(row);
  }
}

function renderAnalysis(analysis) {
  analysisList.innerHTML = "";
  if (!analysis) {
    analysisSummary.textContent = "未変換";
    return;
  }
  const warningCount = Number(analysis.warning_count || 0);
  analysisSummary.textContent = warningCount === 0 ? "警告なし" : `${warningCount} 件の警告`;
  for (const item of analysis.warnings || []) {
    const li = document.createElement("li");
    li.textContent = item.message;
    analysisList.appendChild(li);
  }
}

function bindDropField(card, kind) {
  const field = card.querySelector(`.drop-field[data-kind="${kind}"]`);
  const inputName = kind === "media" ? "media_file" : kind === "srt" ? "srt_file" : "template_exo";
  const input = card.querySelector(`[name="${inputName}"]`);
  for (const eventName of ["dragenter", "dragover"]) {
    field.addEventListener(eventName, (event) => {
      event.preventDefault();
      field.classList.add("drag-over");
    });
  }
  for (const eventName of ["dragleave", "dragend", "drop"]) {
    field.addEventListener(eventName, (event) => {
      event.preventDefault();
      field.classList.remove("drag-over");
    });
  }
  field.addEventListener("drop", (event) => {
    const file = [...(event.dataTransfer?.files || [])][0];
    if (!file || !isAllowedFile(kind, file.name)) return;
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    refreshCardStatus(card);
  });
}

function isAllowedFile(kind, filename) {
  const lower = filename.toLowerCase();
  if (kind === "srt") return lower.endsWith(".srt");
  if (kind === "template") return lower.endsWith(".exo");
  return [".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg", ".opus", ".wma", ".webm", ".mp4", ".mov", ".mkv"].some((suffix) =>
    lower.endsWith(suffix)
  );
}

async function resolveCardFile(card, kind) {
  const inputName = kind === "srt" ? "srt_file" : "template_exo";
  const selected = card.querySelector(`[name="${inputName}"]`).files[0];
  if (selected) return selected;
  if (kind === "srt" && card._generatedSrtFile) return fileFromStored(card._generatedSrtFile, "text/plain;charset=utf-8");
  const stored = kind === "srt" ? null : card._storedTemplateFile;
  if (!stored) return null;
  return fileFromStored(stored, stored.mime_type || "application/octet-stream");
}

function fileFromStored(stored, fallbackType) {
  return new File([base64ToBytes(stored.content_b64)], stored.name, {
    type: stored.mime_type || fallbackType,
  });
}

function refreshCardStatus(card, suffix = "") {
  const media = card.querySelector('[name="media_file"]').files[0]?.name || "-";
  const srt = card.querySelector('[name="srt_file"]').files[0]?.name || card._generatedSrtFile?.name || "-";
  const template = card.querySelector('[name="template_exo"]').files[0]?.name || card._storedTemplateFile?.name || "-";
  card.querySelector('[data-file-label="media"]').textContent = media;
  card.querySelector('[data-file-label="srt"]').textContent = srt;
  card.querySelector('[data-file-label="template"]').textContent = template;
  card.querySelector(".source-status").textContent = `音声: ${media} / SRT: ${srt} / EXO: ${template}${suffix ? ` / ${suffix}` : ""}`;
}

function readProjectForm() {
  const payload = Object.fromEntries(new FormData(document.querySelector("#projectForm")).entries());
  return {
    name: String(payload.name || "audio_exo_project"),
    fps: Number(payload.fps || 60),
    width: Number(payload.width || 1920),
    height: Number(payload.height || 1080),
    output_name: String(payload.output_name || "output_studio"),
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

function normalizeSpeakerLayers() {
  const used = new Set();
  for (const card of speakerList.querySelectorAll(".speaker-card")) {
    const input = card.querySelector('[name="base_layer"]');
    let value = Number.parseInt(input.value, 10);
    if (!Number.isFinite(value) || value < 1) value = 1;
    while (used.has(value)) value += 1;
    used.add(value);
    input.value = String(value);
  }
}

function nextSuggestedLayer() {
  const values = [...speakerList.querySelectorAll('.speaker-card [name="base_layer"]')]
    .map((input) => Number.parseInt(input.value, 10))
    .filter((value) => Number.isFinite(value) && value >= 1);
  return values.length === 0 ? 1 : Math.max(...values) + 1;
}

function setActiveSpeakerCard(card) {
  for (const item of speakerList.querySelectorAll(".speaker-card")) {
    item.classList.toggle("active", item === card);
  }
  state.activeSpeakerCard = card;
}

function updateProgress(label, message, className = "") {
  const item = document.createElement("div");
  item.className = `progress-item ${className}`.trim();
  item.innerHTML = `<strong>${escapeHtml(label)}</strong><span>${escapeHtml(message)}</span>`;
  progressList.appendChild(item);
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
  if (!response.ok) throw new Error(data.message || data.error || "リクエストに失敗しました。");
  return data;
}

function setBusy(busy) {
  runAllButton.disabled = busy;
}

function setDownloadDisabled(disabled) {
  downloadExoButton.disabled = disabled;
  downloadSrtButton.disabled = disabled;
  downloadJsonButton.disabled = disabled;
}

function downloadText(filename, content) {
  downloadBlob(filename, new Blob([content || ""], { type: "text/plain;charset=utf-8" }));
}

function downloadBase64(filename, contentB64, mimeType) {
  downloadBlob(filename, new Blob([base64ToBytes(contentB64)], { type: mimeType }));
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

async function fileToBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary);
}

async function serializeFile(file) {
  return {
    name: file.name,
    mime_type: file.type || "application/octet-stream",
    content_b64: await fileToBase64(file),
  };
}

function base64ToBytes(contentB64) {
  const binary = atob(contentB64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function outputName(extension) {
  return `${readProjectForm().output_name}.${extension}`;
}

function formatDateTime(value) {
  if (!value) return "-";
  return value.replace("T", " ").replace("Z", "");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function formatError(error, fallbackMessage) {
  if (error instanceof Error && error.message) return error.message;
  return fallbackMessage;
}
