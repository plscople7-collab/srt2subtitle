const state = {
  files: [],
  outputs: [],
};

const mediaInput = document.querySelector("#mediaInput");
const dropZone = document.querySelector("#dropZone");
const inputStatus = document.querySelector("#inputStatus");
const fileTableBody = document.querySelector("#fileTableBody");
const transcribeButton = document.querySelector("#transcribeButton");
const engineInput = document.querySelector("#engineInput");
const modelInput = document.querySelector("#modelInput");
const languageInput = document.querySelector("#languageInput");
const generationStatus = document.querySelector("#generationStatus");
const resultTableBody = document.querySelector("#resultTableBody");
const downloadAllSrtButton = document.querySelector("#downloadAllSrtButton");
const downloadAllJsonButton = document.querySelector("#downloadAllJsonButton");

mediaInput.addEventListener("change", () => {
  state.files = [...mediaInput.files];
  renderFiles();
});
transcribeButton.addEventListener("click", () => void transcribeFiles());
downloadAllSrtButton.addEventListener("click", () => downloadAll("srt"));
downloadAllJsonButton.addEventListener("click", () => downloadAll("json"));

for (const eventName of ["dragenter", "dragover"]) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add("drag-over");
  });
}

for (const eventName of ["dragleave", "dragend", "drop"]) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove("drag-over");
  });
}

dropZone.addEventListener("drop", (event) => {
  const files = [...(event.dataTransfer?.files || [])];
  if (!files.length) return;
  state.files = files;
  const transfer = new DataTransfer();
  for (const file of files) transfer.items.add(file);
  mediaInput.files = transfer.files;
  renderFiles();
});

renderFiles();
renderOutputs();

async function transcribeFiles() {
  try {
    if (!state.files.length) throw new Error("音声または動画ファイルを選択してください。");
    setBusy(true);
    generationStatus.textContent = "文字起こし中... 初回モデル取得時は時間がかかります。";
    const formData = new FormData();
    formData.append("engine", engineInput.value);
    formData.append("model", modelInput.value);
    formData.append("language", languageInput.value.trim() || "ja");
    for (const file of state.files) {
      formData.append("media_file", file, file.name);
    }

    const response = await fetchJson("/api/transcriber/transcribe", {
      method: "POST",
      body: formData,
    });
    state.outputs = response.outputs || [];
    generationStatus.textContent = `${state.outputs.length} 件のSRTを生成しました。`;
    renderOutputs();
  } catch (error) {
    generationStatus.textContent = formatError(error, "文字起こしに失敗しました。");
    state.outputs = [];
    renderOutputs();
  } finally {
    setBusy(false);
  }
}

function renderFiles() {
  fileTableBody.innerHTML = "";
  inputStatus.textContent = state.files.length ? `${state.files.length} 件` : "未選択";
  for (const file of state.files) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(file.name)}</td>
      <td>${formatBytes(file.size)}</td>
      <td>${escapeHtml(file.name.split(".").pop() || "-")}</td>
    `;
    fileTableBody.appendChild(row);
  }
}

function renderOutputs() {
  resultTableBody.innerHTML = "";
  const hasOutput = state.outputs.length > 0;
  downloadAllSrtButton.disabled = !hasOutput;
  downloadAllJsonButton.disabled = !hasOutput;
  for (const output of state.outputs) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(output.filename)}</td>
      <td>${Number(output.segment_count || 0)}</td>
      <td>${output.cached ? "使用" : "新規"}</td>
      <td class="row-actions"></td>
    `;
    const actions = row.querySelector(".row-actions");
    actions.appendChild(makeButton("SRT", () => downloadText(output.srt_name, output.srt_content)));
    actions.appendChild(makeButton("JSON", () => downloadText(output.json_name, output.json_content)));
    resultTableBody.appendChild(row);
  }
}

function downloadAll(kind) {
  const isSrt = kind === "srt";
  for (const output of state.outputs) {
    downloadText(isSrt ? output.srt_name : output.json_name, isSrt ? output.srt_content : output.json_content);
  }
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
    throw new Error(data.message || data.error || "リクエストに失敗しました。");
  }
  return data;
}

function makeButton(label, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ghost";
  button.textContent = label;
  button.addEventListener("click", handler);
  return button;
}

function downloadText(filename, content) {
  const blob = new Blob([content || ""], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function setBusy(busy) {
  transcribeButton.disabled = busy;
}

function formatBytes(size) {
  if (!Number.isFinite(size)) return "-";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
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
  if (error instanceof Error && error.message) return error.message;
  return fallbackMessage;
}
