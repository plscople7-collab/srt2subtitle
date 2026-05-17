# AI字幕EXO生成ツール

話者ごとに分離済みの音声ファイルとサンプル `.exo` を登録し、AviUtl 向けの字幕 `.exo` `.srt` `.json` を生成するローカル Web アプリです。

## 現状

- フロントエンド: プロジェクト作成、話者登録、字幕確認、本文修正、各形式出力
- バックエンド: プロジェクト保存、テンプレート EXO 抽出、字幕分割、フレーム化、EXO/SRT/JSON 生成
- 音声認識: Python 3.12 + `openai-whisper` の自動文字起こし、または認識済み JSON の読み込みに対応

## sidecar JSON 形式

音声認識エンジン未接続のため、現時点では以下形式の JSON を話者登録時に一緒に渡すか、各音声ファイルの横に置くと文字起こし入力として使えます。

```json
[
  {
    "start_sec": 0.0,
    "end_sec": 2.4,
    "text": "これはテストです。",
    "confidence": 0.98
  }
]
```

候補ファイル名:

- `sample.wav.segments.json`
- `sample.segments.json`
- `sample.json`

UI では話者ごとに `認識JSON` を指定できます。今回の `sample.json` はここにそのまま使えます。

## 自動文字起こし

- バックエンド本体は Python 3.14 で動作可能
- 自動文字起こしは `py -3.12` と `.deps312` 内の `openai-whisper` を使って別プロセス実行
- Whisper モデルはローカルキャッシュが無ければ取得が必要
- この環境では、UI 経由の初回自動ダウンロードは安定しないことがある
- その場合は、先に以下のように 1 回だけ事前取得してから UI を使う

```bash
py -3.12 backend\asr_worker.py --audio "20260515テスト用.wav" --model base --language ja
```

- 同じ音声ファイルを同じ認識モードで再実行した場合は、アップロード済み音声の横にあるキャッシュ JSON を再利用する
- 認識モードは `最速=tiny`, `高速=base`, `標準=small`, `高精度=medium`

## 起動

```bash
python -m backend.main
```

ブラウザで `http://127.0.0.1:8000` を開きます。

## ディレクトリ

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
  validators.py
data/
  projects/
```

## v0.2 draft path

- alpha route: `http://127.0.0.1:8000/`
- integrated studio route: `http://127.0.0.1:8000/studio`
- v0.2 route: `http://127.0.0.1:8000/v2`
- local transcriber route: `http://127.0.0.1:8000/transcriber`

`/studio` is the one-screen local path. Set speakers, presets, and audio/video files, then run one action to transcribe, convert, and download the generated `.exo`.

`/v2` is the new SRT based conversion path. It does not run speech recognition.
Provide one `.srt` and one template `.exo` for each speaker, then export merged `.exo`, `.srt`, and `.json`.

`/transcriber` is the local speech-to-SRT path. It accepts audio/video files, runs local Whisper through the Python worker, and exports one `.srt` plus one `.segments.json` per input file. Use the generated `.srt` files as `/v2` speaker inputs.

If Whisper is not installed for Python 3.12, run:

```powershell
powershell -ExecutionPolicy Bypass -File tools\setup_local_transcriber.ps1
```

### v2 local project bundle

In `/v2`, you can save the current project as one `.project.json` file.
This bundle includes:

- project settings
- per-speaker subtitle rules
- per-speaker SRT
- per-speaker template EXO

You can load the saved `.project.json` later and run the conversion again without reselecting the source files.

### v2 sample files

Sample SRT files for `/v2` are under [`samples/`](C:\Users\kinok\OneDrive\ドキュメント\プログラミング_code\字幕生成\samples).
