import type { ExoSection, ExoTemplateMeta, ProjectPayload, ProjectSpeaker, Segment } from "./types";

export function decodeExoBytes(raw: Uint8Array): [string, string] {
  for (const encoding of ["utf-8", "shift_jis"]) {
    try {
      const decoded = new TextDecoder(encoding, { fatal: true }).decode(raw);
      return [stripBom(decoded), encoding === "shift_jis" ? "cp932" : encoding];
    } catch {
      continue;
    }
  }
  throw new Error("ERR-EXO-ENCODING-001: EXO の文字コードを解釈できません。");
}

export function parseExoTemplate(content: string, speakerId: string, sourceName: string, fileEncoding = "utf-8"): ExoTemplateMeta {
  const sections = parseSections(content);
  const exedit = sections.find((section) => section.name === "[exedit]");
  if (!exedit) {
    throw new Error("ERR-EXO-TEMPLATE-001: EXO に [exedit] セクションがありません。");
  }

  const candidates: Array<{ textSection: ExoSection; objectSections: ExoSection[]; decodedText: string; encoding: string }> = [];
  for (const section of sections) {
    if (!section.name.endsWith(".0]")) continue;
    if (!section.items.some(([key]) => key === "text")) continue;
    const originalValue = getValue(section, "text", "");
    const [decodedText, encoding] = decodeTextValue(originalValue);
    const parentName = `${section.name.split(".")[0]}]`;
    const siblings = sections.filter((item) => item.name === parentName || item.name.startsWith(`${parentName.slice(0, -1)}.`));
    candidates.push({ textSection: section, objectSections: siblings, decodedText, encoding });
  }

  if (candidates.length === 0) {
    throw new Error("ERR-EXO-TEMPLATE-001: テキストオブジェクトが見つかりません。");
  }
  const exact = candidates.find((candidate) => candidate.decodedText === "字幕テスト");
  const selected = exact ?? (candidates.length === 1 ? candidates[0] : candidates[0]);
  const parentSection = selected.objectSections.find((section) => !section.name.slice(1, -1).includes("."));
  if (!parentSection) {
    throw new Error("ERR-EXO-TEMPLATE-001: 親オブジェクトが見つかりません。");
  }
  return {
    speaker_id: speakerId,
    template_source: sourceName,
    object_sections: selected.objectSections,
    text_section_key: selected.textSection.name,
    placeholder_text: selected.decodedText,
    text_encoding: selected.encoding,
    file_encoding: fileEncoding,
    base_settings: Object.fromEntries(exedit.items),
    preview: {
      font: getValue(selected.textSection, "font", ""),
      size: getValue(selected.textSection, "size", getValue(selected.textSection, "繧ｵ繧､繧ｺ", "")),
      color: getValue(selected.textSection, "color", ""),
      color2: getValue(selected.textSection, "color2", ""),
      layer: getValue(parentSection, "layer", ""),
    },
  };
}

export function assignFrames(segments: Segment[], fps: number, speakerOrder: Record<string, number>): Segment[] {
  const sorted = [...segments].sort((a, b) => {
    const delta = a.start_sec - b.start_sec;
    if (delta !== 0) return delta;
    const dur = (a.end_sec - a.start_sec) - (b.end_sec - b.start_sec);
    if (dur !== 0) return dur;
    return (speakerOrder[a.speaker_id] ?? 9999) - (speakerOrder[b.speaker_id] ?? 9999);
  });
  const previousBySpeaker = new Map<string, Segment>();
  return sorted.map((segment, index) => {
    let startFrame = Math.round(segment.start_sec * fps) + 1;
    let endFrame = Math.max(startFrame, Math.round(segment.end_sec * fps));
    const prev = previousBySpeaker.get(segment.speaker_id);
    if (prev?.end_frame && startFrame <= prev.end_frame) {
      startFrame = prev.end_frame + 1;
      endFrame = Math.max(startFrame, endFrame);
    }
    const next = { ...segment, subtitle_id: `sub_${String(index + 1).padStart(6, "0")}`, start_frame: startFrame, end_frame: endFrame };
    previousBySpeaker.set(segment.speaker_id, next);
    return next;
  });
}

export function buildExo(project: ProjectPayload, speakers: ProjectSpeaker[], segments: Segment[]): string {
  const templateMap = new Map(speakers.map((speaker) => [speaker.speaker_id, speaker.template_meta]));
  const baseSettings = { ...speakers[0].template_meta.base_settings };
  baseSettings.width = String(project.width);
  baseSettings.height = String(project.height);
  baseSettings.rate = String(Number.isInteger(project.fps) ? project.fps : project.fps);
  baseSettings.audio_rate = String(project.audio_rate ?? 48000);
  baseSettings.audio_ch = String(project.audio_ch ?? 2);
  baseSettings.length = String(Math.max(...segments.map((segment) => segment.end_frame ?? 1), 1));

  const outputSections: ExoSection[] = [{ name: "[exedit]", items: Object.entries(baseSettings) }];
  segments.forEach((segment, objectIndex) => {
    const template = templateMap.get(segment.speaker_id);
    if (!template) return;
    for (const sectionPayload of template.object_sections) {
      const section: ExoSection = { name: renumberSectionName(sectionPayload.name, objectIndex), items: [...sectionPayload.items] };
      if (!section.name.slice(1, -1).includes(".")) {
        setValue(section, "start", String(segment.start_frame ?? 1));
        setValue(section, "end", String(segment.end_frame ?? 1));
        setValue(section, "layer", String(segment.base_layer ?? 1));
      }
      if (sectionPayload.name === template.text_section_key) {
        const originalValue = getValue(section, "text", "");
        setValue(section, "text", encodeTextValue(segment.text, template.text_encoding, originalValue));
      }
      outputSections.push(section);
    }
  });
  return renderExo(outputSections);
}

export function buildSrt(segments: Segment[]): string {
  return segments.map((segment, index) => `${index + 1}\n${formatSrtTime(segment.start_sec)} --> ${formatSrtTime(segment.end_sec)}\n${segment.text}`).join("\n\n") + (segments.length ? "\n" : "");
}

export function buildSegmentsJson(segments: Segment[]): string {
  return JSON.stringify({ segments }, null, 2);
}

function parseSections(content: string): ExoSection[] {
  const sections: ExoSection[] = [];
  let currentName: string | null = null;
  let currentItems: Array<[string, string]> = [];
  for (const raw of content.split(/\r?\n/u)) {
    const line = raw.replace(/\r/g, "");
    if (!line) continue;
    if (line.startsWith("[") && line.endsWith("]")) {
      if (currentName) sections.push({ name: currentName, items: currentItems });
      currentName = line;
      currentItems = [];
      continue;
    }
    if (currentName && line.includes("=")) {
      const [key, value] = line.split(/=(.*)/su, 2);
      currentItems.push([key, value]);
    }
  }
  if (currentName) sections.push({ name: currentName, items: currentItems });
  return sections;
}

function decodeTextValue(value: string): [string, string] {
  const stripped = value.trim();
  if (stripped && stripped.length % 2 === 0 && /^[0-9a-fA-F]+$/u.test(stripped)) {
    const bytes = Uint8Array.from(stripped.match(/../g)!.map((pair) => Number.parseInt(pair, 16)));
    const chunks: number[] = [];
    for (let index = 0; index < bytes.length; index += 2) {
      if (bytes[index] === 0 && bytes[index + 1] === 0) break;
      chunks.push(bytes[index], bytes[index + 1]);
    }
    return [new TextDecoder("utf-16le").decode(new Uint8Array(chunks)), "utf16le_hex"];
  }
  return [stripped, "plain"];
}

function encodeTextValue(text: string, encoding: string, originalValue: string): string {
  if (encoding !== "utf16le_hex") return text;
  const utf16 = encodeUtf16Le(text);
  const withTerminator = new Uint8Array(utf16.length + 2);
  withTerminator.set(utf16, 0);
  const originalLen = Math.floor(originalValue.trim().length / 2);
  const padded = originalLen > withTerminator.length ? padBytes(withTerminator, originalLen) : withTerminator;
  return Array.from(padded).map((value) => value.toString(16).padStart(2, "0")).join("");
}

function encodeUtf16Le(text: string): Uint8Array {
  const buffer = new Uint8Array(text.length * 2);
  let offset = 0;
  for (const char of text) {
    const code = char.charCodeAt(0);
    buffer[offset] = code & 0xff;
    buffer[offset + 1] = code >> 8;
    offset += 2;
  }
  return buffer.slice(0, offset);
}

function padBytes(bytes: Uint8Array, targetLength: number): Uint8Array {
  const next = new Uint8Array(targetLength);
  next.set(bytes, 0);
  return next;
}

function renderExo(sections: ExoSection[]): string {
  return `${sections.map((section) => `${section.name}\n${section.items.map(([key, value]) => `${key}=${value}`).join("\n")}`).join("\n")}\n`;
}

function renumberSectionName(name: string, index: number): string {
  const parts = name.slice(1, -1).split(".");
  parts[0] = String(index);
  return `[${parts.join(".")}]`;
}

function formatSrtTime(value: number): string {
  const totalMs = Math.max(0, Math.round(value * 1000));
  const hours = Math.floor(totalMs / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const millis = totalMs % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

function getValue(section: ExoSection, key: string, fallback: string): string {
  return section.items.find(([current]) => current === key)?.[1] ?? fallback;
}

function setValue(section: ExoSection, key: string, value: string) {
  const index = section.items.findIndex(([current]) => current === key);
  if (index >= 0) section.items[index] = [key, value];
  else section.items.push([key, value]);
}

function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}
