import type { Segment } from "./types";

const TIMECODE = /^\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*$/;

export function parseSrt(content: string, speakerId: string): Segment[] {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!normalized) {
    throw new Error("ERR-SRT-001: SRT が空です。");
  }
  const blocks = normalized.split(/\n\s*\n/g);
  return blocks.map((block, index) => parseBlock(block, index + 1, speakerId));
}

function parseBlock(block: string, blockIndex: number, speakerId: string): Segment {
  const lines = block.split("\n").map((line) => line.trimEnd()).filter((line) => line.trim() !== "");
  if (lines.length < 2) {
    throw new Error(`ERR-SRT-001: ${blockIndex} ブロックが不正です。`);
  }
  let cursor = 0;
  if (/^\d+$/.test(lines[0] ?? "")) {
    cursor = 1;
  }
  const match = TIMECODE.exec(lines[cursor] ?? "");
  if (!match) {
    throw new Error(`ERR-SRT-001: ${blockIndex} ブロックのタイムコードが不正です。`);
  }
  const textLines = lines.slice(cursor + 1);
  if (textLines.length === 0) {
    throw new Error(`ERR-SRT-001: ${blockIndex} ブロックに本文がありません。`);
  }
  const start_sec = parseTimecode(match[1]);
  const end_sec = parseTimecode(match[2]);
  if (start_sec >= end_sec) {
    throw new Error(`ERR-SRT-001: ${blockIndex} ブロックで開始時刻と終了時刻が逆転しています。`);
  }
  return {
    speaker_id: speakerId,
    start_sec,
    end_sec,
    text: textLines.join(" ").replace(/[ \t]{2,}/g, " ").trim(),
    warnings: [],
    words: [],
  };
}

function parseTimecode(value: string): number {
  const [h, m, s] = value.replace(",", ".").split(":");
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}
