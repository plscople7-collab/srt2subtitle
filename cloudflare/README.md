# Cloudflare v0.2

`cloudflare/` は `v0.2` の Pages + Workers 実装用ディレクトリです。

目的:

- 静的 UI を Cloudflare 上で配信する
- `SRT + 話者別 EXO テンプレート -> EXO` の変換 API を Worker に載せる
- プロジェクト / プリセットは D1 で共有する
- テンプレートや将来の SRT 保管は R2 を前提にする

## 含めたもの

- `wrangler.jsonc`: Workers Assets + API の構成
- `schema.sql`: D1 の最小スキーマ
- `src/index.ts`: Worker 入口
- `src/lib/`: SRT / EXO / preview の純粋関数
- `public/index.html`: 最低限のルート確認ページ

## ローカル開発

```bash
cd cloudflare
npm install
npm run dev
```

## GitHub / Cloudflare 接続

実際の接続手順は [SETUP_GITHUB_AND_D1.md](C:\Users\kinok\OneDrive\ドキュメント\プログラミング_code\字幕生成\cloudflare\SETUP_GITHUB_AND_D1.md) を参照してください。

最初のゴールは次の 3 点です。

- GitHub 連携で `main` push 時に自動 deploy される
- `/api/health` が返る
- D1 / R2 binding が wrangler 設定に入る

GitHub 側では [.github/workflows/cloudflare-check.yml](C:\Users\kinok\OneDrive\ドキュメント\プログラミング_code\字幕生成\.github\workflows\cloudflare-check.yml) を追加してあり、`cloudflare/` 配下の TypeScript チェックが走るようにしています。

## 次の実装対象

- 認証の追加
- D1 / R2 の実 ID 反映
- `frontend/v2` を Worker 配信用 UI へ移植
- プロジェクト / プリセットの API 連携
