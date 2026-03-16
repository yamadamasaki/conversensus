# step0 実装アーキテクチャ

## 概要

step0 は標準的な web アプリケーションとして実装する. シングルユーザー・ファイルベースストレージ・基本的な Node/Edge 編集を実現する最小構成.

## ディレクトリ構成

```
/                         ← repo root
  deepse/                 ← 要件・ドキュメント
  src/
    client/               ← React + Vite + React Flow
    server/               ← Hono + Bun
    shared/               ← 共通型定義 (TypeScript)
  package.json            ← workspace root
  bunfig.toml
```

## スタック

| レイヤー | 技術 |
|---|---|
| ランタイム・パッケージマネージャ | Bun |
| Frontend フレームワーク | React + TypeScript |
| Frontend ビルドツール | Vite |
| グラフ編集 UI | React Flow (xyflow) |
| Backend フレームワーク | Hono |
| ストレージ | JSON ファイル (1 GraphFile = 1 JSON) |

## データモデル (shared)

```typescript
type GraphNode = {
  id: string
  content: string          // step0 はテキストのみ
  position: { x: number; y: number }
  style?: Record<string, unknown>
}

type GraphEdge = {
  id: string
  source: string
  target: string
  label?: string           // step0 の唯一の property
  style?: Record<string, unknown>
}

type Sheet = {
  id: string
  name: string
  nodes: GraphNode[]
  edges: GraphEdge[]
}

type GraphFile = {
  id: string
  name: string
  description?: string
  sheet: Sheet             // step0 は 1 ファイル 1 シート
}
```

## API 設計

REST API. サーバーは port 3000.

| メソッド | パス | 説明 |
|---|---|---|
| GET | /files | ファイル一覧 |
| POST | /files | 新規ファイル作成 |
| GET | /files/:id | ファイル取得 (sheet 含む) |
| PUT | /files/:id | ファイル更新 (sheet 全体を一括保存) |
| DELETE | /files/:id | ファイル削除 |

sheet の Node/Edge は個別 CRUD せず、sheet 全体を一括保存する.
理由: step0 はシングルユーザーで競合がないため、シンプルな全保存で十分.

## ストレージ

`data/` ディレクトリに JSON ファイルを配置する.

```
data/
  {id}.json    ← GraphFile 1件分
  {id}.json
  ...
```

## ポート

| サービス | ポート |
|---|---|
| client (Vite dev server) | 5173 |
| server (Hono) | 3000 |

## 自動保存

クライアントは React Flow の `onNodesChange` / `onEdgesChange` イベントを debounce して PUT /files/:id を呼び出し、自動保存する.

## step0 の制約 (requirements より)

- Group なし
- 1 File につき Sheet は 1 つ
- Property は Edge の label のみ
- View は graph のみ
- Template なし
- 認証なし (シングルユーザー)
