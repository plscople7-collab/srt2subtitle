# Cloudflare 接続手順

この手順は `plscople7-collab/srt2subtitle` を Cloudflare Workers に GitHub 連携する前提です。

対象 URL:

- Worker: [https://srt2subtitle-v02.plscople7.workers.dev/](https://srt2subtitle-v02.plscople7.workers.dev/)

## 1. GitHub 連携

1. Cloudflare ダッシュボードを開く
2. `Workers & Pages` を開く
3. `Create` か `Import a repository` を選ぶ
4. GitHub 連携が未設定なら `Connect GitHub` を押す
5. GitHub App `Cloudflare Workers and Pages` を許可する
6. リポジトリは `plscople7-collab/srt2subtitle` のみに絞る

## 2. Worker の import

1. リポジトリ一覧から `plscople7-collab/srt2subtitle` を選ぶ
2. Root directory に `cloudflare` を入れる
3. Build configuration は `wrangler.jsonc` を使う
4. Worker name は `srt2subtitle-v02` に合わせる
5. Branch はまず `main` を指定する

この時点では D1 / R2 はまだ未設定でよいです。

## 3. 最初の deploy 確認

Deploy 後に以下を開きます。

- `https://srt2subtitle-v02.plscople7.workers.dev/`
- `https://srt2subtitle-v02.plscople7.workers.dev/api/health`

期待値:

- ルートは `cloudflare/public/index.html` が返る
- `/api/health` は `{"ok": true, "runtime": "cloudflare-worker"}` を返す

## 4. D1 作成

Cloudflare ダッシュボードで:

1. `Storage & Databases`
2. `D1 SQL Database`
3. `Create`
4. Database name を `srt2subtitle` にする

作成後に `database_id` を控えます。

## 5. schema.sql 適用

ローカルで以下を実行します。

```bash
cd cloudflare
npm install
npx wrangler d1 execute srt2subtitle --remote --file=schema.sql
```

`--remote` を付けるのは本番 D1 に流すためです。

## 6. wrangler.jsonc へ D1 binding 追加

[wrangler.jsonc](C:\Users\kinok\OneDrive\ドキュメント\プログラミング_code\字幕生成\cloudflare\wrangler.jsonc) のコメント部を実値で埋めます。

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "srt2subtitle",
    "database_id": "ここに実 database_id"
  }
]
```

## 7. R2 作成

Cloudflare ダッシュボードで:

1. `Storage & Databases`
2. `R2`
3. `Create bucket`
4. Bucket name を `srt2subtitle-assets` にする

その後 [wrangler.jsonc](C:\Users\kinok\OneDrive\ドキュメント\プログラミング_code\字幕生成\cloudflare\wrangler.jsonc) に以下を追加します。

```jsonc
"r2_buckets": [
  {
    "binding": "ASSET_BUCKET",
    "bucket_name": "srt2subtitle-assets"
  }
]
```

## 8. 再 deploy

`main` に push するだけでも再 deploy されます。

ローカルから手動 deploy するなら:

```bash
cd cloudflare
npx wrangler deploy
```

## 9. この段階で確認するもの

- `/api/health`
- `/api/v2/projects`
- `/api/v2/presets`

最初は空配列でよいです。

## 10. まだ未完了の部分

この段階ではまだ以下は未移植です。

- Worker 側の完全な `POST /api/v2/convert`
- `frontend/v2` の Cloudflare 側 UI 反映
- 認証
- R2 を使った実ファイル保管

つまり最初の目標は:

- GitHub 連携
- Worker 自動 deploy
- D1 / R2 binding 接続

までです。
