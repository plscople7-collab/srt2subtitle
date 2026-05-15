# v0.2 API

## 認証

### `POST /api/auth/login`

目的:

- 身内限定利用のためのログイン

## プロジェクト

### `GET /api/projects`

目的:

- 保存済みプロジェクト一覧取得

### `POST /api/projects`

目的:

- 新規プロジェクト作成

### `GET /api/projects/:id`

目的:

- プロジェクト詳細取得

### `PUT /api/projects/:id`

目的:

- プロジェクト更新

## 話者

### `POST /api/projects/:id/speakers`

目的:

- 話者追加

### `PUT /api/projects/:id/speakers/:speakerId`

目的:

- 話者設定更新

## プリセット

### `GET /api/presets`

目的:

- 話者プリセット一覧取得

### `POST /api/presets`

目的:

- プリセット作成

### `PUT /api/presets/:id`

目的:

- プリセット更新

## アセット

### `POST /api/assets/template`

目的:

- テンプレートEXOアップロード

### `POST /api/assets/srt`

目的:

- SRTアップロード

## 変換

### `POST /api/projects/:id/export-exo`

目的:

- プロジェクト設定と話者設定から統合EXOを生成する

入力:

- プロジェクトID
- 話者設定
- 各話者のSRT参照
- 各話者のテンプレート参照

出力:

- `output.exo`
- `merged.json`
- 任意のプレビュー用データ

## API方針

- v0.2ではWeb APIを唯一の共有窓口にする
- 音声ファイルアップロードAPIは持たない
- SRTを唯一の音声認識結果入力とする
