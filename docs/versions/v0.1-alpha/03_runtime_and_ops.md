# v0.1-alpha 実行と運用

## 起動手順

1. ローカルでバックエンドを起動する
2. ブラウザで `http://127.0.0.1:8000` を開く

現行の基本起動は以下です。

```bash
python -m backend.main
```

## Whisper モデル事前取得

UI経由の初回モデル取得は安定しないことがあるため、必要モデルは事前取得を前提にします。

例:

```bash
py -3.12 backend\asr_worker.py --audio "20260515テスト用.wav" --model base --language ja
```

利用可能モデル:

- `tiny`
- `base`
- `small`
- `medium`

## 認識キャッシュ

- 同じ音声
- 同じモデル

の組み合わせでは、認識結果をキャッシュJSONとして保存します。

保存場所の例:

```text
data/projects/<project_id>/uploads/<speaker_id>/
  audio_001_xxx.wav
  audio_001_xxx.whisper.base.json
```

## プロジェクト保存場所

プロジェクトは以下に保存します。

```text
data/projects/<project_id>/
  project.json
  uploads/
  exports/
```

主な内容:

- `project.json`: 設定、話者、字幕セグメント
- `uploads/`: 音声、テンプレート、認識JSON、Whisperキャッシュ
- `exports/`: 生成物

## プリセット保存場所

プリセットは以下に保存します。

```text
data/presets/<preset_id>/
  preset.json
  template_xxx.exo
```

## 運用上の注意

- ブラウザは必ず `http://127.0.0.1:8000` を開く
- `file://` でHTMLを直接開く使い方は主経路にしない
- モデル未取得時は、先にCLIで1回だけ温める
- 同一入力での再試行はキャッシュを活用する

## α版の保守方針

- 現行挙動の確認用として残す
- 大きな構成変更は `v0.2` 側で扱う
- α版への修正は、必要最小限の維持に留める
