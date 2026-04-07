# Race-Data-Correct（Furlong CUBE）

競馬データ補正用の Web アプリです。React（Vite）フロントエンドと FastAPI バックエンド、PostgreSQL で構成されています。

この README は **Docker / Docker Compose での起動**に限定して説明します（Node / pnpm / Python をホストに入れて開発サーバーを動かす手順は含みません）。

## 前提になるもの

- **Docker**（[Docker Desktop](https://www.docker.com/products/docker-desktop/) など）
- **Docker Compose**（Docker Desktop に含まれる `docker compose`、またはスタンドアロンの `docker-compose`）

## 起動手順

リポジトリのルートで次を実行します。

```bash
docker-compose up -d --build
```

- **`--build`**: Dockerfile を使ってイメージをビルドします（初回や `docker/` やアプリコードを変えたあとに付けます）。
- **`-d`**: バックグラウンド起動です。ログをその場で見たい場合は `-d` を外して `docker-compose up --build` としてください。

**ビルドだけではポートは開きません。** 必ず **`up`** でコンテナを起動してください。

## アクセス URL

| 用途 | URL |
|------|-----|
| **アプリ画面（フロント）** | http://localhost:8080/ |
| **API ドキュメント（Swagger）** | http://localhost:8000/docs |
| **ヘルスチェック** | http://localhost:8000/fastapi/healthz |

フロントは **8080**、API は **8000** です。混同しないよう注意してください（8000 の `/` は API サーバー用で、画面は 8080 を開きます）。

## Compose の構成

`docker-compose.yml` で次の 3 サービスが定義されています。

| サービス | 内容 |
|----------|------|
| `db` | PostgreSQL 16（データは名前付きボリューム `pgdata` に保持） |
| `api` | FastAPI（`docker/Dockerfile.api`） |
| `web` | Nginx でフロントの静的ファイルを配信し、`/fastapi/` を API にリバースプロキシ（`docker/Dockerfile.web`） |

既定の DB 接続は Compose 内で **`postgresql://app:app@db:5432/race`** として API に渡されます。API コンテナ起動時に **`lib/db/migrations/create_new_schema.sql`** が自動適用されます（`CREATE TABLE IF NOT EXISTS` ベース）。

公開ポート:

- **8080** → `web`（Nginx の 80）
- **8000** → `api`（Uvicorn）

## よく使うコマンド

```bash
# 状態確認
docker-compose ps

# ログ（API）
docker-compose logs -f api

# ログ（全体）
docker-compose logs -f

# 停止・削除（ボリュームは残る）
docker-compose down

# DB ごと消してやり直す（データが消えます）
docker-compose down -v
```

##（任意）サンプルデータの投入

DB にテスト用データを入れる場合（`DATABASE_URL` は Compose の `api` と同じ値に合わせます）。

```bash
docker-compose exec api sh -c 'cd /app/artifacts/fastapi-server && python seed.py'
```

## トラブルシューティング

- **ブラウザで繋がらない**  
  Docker Desktop が起動しているか、`docker-compose ps` で `api` / `web` / `db` が `Up` か確認してください。

- **API コンテナがすぐ終了する**  
  `docker-compose logs api` で PostgreSQL 接続や `psql` によるスキーマ適用のエラーを確認してください。

- **ビルドで `pnpm install` が失敗する**  
  `docker/Dockerfile.web` の方針に従い、`pnpm install --no-frozen-lockfile` で解決する想定です。それでも失敗する場合はログ全文を確認してください。

## 関連ファイル

| パス | 説明 |
|------|------|
| `docker-compose.yml` | サービス定義・ポート |
| `docker/Dockerfile.api` | API イメージ |
| `docker/Dockerfile.web` | フロントビルド + Nginx イメージ |
| `docker/nginx.conf` | 静的配信と `/fastapi/` プロキシ |
| `docker/entrypoint-api.sh` | DB 待機・スキーマ適用・Uvicorn 起動 |
| `lib/api-spec/openapi.yaml` | REST API の OpenAPI 定義 |

## ライセンス

ルートの `package.json` に記載のとおり **MIT** です。
