import type { Segment, SubtitleRule } from "./types";

const BREAK_RE = /(?<=[。！？!?])/u;

export function splitSegments(segments: Segment[], rule: SubtitleRule): Segment[] {
  const pieces = segments.flatMap((segment) => splitSegment(segment, rule));
  return mergeShortSegments(pieces, rule);
}

function splitSegment(segment: Segment, rule: SubtitleRule): Segment[] {
  const text = String(segment.text).trim();
  const duration = segment.end_sec - segment.start_sec;
  const maxCharsTotal = rule.max_chars_per_line * rule.max_lines;
  const maxDuration = rule.max_duration_sec;
  const warnings: string[] = [];

  if (text.length <= maxCharsTotal && duration <= maxDuration) {
    return [finalizeSegment(segment, text, warnings, rule)];
  }

  const tokens = tokenizeText(text);
  let chunks = packTokens(tokens, maxCharsTotal);
  if (chunks.length === 0) {
    chunks = [text];
  }
  if (chunks.some((chunk) => chunk.length > maxCharsTotal)) {
    chunks = chunks.flatMap((chunk) => (chunk.length <= maxCharsTotal ? [chunk] : forceSplit(chunk, rule.max_chars_per_line)));
    warnings.push("WARN-SUBTITLE-LONG-001");
  }

  const totalChars = Math.max(chunks.reduce((sum, chunk) => sum + Math.max(chunk.length, 1), 0), 1);
  let cursor = segment.start_sec;
  return chunks.map((chunk, index) => {
    const proportion = Math.max(chunk.length, 1) / totalChars;
    const pieceDuration = duration * proportion;
    const end_sec = index === chunks.length - 1 ? segment.end_sec : cursor + pieceDuration;
    const result = finalizeSegment({ ...segment, start_sec: cursor, end_sec }, chunk, [...warnings], rule);
    cursor = end_sec;
    return result;
  });
}

function tokenizeText(text: string): string[] {
  const primary = text.split(BREAK_RE).map((token) => token.trim()).filter(Boolean);
  if (primary.length > 1) {
    return primary;
  }
  const secondary = text.split(/\s+/).map((token) => token.trim()).filter(Boolean);
  return secondary.length > 1 ? secondary : [text];
}

function packTokens(tokens: string[], maxCharsTotal: number): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const token of tokens) {
    const candidate = `${current}${token}`.trim();
    if (current && candidate.length > maxCharsTotal) {
      chunks.push(current.trim());
      current = token;
    } else {
      current = candidate;
    }
  }
  if (current.trim()) {
    chunks.push(current.trim());
  }
  return chunks;
}

function forceSplit(text: string, maxCharsPerLine: number): string[] {
  const width = Math.max(maxCharsPerLine, 1);
  const chunks: string[] = [];
  for (let cursor = 0; cursor < text.length; cursor += width) {
    const chunk = text.slice(cursor, cursor + width).trim();
    if (chunk) chunks.push(chunk);
  }
  return chunks;
}

function mergeShortSegments(segments: Segment[], rule: SubtitleRule): Segment[] {
  const merged: Segment[] = [];
  const maxCharsTotal = rule.max_chars_per_line * rule.max_lines;
  for (const segment of segments) {
    const duration = segment.end_sec - segment.start_sec;
    if (merged.length > 0 && duration < rule.min_duration_sec) {
      const prev = merged[merged.length - 1];
      const gap = segment.start_sec - prev.end_sec;
      const combinedText = `${prev.text.replace(/\n/g, "")}${segment.text.replace(/\n/g, "")}`;
      const combinedDuration = segment.end_sec - prev.start_sec;
      if (gap <= 0.3 && combinedText.length <= maxCharsTotal && combinedDuration <= rule.max_duration_sec) {
        prev.end_sec = segment.end_sec;
        prev.text = applyLineBreaks(combinedText, rule);
        prev.warnings = [...new Set([...prev.warnings, ...segment.warnings])];
        continue;
      }
      segment.warnings = [...new Set([...segment.warnings, "WARN-SUBTITLE-SHORT-001"])];
    }
    merged.push(segment);
  }
  return merged;
}

function finalizeSegment(segment: Segment, text: string, warnings: string[], rule: SubtitleRule): Segment {
  return {
    ...segment,
    text: applyLineBreaks(text, rule),
    warnings: [...new Set(warnings)].sort(),
  };
}

function applyLineBreaks(text: string, rule: SubtitleRule): string {
  const trimmed = text.trim();
  if (rule.max_lines <= 1 || trimmed.length <= rule.max_chars_per_line) {
    return trimmed;
  }
  const linesNeeded = Math.min(rule.max_lines, Math.max(1, Math.ceil(trimmed.length / rule.max_chars_per_line)));
  const targetLen = Math.max(1, Math.round(trimmed.length / linesNeeded));
  const lines: string[] = [];
  let remaining = trimmed;
  while (lines.length < linesNeeded - 1 && remaining.length > rule.max_chars_per_line) {
    const splitAt = findBreakpoint(remaining, targetLen, rule.max_chars_per_line);
    lines.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  lines.push(remaining);
  return lines.filter(Boolean).join("\n");
}

function findBreakpoint(text: string, targetLen: number, maxChars: number): number {
  const limit = Math.min(text.length - 1, maxChars);
  const candidates: number[] = [];
  for (let index = 1; index <= limit; index += 1) {
    if ([" ", "　", "、", "。", "！", "？", "!", "?"].includes(text[index] ?? "")) {
      candidates.push(index);
    }
  }
  if (candidates.length === 0) return limit;
  return candidates.reduce((best, current) => Math.abs(current - targetLen) < Math.abs(best - targetLen) ? current : best);
}
