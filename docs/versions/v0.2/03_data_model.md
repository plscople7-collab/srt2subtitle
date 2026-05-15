# v0.2 データモデル

## Project

```json
{
  "project_id": "prj_xxx",
  "name": "episode_01",
  "fps": 60,
  "width": 1920,
  "height": 1080,
  "output_name": "episode_01_subtitle",
  "created_by": "user_a",
  "updated_at": "2026-05-15T12:00:00Z"
}
```

## ProjectSpeaker

```json
{
  "speaker_id": "spk_001",
  "project_id": "prj_xxx",
  "display_name": "話者A",
  "preset_id": "preset_xxx",
  "base_layer": 2,
  "subtitle_rule": {
    "max_chars_per_line": 18,
    "max_lines": 2,
    "reflow": true
  },
  "template_asset_id": "asset_tpl_xxx",
  "srt_asset_id": "asset_srt_xxx",
  "sort_order": 1
}
```

## SpeakerPreset

```json
{
  "preset_id": "preset_xxx",
  "name": "話者A標準",
  "subtitle_rule": {
    "max_chars_per_line": 18,
    "max_lines": 2,
    "reflow": true
  },
  "base_layer": 2,
  "template_asset_id": "asset_tpl_xxx",
  "template_preview_meta": {
    "font": "メイリオ",
    "size": 98,
    "color": "#ffffff",
    "outline": "#ff0061"
  }
}
```

## Asset

```json
{
  "asset_id": "asset_xxx",
  "kind": "template_exo",
  "filename": "speaker_a_template.exo",
  "storage_key": "templates/team_xxx/asset_xxx.exo",
  "content_hash": "sha256:..."
}
```

## Export Payload

```json
{
  "project": {},
  "speakers": [],
  "assets": {
    "templates": [],
    "srts": []
  }
}
```

## 方針

- D1にはメタデータを置く
- R2には原本を置く
- プリセットは共有用、プロジェクトは案件用として分ける
- プロジェクト内では、プリセット適用後の個別上書きを許可する
