# v0.1-alpha 概要

## 位置づけ

`v0.1-alpha` は、現在のローカルWeb実装の実態を整理した版です。  
初期構想の理想仕様ではなく、実装済みの画面、API、制約、運用方法を記録するスナップショットとして扱います。

## 目的

- 分離済みの話者別音声、または認識済みJSONを入力する
- 話者別の見本 `.exo` をテンプレートとして取り込む
- 文字起こし結果とテンプレートを使って AviUtl 向け `.exo` を生成する
- `.srt` と `.json` も確認用に同時出力する

## 現行構成

構成はローカルWebアプリです。

```text
frontend/
  index.html
  app.js
  style.css

backend/
  main.py
  transcribe.py
  subtitle_splitter.py
  exo_parser.py
  exo_writer.py
  project_store.py
  preset_store.py
  validators.py
```

画面はブラウザで開き、ローカルHTTPサーバーをPythonで起動して使います。

## 対応入力

- 音声ファイル
  - `wav`
  - `mp3`
  - `m4a`
  - `aac`
  - `flac`
  - `ogg`
  - `opus`
  - `wma`
  - `webm`
  - `mp4`
- テンプレート `.exo`
- 任意で認識済み `.json`

## できること

- プロジェクト作成
- プロジェクト保存
- 保存済みプロジェクト読込
- 話者カード追加
- 話者ごとの字幕ルール設定
- 話者プリセット保存
- 話者プリセット適用
- 話者ごとの出力レイヤー指定
- Whisper によるローカル文字起こし
- 認識済みJSONの利用
- `.exo` `.srt` `.json` 出力

## できないこと

- Web共有
- 複数ユーザー間でのプロジェクト共有
- プリセット共有
- Cloudflare Workers上での運用
- 音声認識をブラウザ側だけで完結させること
- 初回Whisperモデル取得の安定した自動化
- インストーラ付きの簡易配布

## 注意

この版は残置対象です。  
以後の本命仕様は `docs/versions/v0.2/` に切り出し、こちらは現行挙動の確認用として維持します。
