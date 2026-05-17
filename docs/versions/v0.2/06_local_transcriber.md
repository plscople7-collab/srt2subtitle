# v0.2 ローカル音声認識アプリ

## 目的
ローカル音声認識アプリの責務は、音声または動画から `.srt` を生成することに限定します。

Web側のSRT→EXO変換とは分離し、重いWhisper実行、モデル取得、ffmpeg依存、CPU/GPU負荷をローカルPC内に閉じます。

## 現在の実装
ローカルバックエンドに以下を追加しています。

- 画面: `GET /transcriber`
- 統合画面: `GET /studio`
- API: `POST /api/transcriber/transcribe`
- 入力: 音声/動画ファイル複数、エンジン、モデル、言語
- 出力: ファイルごとの `.srt` と `.segments.json`

生成した `.srt` は `/v2` の話者SRT入力へ渡します。
`/studio` では、話者設定とプリセットを同じ画面で指定し、音声認識からEXO保存までを1操作で実行します。

## 入力仕様
対応形式は以下です。

- `.wav`
- `.mp3`
- `.m4a`
- `.aac`
- `.flac`
- `.ogg`
- `.opus`
- `.wma`
- `.webm`
- `.mp4`
- `.mov`
- `.mkv`

話者分離は行いません。話者ごとに分離済みの音声、または話者別に切り出した動画を入力する前提です。

## Whisper運用
初期実装は既存の `backend/asr_worker.py` を利用します。

- Python起動: `py -3.12`
- 実行ライブラリ: `openai-whisper`
- ffmpeg: `imageio-ffmpeg` 由来の実行ファイルを `.tmp/ffmpeg-bin/` に配置
- モデル: `tiny` / `base` / `small` / `medium`
- 言語: 既定値 `ja`

初回はWhisperモデルの取得が入るため時間がかかります。ネットワークやWhisper側の取得元が不安定な場合は、事前にCLIで一度実行してモデルをローカルキャッシュへ入れます。

依存関係の確認と導入は以下を使います。

```powershell
powershell -ExecutionPolicy Bypass -File tools\check_local_transcriber.ps1
powershell -ExecutionPolicy Bypass -File tools\setup_local_transcriber.ps1
```

```bash
py -3.12 backend\asr_worker.py --audio "20260515テスト用.wav" --model base --language ja
```

## SRT出力契約
SRTは以下の契約で出力します。

- 1入力ファイルにつき1SRT
- SRT番号は1始まり
- 時刻は `HH:MM:SS,mmm --> HH:MM:SS,mmm`
- 本文はWhisperのセグメント本文をそのまま使う
- 字幕の再分割、文字数制限、レイヤー割当は `/v2` 側で行う

JSONはデバッグと再利用用です。Web変換の主入力にはしません。

## キャッシュ
同一ファイルの再実行を軽くするため、以下のキーで認識JSONを保存します。

```text
sha256(audio_bytes) + engine + model + language
```

保存先は `data/transcriber_cache/` です。`data/` はGit管理対象外です。

## 非責務
ローカル音声認識アプリでは以下を扱いません。

- EXO生成
- 話者プリセット管理
- プロジェクト共有
- 話者分離
- 字幕デザイン編集
- SRTの文字数再分割

これらはWeb側、または別工程の責務です。
