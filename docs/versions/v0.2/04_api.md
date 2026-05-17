# v0.2 API

## 方針
現行実装のAPIはローカル利用を前提に、音声認識、SRT→EXO変換、プリセット保存に絞ります。

旧alphaのプロジェクト作成、話者登録、旧式の文字起こし、旧式EXO出力APIは破棄します。

## Health

### `GET /api/health`
目的:

- ローカルAPIが起動しているか確認する

出力:

- `ok`
- `runtime`
- `version`

## ローカル文字起こし

### `POST /api/transcriber/transcribe`
目的:

- 音声/動画からSRTと認識JSONを生成する

入力:

- `engine`: 現状は `whisper`
- `model`: `tiny` / `base` / `small` / `medium`
- `language`: 既定値 `ja`
- `media_file`: 音声/動画ファイル。複数可

出力:

- `outputs[].srt_content`
- `outputs[].json_content`
- `outputs[].segment_count`
- `outputs[].cached`

## SRT→EXO変換

### `POST /api/v2/convert`
目的:

- 話者ごとのSRTと見本EXOから、統合EXOを生成する

入力:

- `project_json`
- `speaker_count`
- `speaker_{n}_display_name`
- `speaker_{n}_subtitle_rule_json`
- `speaker_{n}_base_layer`
- `speaker_{n}_srt_file`
- `speaker_{n}_template_exo`

出力:

- `exo_content_b64`
- `srt_content`
- `json_content`
- `segments`
- `analysis`

## プリセット

### `GET /api/v2/presets`
目的:

- ローカル保存済みの話者プリセット一覧を取得する

### `GET /api/v2/presets/:id`
目的:

- 指定プリセットの詳細を取得する

### `POST /api/v2/presets`
目的:

- 話者プリセットを作成または更新する

入力:

- `preset_id`: 更新時のみ
- `name`
- `subtitle_rule`
- `base_layer`
- `template_exo`

### `POST /api/v2/presets/delete`
目的:

- 話者プリセットを削除する

入力:

- `preset_id`

## ローカルプロジェクト

### `GET /api/v2/projects`
目的:

- ローカル保存済みプロジェクト一覧を取得する

### `GET /api/v2/projects/:id`
目的:

- 指定プロジェクトの詳細を取得する

### `POST /api/v2/projects`
目的:

- `/v2` 用のローカルプロジェクトを保存する

## テンプレート確認

### `POST /api/v2/template-preview`
目的:

- 見本EXOからフォント、サイズ、色、レイヤーなどの確認用メタ情報を抽出する

入力:

- `template_exo`

出力:

- `template_preview_meta`
- `file_encoding`
