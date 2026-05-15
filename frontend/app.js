const state = {
  projectId: "",
  speakers: [],
  segments: [],
};
const API_BASE = window.location.protocol === "file:" ? "http://127.0.0.1:8000" : "";

const speakerList = document.querySelector("#speakerList");
const speakerTemplate = document.querySelector("#speakerTemplate");
const projectStatus = document.querySelector("#projectStatus");
const generationStatus = document.querySelector("#generationStatus");
const segmentTableBody = document.querySelector("#segmentTableBody");
const speakerFilter = document.querySelector("#speakerFilter");
const createProjectButton = document.querySelector("#createProjectButton");
const saveProjectButton = document.querySelector("#saveProjectButton");
const registerSpeakersButton = document.querySelector("#registerSpeakersButton");
const transcribeButton = document.querySelector("#transcribeButton");
const exportButton = document.querySelector("#exportButton");
const projectPicker = document.querySelector("#projectPicker");
const reloadProjectsButton = document.querySelector("#reloadProjectsButton");
const loadProjectButton = document.querySelector("#loadProjectButton");
const presetPicker = document.querySelector("#presetPicker");
const reloadPresetsButton = document.querySelector("#reloadPresetsButton");
const applyPresetButton = document.querySelector("#applyPresetButton");

createProjectButton.addEventListener("click", createProject);
saveProjectButton.addEventListener("click", saveProject);
document.querySelector("#addSpeakerButton").addEventListener("click", addSpeakerCard);
registerSpeakersButton.addEventListener("click", registerSpeakers);
transcribeButton.addEventListener("click", transcribeProject);
exportButton.addEventListener("click", exportProject);
reloadProjectsButton.addEventListener("click", loadProjects);
loadProjectButton.addEventListener("click", loadSelectedProject);
reloadPresetsButton.addEventListener("click", loadPresets);
applyPresetButton.addEventListener("click", applySelectedPresetToLastCard);
speakerFilter.addEventListener("change", renderSegments);

addSpeakerCard();
void loadProjects();
void loadPresets();

async function createProject() {
  try {
    setBusy(createProjectButton, true);
    projectStatus.textContent = "プロジェクトを作成中...";
    const form = document.querySelector("#projectForm");
    const payload = Object.fromEntries(new FormData(form).entries());
    const response = await fetchJson("/api/project/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    state.projectId = response.project_id;
    state.speakers = [];
    state.segments = [];
    projectStatus.textContent = `作成済み: ${response.project_id}`;
    segmentTableBody.innerHTML = "";
    rebuildSpeakerFilter();
    await loadProjects();
  } catch (error) {
    projectStatus.textContent = formatErrorMessage(error, "プロジェクト作成に失敗しました。");
  } finally {
    setBusy(createProjectButton, false);
  }
}

function addSpeakerCard() {
  const fragment = speakerTemplate.content.cloneNode(true);
  const card = fragment.querySelector(".speaker-card");
  card.dataset.mode = "new";
  card.querySelector(".save-preset").addEventListener("click", () => savePresetFromCard(card));
  card.querySelector(".remove-speaker").addEventListener("click", () => {
    card.remove();
  });
  speakerList.appendChild(fragment);
}

function addExistingSpeakerCard(speaker) {
  const fragment = speakerTemplate.content.cloneNode(true);
  const card = fragment.querySelector(".speaker-card");
  card.dataset.mode = "existing";
  card.dataset.speakerId = speaker.speaker_id;
  card.dataset.templatePath = speaker.template_exo;
  card.dataset.presetId = speaker.preset_id || "";
  card.querySelector('[name="display_name"]').value = speaker.display_name;
  card.querySelector('[name="preset_name"]').value = speaker.preset_id || "";
  card.querySelector('[name="max_chars_per_line"]').value = speaker.subtitle_rule.max_chars_per_line;
  card.querySelector('[name="max_lines"]').value = speaker.subtitle_rule.max_lines;
  card.querySelector('[name="min_duration_sec"]').value = speaker.subtitle_rule.min_duration_sec;
  card.querySelector('[name="max_duration_sec"]').value = speaker.subtitle_rule.max_duration_sec;
  card.querySelector('[name="base_layer"]').value = speaker.base_layer || speaker.template_meta?.preview?.layer || 1;
  card.querySelector('[name="audio_file"]').required = false;
  card.querySelector('[name="template_exo"]').required = false;
  card.querySelector(".template-preview").textContent =
    `読込済み: ${speaker.speaker_id}\n` +
    `font=${speaker.template_meta.preview.font}, size=${speaker.template_meta.preview.size}, ` +
    `color=${speaker.template_meta.preview.color}, layer=${speaker.base_layer || speaker.template_meta.preview.layer}`;
  card.querySelector(".save-preset").addEventListener("click", () => savePresetFromCard(card));
  card.querySelector(".remove-speaker").addEventListener("click", () => card.remove());
  speakerList.appendChild(fragment);
}

async function saveProject() {
  if (!state.projectId) {
    projectStatus.textContent = "先にプロジェクトを作成または読込してください。";
    return;
  }
  try {
    setBusy(saveProjectButton, true);
    collectEditedSegments();
    const form = document.querySelector("#projectForm");
    const projectPayload = Object.fromEntries(new FormData(form).entries());
    await fetchJson("/api/project/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: state.projectId,
        project: projectPayload,
        segments: state.segments,
      }),
    });
    projectStatus.textContent = `保存済み: ${state.projectId}`;
    await loadProjects();
  } catch (error) {
    projectStatus.textContent = formatErrorMessage(error, "プロジェクト保存に失敗しました。");
  } finally {
    setBusy(saveProjectButton, false);
  }
}

async function registerSpeakers() {
  if (!state.projectId) {
    projectStatus.textContent = "先にプロジェクトを作成してください。";
    return;
  }

  setBusy(registerSpeakersButton, true);
  generationStatus.textContent = "話者設定を登録中...";
  const cards = [...speakerList.querySelectorAll(".speaker-card")];
  const newSpeakers = [];
  let skippedExisting = 0;
  let failedCards = 0;
  for (const card of cards) {
    if (card.dataset.mode === "existing") {
      skippedExisting += 1;
      continue;
    }
    const formData = new FormData();
    formData.append("project_id", state.projectId);
    formData.append("display_name", card.querySelector('[name="display_name"]').value);
    const rule = {
      max_chars_per_line: Number(card.querySelector('[name="max_chars_per_line"]').value),
      max_lines: Number(card.querySelector('[name="max_lines"]').value),
      min_duration_sec: Number(card.querySelector('[name="min_duration_sec"]').value),
      max_duration_sec: Number(card.querySelector('[name="max_duration_sec"]').value),
    };
    formData.append("subtitle_rule_json", JSON.stringify(rule));
    formData.append("preset_id", card.dataset.presetId || "");
    formData.append("base_layer", card.querySelector('[name="base_layer"]').value);

    const audioInput = card.querySelector('[name="audio_file"]');
    for (const file of audioInput.files) {
      formData.append("audio_file", file, file.name);
    }
    const templateFile = card.querySelector('[name="template_exo"]').files[0];
    if (!templateFile && !card.dataset.presetId) {
      card.querySelector(".template-preview").textContent = "テンプレート EXO が未選択です。";
      failedCards += 1;
      continue;
    }
    if (templateFile) {
      formData.append("template_exo", templateFile, templateFile.name);
    }
    const transcriptFile = card.querySelector('[name="transcript_json"]').files[0];
    if (transcriptFile) {
      formData.append("transcript_json", transcriptFile, transcriptFile.name);
    }

    try {
      const response = await fetchJson("/api/speakers", {
        method: "POST",
        body: formData,
      });
      newSpeakers.push({
        speaker_id: response.speaker_id,
        display_name: card.querySelector('[name="display_name"]').value,
        base_layer: response.base_layer,
        template_exo: response.template_path,
      });
      card.dataset.speakerId = response.speaker_id;
      card.dataset.mode = "existing";
      card.dataset.templatePath = response.template_path;
      card.querySelector(".template-preview").textContent =
        `登録済み: ${response.speaker_id}\n` +
        `font=${response.template_preview.font}, size=${response.template_preview.size}, ` +
        `color=${response.template_preview.color}, layer=${response.base_layer}`;
    } catch (error) {
      failedCards += 1;
      card.querySelector(".template-preview").textContent = error.message;
    }
  }
  state.speakers = [...state.speakers, ...newSpeakers];
  rebuildSpeakerFilter();
  if (newSpeakers.length > 0) {
    generationStatus.textContent =
      `${newSpeakers.length} 話者を登録しました。` +
      (failedCards > 0 ? ` 失敗 ${failedCards} 件。` : "") +
      (skippedExisting > 0 ? ` 既存 ${skippedExisting} 件は再登録していません。` : "");
  } else if (failedCards > 0) {
    generationStatus.textContent = `話者登録に失敗しました。各カードの下に出ているエラーを確認してください。失敗 ${failedCards} 件。`;
  } else if (skippedExisting > 0) {
    generationStatus.textContent = `新規登録対象はありません。既存 ${skippedExisting} 件は再登録していません。`;
  } else {
    generationStatus.textContent = "新規登録対象がありません。";
  }
  setBusy(registerSpeakersButton, false);
  await loadProjects();
}

async function transcribeProject() {
  if (!state.projectId) {
    generationStatus.textContent = "先にプロジェクトを作成してください。";
    return;
  }
  if (state.speakers.length === 0) {
    generationStatus.textContent = "先に話者を登録してください。";
    return;
  }
  try {
    setBusy(transcribeButton, true);
    generationStatus.textContent = "文字起こし中... 初回はモデル準備で時間がかかります。2回目以降はキャッシュを使います。";
    const response = await fetchJson("/api/transcribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: state.projectId }),
    });
    state.segments = response.segments;
    generationStatus.textContent = `${response.segments.length} 件の字幕セグメントを生成しました。本文はこの表で直接修正できます。`;
    renderSegments();
  } catch (error) {
    generationStatus.textContent = formatErrorMessage(error, "文字起こしに失敗しました。");
  } finally {
    setBusy(transcribeButton, false);
  }
}

async function exportProject() {
  if (!state.projectId || state.segments.length === 0) {
    generationStatus.textContent = "先に文字起こしを実行してください。";
    return;
  }
  try {
    setBusy(exportButton, true);
    generationStatus.textContent = "出力ファイルを生成中...";
    collectEditedSegments();
    const response = await fetchJson("/api/export/exo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: state.projectId, segments: state.segments }),
    });
    downloadBase64("output.exo", response.exo_content_b64, "application/octet-stream");
    downloadText("output.srt", response.srt_content);
    downloadText("output.json", response.json_content);
    generationStatus.textContent = `出力完了: ${response.files.exo}`;
  } catch (error) {
    generationStatus.textContent = formatErrorMessage(error, "出力に失敗しました。");
  } finally {
    setBusy(exportButton, false);
  }
}

function renderSegments() {
  collectEditedSegments();
  segmentTableBody.innerHTML = "";
  const filterValue = speakerFilter.value;
  const rows = state.segments.filter((segment) => !filterValue || segment.speaker_id === filterValue);
  for (const segment of rows) {
    const speaker = state.speakers.find((item) => item.speaker_id === segment.speaker_id);
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${speaker ? escapeHtml(speaker.display_name) : escapeHtml(segment.speaker_id)}</td>
      <td>${segment.start_sec.toFixed(2)}</td>
      <td>${segment.end_sec.toFixed(2)}</td>
      <td><textarea data-subtitle-id="${segment.subtitle_id}">${escapeHtml(segment.text)}</textarea></td>
      <td>${escapeHtml((segment.warnings || []).join(", "))}</td>
    `;
    segmentTableBody.appendChild(row);
  }
}

function collectEditedSegments() {
  for (const textarea of segmentTableBody.querySelectorAll("textarea[data-subtitle-id]")) {
    const target = state.segments.find((item) => item.subtitle_id === textarea.dataset.subtitleId);
    if (target) {
      target.text = textarea.value;
    }
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

async function loadProjects() {
  const response = await fetchJson("/api/projects", { method: "GET" });
  projectPicker.innerHTML = '<option value="">選択してください</option>';
  for (const project of response.projects) {
    const option = document.createElement("option");
    option.value = project.project_id;
    option.textContent = `${project.name} (${project.project_id}) / ${project.speaker_count}話者 / ${project.asr_model}`;
    projectPicker.appendChild(option);
  }
}

async function loadSelectedProject() {
  const projectId = projectPicker.value;
  if (!projectId) {
    projectStatus.textContent = "読込対象のプロジェクトを選択してください。";
    return;
  }
  const project = await fetchJson(`/api/project/${projectId}`, { method: "GET" });
  state.projectId = project.project_id;
  state.speakers = project.speakers.map((speaker) => ({
    speaker_id: speaker.speaker_id,
    display_name: speaker.display_name,
    base_layer: speaker.base_layer,
    template_exo: speaker.template_exo,
  }));
  state.segments = project.segments || [];
  applyProjectForm(project.project);
  speakerList.innerHTML = "";
  for (const speaker of project.speakers) {
    addExistingSpeakerCard(speaker);
  }
  rebuildSpeakerFilter();
  renderSegments();
  projectStatus.textContent = `読込済み: ${project.project_id}`;
}

function applyProjectForm(project) {
  const form = document.querySelector("#projectForm");
  for (const [key, value] of Object.entries(project)) {
    const input = form.querySelector(`[name="${key}"]`);
    if (input) {
      input.value = value;
    }
  }
}

async function loadPresets() {
  const response = await fetchJson("/api/presets/speakers", { method: "GET" });
  presetPicker.innerHTML = '<option value="">選択してください</option>';
  for (const preset of response.presets) {
    const option = document.createElement("option");
    option.value = preset.preset_id;
    option.textContent = `${preset.preset_name} / layer ${preset.base_layer}`;
    option.dataset.preset = JSON.stringify(preset);
    presetPicker.appendChild(option);
  }
}

function applySelectedPresetToLastCard() {
  const option = presetPicker.selectedOptions[0];
  if (!option || !option.value) {
    generationStatus.textContent = "適用するプリセットを選択してください。";
    return;
  }
  const card = [...speakerList.querySelectorAll(".speaker-card")].findLast((item) => item.dataset.mode !== "existing") || speakerList.querySelector(".speaker-card:last-child");
  if (!card) {
    generationStatus.textContent = "先に話者カードを追加してください。";
    return;
  }
  const preset = JSON.parse(option.dataset.preset);
  card.dataset.presetId = preset.preset_id;
  card.querySelector('[name="preset_name"]').value = preset.preset_name;
  card.querySelector('[name="max_chars_per_line"]').value = preset.subtitle_rule.max_chars_per_line;
  card.querySelector('[name="max_lines"]').value = preset.subtitle_rule.max_lines;
  card.querySelector('[name="min_duration_sec"]').value = preset.subtitle_rule.min_duration_sec;
  card.querySelector('[name="max_duration_sec"]').value = preset.subtitle_rule.max_duration_sec;
  card.querySelector('[name="base_layer"]').value = preset.base_layer;
  card.querySelector(".template-preview").textContent =
    `プリセット適用: ${preset.preset_name}\n` +
    `font=${preset.template_meta.preview.font}, size=${preset.template_meta.preview.size}, ` +
    `color=${preset.template_meta.preview.color}, layer=${preset.base_layer}`;
}

async function savePresetFromCard(card) {
  const templateFile = card.querySelector('[name="template_exo"]').files[0];
  if (!templateFile && !card.dataset.templatePath) {
    card.querySelector(".template-preview").textContent = "プリセット保存には EXO ファイルの指定が必要です。";
    return;
  }
  const formData = new FormData();
  formData.append("preset_name", card.querySelector('[name="preset_name"]').value || card.querySelector('[name="display_name"]').value || "話者プリセット");
  formData.append("subtitle_rule_json", JSON.stringify({
    max_chars_per_line: Number(card.querySelector('[name="max_chars_per_line"]').value),
    max_lines: Number(card.querySelector('[name="max_lines"]').value),
    min_duration_sec: Number(card.querySelector('[name="min_duration_sec"]').value),
    max_duration_sec: Number(card.querySelector('[name="max_duration_sec"]').value),
  }));
  formData.append("base_layer", card.querySelector('[name="base_layer"]').value);
  if (card.dataset.presetId) {
    formData.append("preset_id", card.dataset.presetId);
  }
  if (templateFile) {
    formData.append("template_exo", templateFile, templateFile.name);
  } else if (state.projectId && card.dataset.templatePath) {
    formData.append("project_id", state.projectId);
    formData.append("template_relative", card.dataset.templatePath);
  }
  try {
    const response = await fetchJson("/api/presets/speakers", {
      method: "POST",
      body: formData,
    });
    card.dataset.presetId = response.preset.preset_id;
    card.querySelector('[name="preset_name"]').value = response.preset.preset_name;
    card.querySelector(".template-preview").textContent =
      `プリセット保存済み: ${response.preset.preset_name}\n` +
      `font=${response.preset.template_meta.preview.font}, size=${response.preset.template_meta.preview.size}, ` +
      `color=${response.preset.template_meta.preview.color}, layer=${response.preset.base_layer}`;
    await loadPresets();
  } catch (error) {
    card.querySelector(".template-preview").textContent = formatErrorMessage(error, "プリセット保存に失敗しました。");
  }
}

function downloadText(filename, content) {
  const blob = new Blob([content], { type: "text/plain;charset=UTF-8" });
  triggerDownload(filename, blob);
}

function downloadBase64(filename, base64, mimeType) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const blob = new Blob([bytes], { type: mimeType });
  triggerDownload(filename, blob);
}

function triggerDownload(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function fetchJson(url, options) {
  const response = await fetch(`${API_BASE}${url}`, options);
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : { error: "ERR-NONJSON-001", message: await response.text() };
  if (!response.ok) {
    throw new Error(`${payload.error}: ${payload.message || "request failed"}`);
  }
  return payload;
}

function formatErrorMessage(error, fallback) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

function setBusy(button, isBusy) {
  button.disabled = isBusy;
  button.dataset.busy = isBusy ? "true" : "false";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
