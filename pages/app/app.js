// Mirror of frontend/v2.js for GitHub Pages static share
const state = {
  apiBase: loadApiBase(),
  presets: [],
  speakers: [],
  segments: [],
  analysis: null,
  activeSpeakerCard: null,
  output: {
    exoContentB64: "",
    srtContent: "",
    jsonContent: "",
  },
};

const speakerList = document.querySelector("#speakerList");
const speakerTemplate = document.querySelector("#speakerTemplate");
const projectStatus = document.querySelector("#projectStatus");
const generationStatus = document.querySelector("#generationStatus");
const presetStatus = document.querySelector("#presetStatus");
const activeSpeakerLabel = document.querySelector("#activeSpeakerLabel");
const convertButton = document.querySelector("#convertButton");
const saveBundleButton = document.querySelector("#saveBundleButton");
const loadBundleButton = document.querySelector("#loadBundleButton");
const bundleFileInput = document.querySelector("#bundleFileInput");
const reloadPresetsButton = document.querySelector("#reloadPresetsButton");
const downloadExoButton = document.querySelector("#downloadExoButton");
const downloadSrtButton = document.querySelector("#downloadSrtButton");
const downloadJsonButton = document.querySelector("#downloadJsonButton");
const analysisSummary = document.querySelector("#analysisSummary");
const analysisList = document.querySelector("#analysisList");
const segmentTableBody = document.querySelector("#segmentTableBody");
const presetTableBody = document.querySelector("#presetTableBody");
const speakerFilter = document.querySelector("#speakerFilter");
const apiBaseInput = document.querySelector("#apiBaseInput");
const apiStatus = document.querySelector("#apiStatus");
const saveApiBaseButton = document.querySelector("#saveApiBaseButton");
const checkApiButton = document.querySelector("#checkApiButton");

document.querySelector("#addSpeakerButton").addEventListener("click", () => addSpeakerCard());
convertButton.addEventListener("click", () => void convertProject());
saveBundleButton.addEventListener("click", () => void saveProjectBundle());
loadBundleButton.addEventListener("click", () => bundleFileInput.click());
bundleFileInput.addEventListener("change", (event) => void loadProjectBundle(event));
reloadPresetsButton.addEventListener("click", () => void loadPresets(true));
speakerFilter.addEventListener("change", renderSegments);
saveApiBaseButton.addEventListener("click", saveApiBase);
checkApiButton.addEventListener("click", () => void checkApiHealth());
downloadExoButton.addEventListener("click", () => downloadBase64(outputName("exo"), state.output.exoContentB64, "application/octet-stream"));
downloadSrtButton.addEventListener("click", () => downloadText(outputName("srt"), state.output.srtContent));
downloadJsonButton.addEventListener("click", () => downloadText(outputName("json"), state.output.jsonContent));

apiBaseInput.value = state.apiBase;
addSpeakerCard();
renderAnalysis();
renderSegments();
renderPresetTable();
updateActiveSpeakerLabel();
void checkApiHealth();
void loadPresets(false);

function addSpeakerCard(initialData = null) {
  const fragment = speakerTemplate.content.cloneNode(true);
  const card = fragment.querySelector(".speaker-card");
  const displayNameInput = card.querySelector('[name="display_name"]');
  const baseLayerInput = card.querySelector('[name="base_layer"]');
  const presetSelect = card.querySelector('[name="preset_select"]');
  const srtInput = card.querySelector('[name="srt_file"]');
  const templateInput = card.querySelector('[name="template_exo"]');
  const pickButtons = card.querySelectorAll(".pick-file");
  card.querySelector(".remove-speaker").addEventListener("click", () => {
    if (state.activeSpeakerCard === card) state.activeSpeakerCard = null;
    card.remove();
    normalizeSpeakerLayers();
    if (!speakerList.children.length) addSpeakerCard();
    if (!state.activeSpeakerCard && speakerList.firstElementChild) setActiveSpeakerCard(speakerList.firstElementChild);
    else updateActiveSpeakerLabel();
  });
  card.addEventListener("click", () => setActiveSpeakerCard(card));
  card.querySelector(".save-preset").addEventListener("click", () => void savePresetFromCard(card));
  displayNameInput.addEventListener("input", () => updateActiveSpeakerLabel());
  displayNameInput.addEventListener("change", () => void maybeAutoApplyPreset(card));
  displayNameInput.addEventListener("blur", () => void maybeAutoApplyPreset(card));
  presetSelect.addEventListener("change", () => applySelectedPresetFromCard(card));
  baseLayerInput.addEventListener("change", () => normalizeSpeakerLayers());
  srtInput.addEventListener("change", () => refreshCardStatus(card));
  templateInput.addEventListener("change", () => void handleTemplateInputChange(card));
  for (const button of pickButtons) {
    button.addEventListener("click", () => {
      const kind = button.dataset.kind === "template" ? "template_exo" : "srt_file";
      card.querySelector(`[name="${kind}"]`).click();
    });
  }
  bindDropField(card, "srt");
  bindDropField(card, "template");
  if (initialData) hydrateSpeakerCard(card, initialData);
  else baseLayerInput.value = String(nextSuggestedLayer());
  renderPresetSelectOptions(card);
  refreshCardStatus(card);
  speakerList.appendChild(fragment);
  if (!state.activeSpeakerCard) setActiveSpeakerCard(card);
  normalizeSpeakerLayers();
}

async function handleTemplateInputChange(card) {
  await refreshTemplatePreview(card);
  refreshCardStatus(card);
}

async function convertProject() {
  try {
    setBusy(convertButton, true);
    generationStatus.textContent = "変換中...";
    normalizeSpeakerLayers();
    const project = readProjectForm();
    const speakers = await Promise.all([...speakerList.querySelectorAll(".speaker-card")].map(buildSpeakerPayload));
    if (speakers.length === 0) throw new Error("話者を1人以上追加してください。");
    const response = await fetchJson("/api/v2/convert", { method: "POST", body: buildConvertFormData(project, speakers) });
    state.segments = response.segments || [];
    state.analysis = response.analysis || null;
    state.output.exoContentB64 = response.exo_content_b64 || "";
    state.output.srtContent = response.srt_content || "";
    state.output.jsonContent = response.json_content || "";
    state.speakers = (response.project?.speakers || []).map((speaker) => ({ speaker_id: speaker.speaker_id, display_name: speaker.display_name }));
    generationStatus.textContent = `${state.segments.length} 件の字幕を生成しました。`;
    projectStatus.textContent = `変換済み: ${project.name}`;
    setDownloadDisabled(false);
    rebuildSpeakerFilter();
    renderSegments();
    renderAnalysis();
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
    normalizeSpeakerLayers();
    const project = readProjectForm();
    const speakers = (await Promise.all([...speakerList.querySelectorAll(".speaker-card")].map(serializeSpeakerCard))).filter(Boolean);
    downloadText(`${project.output_name || "output_v2"}.project.json`, JSON.stringify({ schema_version: "0.2-pages-project", project, speakers }, null, 2));
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
    applyProjectBundle(JSON.parse(await file.text()));
    projectStatus.textContent = `読込済み: ${file.name}`;
  } catch (error) {
    projectStatus.textContent = formatError(error, "ローカル読込に失敗しました。");
  } finally {
    event.target.value = "";
    setBusy(loadBundleButton, false);
  }
}

async function buildSpeakerPayload(card) {
  const displayName = card.querySelector('[name="display_name"]').value.trim();
  if (!displayName) throw new Error("話者名を入力してください。");
  const srtFile = await resolveCardFile(card, "srt");
  const templateFile = await resolveCardFile(card, "template");
  if (!srtFile) throw new Error(`${displayName} のSRTを指定してください。`);
  if (!templateFile) throw new Error(`${displayName} の見本EXOを指定してください。`);
  return { display_name: displayName, base_layer: Number(card.querySelector('[name="base_layer"]').value), subtitle_rule: readSubtitleRule(card), srtFile, templateFile };
}

async function serializeSpeakerCard(card) {
  const displayName = card.querySelector('[name="display_name"]').value.trim();
  const srtFile = await resolveCardFile(card, "srt");
  const templateFile = await resolveCardFile(card, "template");
  if (!displayName && !srtFile && !templateFile) return null;
  if (!displayName || !srtFile || !templateFile) throw new Error("保存する話者には、話者名、SRT、見本EXOが必要です。");
  return {
    display_name: displayName,
    base_layer: Number(card.querySelector('[name="base_layer"]').value),
    subtitle_rule: readSubtitleRule(card),
    preset_id: card.dataset.presetId || "",
    template_preview_meta: card._templatePreviewMeta || null,
    srt_file: await serializeFile(srtFile),
    template_exo: await serializeFile(templateFile),
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

function applyProjectBundle(payload) {
  const form = document.querySelector("#projectForm");
  for (const [key, value] of Object.entries(payload.project || {})) {
    const input = form.querySelector(`[name="${key}"]`);
    if (input) input.value = value;
  }
  speakerList.innerHTML = "";
  const speakers = (payload.speakers || []).filter(Boolean);
  for (const speaker of speakers) addSpeakerCard(speaker);
  if (speakers.length === 0) addSpeakerCard();
  state.speakers = [];
  state.segments = [];
  state.analysis = null;
  state.activeSpeakerCard = null;
  state.output = { exoContentB64: "", srtContent: "", jsonContent: "" };
  setDownloadDisabled(true);
  normalizeSpeakerLayers();
  if (speakerList.firstElementChild) setActiveSpeakerCard(speakerList.firstElementChild);
  rebuildSpeakerFilter();
  renderSegments();
  renderAnalysis();
}

function hydrateSpeakerCard(card, data) {
  card.querySelector('[name="display_name"]').value = data.display_name || "";
  card.querySelector('[name="max_chars_per_line"]').value = data.subtitle_rule?.max_chars_per_line ?? 18;
  card.querySelector('[name="max_lines"]').value = data.subtitle_rule?.max_lines ?? 2;
  card.querySelector('[name="min_duration_sec"]').value = data.subtitle_rule?.min_duration_sec ?? 0.8;
  card.querySelector('[name="max_duration_sec"]').value = data.subtitle_rule?.max_duration_sec ?? 4.0;
  card.querySelector('[name="base_layer"]').value = data.base_layer ?? nextSuggestedLayer();
  card.dataset.presetId = data.preset_id || "";
  card._storedSrtFile = data.srt_file || null;
  card._storedTemplateFile = data.template_exo || null;
  card._templatePreviewMeta = data.template_preview_meta || null;
}

function readProjectForm() {
  const payload = Object.fromEntries(new FormData(document.querySelector("#projectForm")).entries());
  return { name: String(payload.name || "srt_project"), fps: Number(payload.fps || 60), width: Number(payload.width || 1920), height: Number(payload.height || 1080), output_name: String(payload.output_name || "output_v2") };
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
    row.innerHTML = `<td>${escapeHtml(speaker ? speaker.display_name : segment.speaker_id)}</td><td>${Number(segment.start_sec).toFixed(2)}</td><td>${Number(segment.end_sec).toFixed(2)}</td><td>${Number(segment.base_layer || 1)}</td><td>${escapeHtml(segment.text).replaceAll("\n", "<br>")}</td><td>${escapeHtml((segment.warnings || []).join(", "))}</td>`;
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
    analysisSummary.textContent = "未変換";
    return;
  }
  const warningCount = Number(state.analysis.warning_count || 0);
  analysisSummary.textContent = warningCount === 0 ? "警告はありません。" : `${warningCount} 件の警告`;
  for (const item of state.analysis.warnings || []) {
    const li = document.createElement("li");
    li.textContent = item.message;
    analysisList.appendChild(li);
  }
}

async function loadPresets(showStatus) {
  try {
    const response = await fetchJson("/api/v2/presets", { method: "GET" });
    state.presets = response.presets || [];
    for (const card of speakerList.querySelectorAll(".speaker-card")) {
      renderPresetSelectOptions(card);
      await maybeAutoApplyPreset(card);
    }
    renderPresetTable();
    if (showStatus) projectStatus.textContent = `${state.presets.length} 件のプリセットを読み込みました。`;
  } catch (error) {
    const message = formatError(error, "プリセット読込に失敗しました。");
    if (showStatus) projectStatus.textContent = message;
    presetStatus.textContent = message;
  }
}

async function savePresetFromCard(card) {
  try {
    const displayName = card.querySelector('[name="display_name"]').value.trim();
    if (!displayName) throw new Error("プリセット保存前に話者名を入力してください。");
    const templateFile = await resolveCardFile(card, "template");
    if (!templateFile) throw new Error("プリセット保存前に見本EXOを選択してください。");
    await refreshTemplatePreview(card);
    const existing = state.presets.find((preset) => preset.name === displayName);
    const payload = { preset_id: existing?.preset_id || card.dataset.presetId || "", name: displayName, subtitle_rule: readSubtitleRule(card), base_layer: Number(card.querySelector('[name="base_layer"]').value), template_exo: await serializeFile(templateFile) };
    const response = await fetchJson("/api/v2/presets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    card.dataset.presetId = response.preset_id;
    card._storedTemplateFile = response.template_exo;
    card._templatePreviewMeta = response.template_preview_meta || null;
    await loadPresets(false);
    renderPresetSelectOptions(card);
    refreshCardStatus(card, "プリセットを保存しました。");
    projectStatus.textContent = `プリセット保存: ${displayName}`;
  } catch (error) {
    const message = formatError(error, "プリセット保存に失敗しました。");
    projectStatus.textContent = message;
    presetStatus.textContent = message;
  }
}

async function maybeAutoApplyPreset(card) {
  const displayName = card.querySelector('[name="display_name"]').value.trim();
  if (!displayName) return;
  const hasManualTemplate = Boolean(card.querySelector('[name="template_exo"]').files[0]);
  const hasStoredTemplate = Boolean(card._storedTemplateFile);
  if (hasManualTemplate || hasStoredTemplate) return;
  if (state.presets.length === 0) {
    const response = await fetchJson("/api/v2/presets", { method: "GET" });
    state.presets = response.presets || [];
  }
  const preset = state.presets.find((item) => item.name === displayName);
  if (!preset) return;
  applyPresetToCard(card, preset, true, false);
}

function applyPresetToCard(card, preset, automatic = false, overwriteName = true) {
  if (overwriteName) card.querySelector('[name="display_name"]').value = preset.name || "";
  card.dataset.presetId = preset.preset_id || "";
  card._storedTemplateFile = preset.template_exo || null;
  card._templatePreviewMeta = preset.template_preview_meta || null;
  const presetSelect = card.querySelector('[name="preset_select"]');
  if (presetSelect) presetSelect.value = preset.preset_id || "";
  card.querySelector('[name="max_chars_per_line"]').value = preset.subtitle_rule?.max_chars_per_line ?? 18;
  card.querySelector('[name="max_lines"]').value = preset.subtitle_rule?.max_lines ?? 2;
  card.querySelector('[name="min_duration_sec"]').value = preset.subtitle_rule?.min_duration_sec ?? 0.8;
  card.querySelector('[name="max_duration_sec"]').value = preset.subtitle_rule?.max_duration_sec ?? 4.0;
  card.querySelector('[name="base_layer"]').value = preset.base_layer ?? nextSuggestedLayer();
  normalizeSpeakerLayers();
  updateActiveSpeakerLabel();
  refreshCardStatus(card, automatic ? "一致するプリセットを自動適用しました。" : "プリセットを適用しました。");
}

function applySelectedPresetFromCard(card) {
  const presetSelect = card.querySelector('[name="preset_select"]');
  const presetId = presetSelect?.value || "";
  if (!presetId) {
    card.dataset.presetId = "";
    refreshCardStatus(card, "プリセット選択を解除しました。");
    return;
  }
  const preset = state.presets.find((item) => item.preset_id === presetId);
  if (!preset) return;
  applyPresetToCard(card, preset, false, true);
}

function renderPresetSelectOptions(card) {
  const presetSelect = card.querySelector('[name="preset_select"]');
  if (!presetSelect) return;
  const current = card.dataset.presetId || presetSelect.value || "";
  presetSelect.innerHTML = '<option value="">未選択</option>';
  for (const preset of state.presets) {
    const option = document.createElement("option");
    option.value = preset.preset_id;
    option.textContent = preset.name;
    presetSelect.appendChild(option);
  }
  presetSelect.value = current;
}

function renderPresetTable() {
  presetTableBody.innerHTML = "";
  if (state.presets.length === 0) {
    presetStatus.textContent = "プリセットなし";
    return;
  }
  presetStatus.textContent = `${state.presets.length} 件のプリセット`;
  for (const preset of state.presets) {
    const row = document.createElement("tr");
    row.innerHTML = `<td><input data-field="name" value="${escapeAttribute(preset.name || "")}"></td><td><input data-field="base_layer" type="number" min="1" value="${Number(preset.base_layer || 1)}"></td><td><input data-field="max_chars_per_line" type="number" min="1" max="80" value="${Number(preset.subtitle_rule?.max_chars_per_line || 18)}"></td><td><input data-field="max_lines" type="number" min="1" max="4" value="${Number(preset.subtitle_rule?.max_lines || 2)}"></td><td><input data-field="min_duration_sec" type="number" min="0.1" step="0.1" value="${Number(preset.subtitle_rule?.min_duration_sec || 0.8)}"></td><td><input data-field="max_duration_sec" type="number" min="0.1" max="10" step="0.1" value="${Number(preset.subtitle_rule?.max_duration_sec || 4.0)}"></td><td>${escapeHtml(preset.template_exo?.name || "-")}</td><td>${escapeHtml(formatDateTime(preset.updated_at || ""))}</td><td class="row-actions"></td>`;
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
  applyPresetToCard(state.activeSpeakerCard, preset, false, true);
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
    await fetchJson("/api/v2/presets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    await loadPresets(false);
    presetStatus.textContent = `保存しました: ${payload.name}`;
  } catch (error) {
    presetStatus.textContent = formatError(error, "プリセット保存に失敗しました。");
  }
}

async function deletePresetRow(presetId) {
  try {
    await fetchJson("/api/v2/presets/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ preset_id: presetId }) });
    if (state.activeSpeakerCard?.dataset.presetId === presetId) {
      state.activeSpeakerCard.dataset.presetId = "";
      const select = state.activeSpeakerCard.querySelector('[name="preset_select"]');
      if (select) select.value = "";
    }
    await loadPresets(false);
    presetStatus.textContent = "プリセットを削除しました。";
  } catch (error) {
    presetStatus.textContent = formatError(error, "プリセット削除に失敗しました。");
  }
}

function setActiveSpeakerCard(card) {
  if (!card) return;
  for (const item of speakerList.querySelectorAll(".speaker-card")) item.classList.toggle("active", item === card);
  state.activeSpeakerCard = card;
  updateActiveSpeakerLabel();
}

function updateActiveSpeakerLabel() {
  if (!state.activeSpeakerCard) {
    activeSpeakerLabel.textContent = "選択中の話者: なし";
    return;
  }
  const name = state.activeSpeakerCard.querySelector('[name="display_name"]').value.trim() || "未入力";
  activeSpeakerLabel.textContent = `選択中の話者: ${name}`;
}

function normalizeSpeakerLayers() {
  const cards = [...speakerList.querySelectorAll(".speaker-card")];
  const used = new Set();
  for (const card of cards) {
    const input = card.querySelector('[name="base_layer"]');
    let value = Number.parseInt(input.value, 10);
    if (!Number.isFinite(value) || value < 1) value = 1;
    while (used.has(value)) value += 1;
    used.add(value);
    input.value = String(value);
  }
}

function nextSuggestedLayer() {
  const values = [...speakerList.querySelectorAll('.speaker-card [name="base_layer"]')].map((input) => Number.parseInt(input.value, 10)).filter((value) => Number.isFinite(value) && value >= 1);
  return values.length === 0 ? 1 : Math.max(...values) + 1;
}

function refreshCardStatus(card, suffix = "") {
  const status = card.querySelector(".speaker-source-status");
  const srtInput = card.querySelector('[name="srt_file"]').files[0];
  const templateInput = card.querySelector('[name="template_exo"]').files[0];
  const srtLabel = srtInput ? srtInput.name : card._storedSrtFile?.name || "-";
  const templateLabel = templateInput ? templateInput.name : card._storedTemplateFile?.name || "-";
  const srtFileLabel = card.querySelector('[data-file-label="srt"]');
  const templateFileLabel = card.querySelector('[data-file-label="template"]');
  if (srtFileLabel) srtFileLabel.textContent = srtLabel;
  if (templateFileLabel) templateFileLabel.textContent = templateLabel;
  const preview = card._templatePreviewMeta ? `\nフォント: ${card._templatePreviewMeta.font || "-"} / サイズ: ${card._templatePreviewMeta.size || "-"} / 色: ${card._templatePreviewMeta.color || "-"} / レイヤー: ${card._templatePreviewMeta.layer || "-"}` : "";
  status.textContent = `SRT: ${srtLabel}\nEXO: ${templateLabel}${preview}${suffix ? `\n${suffix}` : ""}`;
}

async function refreshTemplatePreview(card) {
  const templateFile = await resolveCardFile(card, "template");
  if (!templateFile) {
    card._templatePreviewMeta = null;
    return;
  }
  const formData = new FormData();
  formData.append("template_exo", templateFile, templateFile.name);
  const response = await fetchJson("/api/v2/template-preview", { method: "POST", body: formData });
  card._templatePreviewMeta = response.template_preview_meta || null;
}

function bindDropField(card, kind) {
  const field = card.querySelector(`.drop-field[data-kind="${kind}"]`);
  const inputName = kind === "srt" ? "srt_file" : "template_exo";
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
  field.addEventListener("drop", (event) => void applyDroppedFile(card, kind, input, event.dataTransfer?.files || []));
}

async function applyDroppedFile(card, kind, input, fileList) {
  const file = [...fileList][0];
  if (!file) return;
  if (kind === "srt" && !file.name.toLowerCase().endsWith(".srt")) return;
  if (kind === "template" && !file.name.toLowerCase().endsWith(".exo")) return;
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  if (kind === "template") await refreshTemplatePreview(card);
  refreshCardStatus(card);
}

async function resolveCardFile(card, kind) {
  const inputName = kind === "srt" ? "srt_file" : "template_exo";
  const selected = card.querySelector(`[name="${inputName}"]`).files[0];
  if (selected) return selected;
  const stored = kind === "srt" ? card._storedSrtFile : card._storedTemplateFile;
  if (!stored) return null;
  return new File([base64ToBytes(stored.content_b64)], stored.name, { type: stored.mime_type || "application/octet-stream" });
}

async function serializeFile(file) {
  return { name: file.name, mime_type: file.type || "application/octet-stream", content_b64: await fileToBase64(file) };
}

async function checkApiHealth() {
  try {
    setBusy(checkApiButton, true);
    const response = await fetchJson("/api/health", { method: "GET" });
    apiStatus.textContent = `接続済み: ${response.runtime || "local-api"}`;
  } catch (error) {
    apiStatus.textContent = formatError(error, "ローカルAPIに接続できません。");
  } finally {
    setBusy(checkApiButton, false);
  }
}

function saveApiBase() {
  state.apiBase = normalizeApiBase(apiBaseInput.value);
  localStorage.setItem("srt2subtitle_v2_api_base", state.apiBase);
  apiBaseInput.value = state.apiBase;
  apiStatus.textContent = `保存しました: ${state.apiBase || "同一オリジン"}`;
}

async function fetchJson(path, options) {
  const response = await fetch(`${state.apiBase}${path}`, options);
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

function loadApiBase() {
  const saved = localStorage.getItem("srt2subtitle_v2_api_base");
  if (saved) return normalizeApiBase(saved);
  return "http://127.0.0.1:8002";
}

function normalizeApiBase(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed || trimmed === "/") return "";
  return trimmed.replace(/\/+$/, "");
}

function setBusy(button, busy) {
  button.disabled = busy;
}

function setDownloadDisabled(disabled) {
  downloadExoButton.disabled = disabled;
  downloadSrtButton.disabled = disabled;
  downloadJsonButton.disabled = disabled;
}

function downloadText(filename, content) {
  downloadBlob(filename, new Blob([content], { type: "text/plain;charset=utf-8" }));
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

function base64ToBytes(contentB64) {
  const binary = atob(contentB64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function outputName(extension) {
  const project = readProjectForm();
  return `${project.output_name}.${extension}`;
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function formatDateTime(value) {
  if (!value) return "-";
  return value.replace("T", " ").replace("Z", "");
}

function formatError(error, fallbackMessage) {
  if (error instanceof Error && error.message) return error.message;
  return fallbackMessage;
}
