# srt2subtitle

音声/動画からSRTを作り、話者別EXOテンプレートへ流し込んでAviUtl用EXOを生成するローカルWebツールです。

## 現行ルート

- `/studio`: 音声/動画、話者設定、プリセット、EXO出力を1画面で扱う統合画面
- `/transcriber`: 音声/動画からSRT/JSONを生成するローカル文字起こし画面
- `/v2`: SRTと見本EXOからEXOを生成する変換画面

`/` は `/studio` と同じ統合画面を表示します。

## 起動

```powershell
python -m backend.main --port 8002
```

ブラウザで以下を開きます。

```text
http://127.0.0.1:8002/
```

## Whisper セットアップ

Python 3.12 側にWhisperが無い場合は以下を実行します。

```powershell
powershell -ExecutionPolicy Bypass -File tools\setup_local_transcriber.ps1
```

確認だけ行う場合:

```powershell
powershell -ExecutionPolicy Bypass -File tools\check_local_transcriber.ps1
```

## ベータ配布パッケージ作成

身内配布用のZIPと自己解凍PowerShellを作る場合は以下を実行します。

```powershell
powershell -ExecutionPolicy Bypass -File tools\build_beta_package.ps1 -Version beta-0.2
```

生成物は `dist/` に出力されます。

- `srt2subtitle-*.zip`: ZIP配布用。展開後に `起動.bat` を押す
- `srt2subtitle-*自己解凍.bat`: 1ファイル配布用。押すと展開フォルダが開く

受け取った側は `起動.bat` を実行します。
音声認識も使う場合のみ、初回に `音声認識_初回セットアップ.bat` を実行します。

## 基本手順

1. `/studio` を開く
2. 話者ごとに音声/動画を指定する
3. 話者プリセットを選ぶ、または見本EXOを指定する
4. `EXO自動保存` を押す
5. 生成されたEXOをAviUtlへ読み込む

手元でSRTを修正したい場合は、`/transcriber` でSRTだけ作成し、修正後に `/v2` へ渡します。

## データ保存

- `data/v2/`: ローカルプリセットとプロジェクト保存
- `data/transcriber_cache/`: 音声認識キャッシュ
- `.tmp/`: 一時ファイル

これらはGit管理対象外です。

## 仕様

詳細仕様は `docs/versions/v0.2/` を参照してください。
旧alpha資料は `docs/versions/v0.1-alpha/` と `docs/references/original_spec_v0.1.md` に残していますが、現行実装の主系列ではありません。
