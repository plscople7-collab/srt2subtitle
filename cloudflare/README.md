# Cloudflare v0.2

`cloudflare/` は `v0.2` の Cloudflare Workers 構成です。

目的は次の 2 点です。

- 静的 UI を Cloudflare 上で配信する
- `SRT + 話者別 EXO テンプレート -> AviUtl 用 EXO` の変換を Worker で実行する

現時点では認証なしでも使える前提で進めています。R2 は使わず、保存系は D1 のみを前提にしています。

## 現在できること

- `/` で Cloudflare 版の変換 UI を開く
- `/api/health` で疎通確認する
- `/api/v2/template-preview` で見本 EXO の preview 情報を取る
- `/api/v2/convert` で SRT / EXO から EXO / SRT / JSON / preview.html を返す
- `/api/v2/projects`
- `/api/v2/presets`

`projects` と `presets` は D1 の土台だけ先に置いています。現状の公開 UI は「変換中心」で、共有保存 UI はまだ最小です。

## ディレクトリ

- `wrangler.jsonc`: Worker 本体と Assets、D1 binding の設定
- `schema.sql`: D1 schema
- `src/index.ts`: API 入口
- `src/lib/`: SRT parser / EXO parser / EXO writer / preview / split のロジック
- `public/index.html`: 公開 UI
- `public/app.js`: 変換 UI のフロント処理
- `public/style.css`: 公開 UI のスタイル

## ローカル確認

```bash
cd cloudflare
npm install
npm run dev
```

TypeScript の構文確認:

```bash
cd cloudflare
npm run check
```

## Cloudflare 連携

GitHub 連携、D1 作成、`schema.sql` 適用、`wrangler.jsonc` の埋め方は
[SETUP_GITHUB_AND_D1.md](C:\Users\kinok\OneDrive\ドキュメント\プログラミング_code\字幕生成\cloudflare\SETUP_GITHUB_AND_D1.md)
を参照してください。

## 次にやること

- `projects` / `presets` の公開 UI を Worker 側 API に寄せる
- 変換 warning の種類を増やす
- 必要になった時点で認証を足す
