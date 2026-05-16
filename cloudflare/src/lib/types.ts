export type SubtitleRule = {
  max_chars_per_line: number;
  max_lines: number;
  min_duration_sec: number;
  max_duration_sec: number;
};

export type Segment = {
  subtitle_id?: string;
  speaker_id: string;
  start_sec: number;
  end_sec: number;
  text: string;
  warnings: string[];
  words?: Array<{ text: string; start_sec: number; end_sec: number }>;
  base_layer?: number;
  start_frame?: number;
  end_frame?: number;
};

export type ProjectSpeaker = {
  speaker_id: string;
  display_name: string;
  base_layer: number;
  subtitle_rule: SubtitleRule;
  template_exo: string;
  template_meta: ExoTemplateMeta;
};

export type ProjectPayload = {
  name: string;
  fps: number;
  width: number;
  height: number;
  output_name: string;
  audio_rate?: number;
  audio_ch?: number;
};

export type ExoSection = {
  name: string;
  items: Array<[string, string]>;
};

export type ExoTemplateMeta = {
  speaker_id: string;
  template_source: string;
  object_sections: ExoSection[];
  text_section_key: string;
  placeholder_text: string;
  text_encoding: string;
  file_encoding: string;
  base_settings: Record<string, string>;
  preview: Record<string, string>;
};

export type WorkerEnv = {
  ASSETS: Fetcher;
  DB?: D1Database;
  ASSET_BUCKET?: R2Bucket;
};
