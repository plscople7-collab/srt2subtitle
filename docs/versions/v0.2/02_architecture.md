# v0.2 アーキテクチャ

## 全体構成

```text
Local Transcriber
  音声/動画
  ↓
  Whisper等
  ↓
  speaker_a.srt / speaker_b.srt

Web Shared Converter
  Pages: UI
  Workers: API / 変換
  D1: メタデータ
  R2: テンプレート・SRT原本
  ↓
  output.exo
```

## ローカル側

ローカル側の責務:

- 音声入力
- 音声認識
- SRT出力

ローカル側の非責務:

- プロジェクト共有
- プリセット共有
- EXO統合

## Web側

Web側の責務:

- ログイン
- プロジェクト管理
- 話者プリセット管理
- テンプレートEXO管理
- SRTアップロード
- SRT解析
- EXO生成

Web側の非責務:

- 音声認識
- GPU利用
- モデル管理

## データフロー

1. ローカルでSRTを作る
2. Webでプロジェクトを開く
3. 話者ごとにSRTとテンプレートEXOを紐づける
4. WorkerがSRTを解析する
5. WorkerがテンプレートEXOを複製する
6. フレーム化して全話者分を統合する
7. `output.exo` を返す

## 採用理由

- 音声認識の重さをWebから切り離せる
- Cloudflare Workers向きの軽い構成になる
- 身内共有したい対象だけをWebで持てる
- 見本EXOを中心にしたAviUtl特化の価値を保てる
