# Cloudflare 接続手順

この手順は `plscople7-collab/srt2subtitle` を Cloudflare Workers に GitHub 連携する前提です。

対象 URL:

- Worker: [https://srt2subtitle-v02.plscople7.workers.dev/](https://srt2subtitle-v02.plscople7.workers.dev/)

## 方針

- 初期版は `D1 のみ` で進める
- `R2 は使わない`
- SRT / EXO / preview 用メタデータは D1 の `payload_json` に含める

R2 は使用量課金サービスなので、支払方法設定が必要です。  
今の v0.2 は小さいテキスト資産しか持たないので、まずは D1 のみで十分です。

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

この時点では D1 はまだ未設定でよく、R2 は不要です。

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

## 7. 再 deploy

`main` に push するだけでも再 deploy されます。

ローカルから手動 deploy するなら:

```bash
cd cloudflare
npx wrangler deploy
```

## 8. この段階で確認するもの

- `/api/health`
- `/api/v2/projects`
- `/api/v2/presets`

最初は空配列でよいです。

## 9. まだ未完了の部分

この段階ではまだ以下は未移植です。

- Worker 側の完全な `POST /api/v2/convert`
- `frontend/v2` の Cloudflare 側 UI 反映
- 認証
- R2 を使った実ファイル保管

つまり最初の目標は:

- GitHub 連携
- Worker 自動 deploy
- D1 binding 接続

までです。

## R2 を後回しにする理由

今の v0.2 で扱うのは次のような小さいテキスト資産です。

- プロジェクト JSON
- 話者ごとの SRT
- テンプレート EXO
- preview 用メタデータ

この規模なら D1 の `payload_json` に含めて問題ありません。  
R2 を使うのは、次のどちらかが起きてからで十分です。

- 資産サイズが大きくなり、D1 に内包しづらくなる
- 件数や更新頻度が増えて、メタデータと本体を分けたくなる
