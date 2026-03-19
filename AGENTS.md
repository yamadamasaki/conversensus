# AGENTS.md

- このリポジトリの公用語は日本語です
- 以下のリポジトリがこのリポジトリに関連しています
  - https://github.com/yamadamasaki/deep-software-engineering
  - https://github.com/yamadamasaki/awe9
- 深ソフトウェア工学の提案を進めていく一環として, conversensus というアプリケーションを構築します

## セットアップ

リポジトリをクローンしたら最初に実行する:

```bash
bun install
bun run setup   # pre-commit hook をインストール (lint + typecheck が commit 前に自動実行される)
```

### 注意

- ARM64 ネイティブの Node.js が必要 (Rosetta 経由の x64 では `bun run dev:client` が動作しない)
- node_modules に問題が起きた場合は `rm -rf node_modules && bun install` でクリーンインストール

## テスト方針

- 自明なコード (型定義のみ, fetch の薄いラッパーなど) を除き, 単体テストを書く
- テストファイルはテスト対象と同じディレクトリに置く: `foo.ts` → `foo.test.ts`
- テストファイルと同じ場所に `foo.test.md` を置き, **何を・なぜ・どのようにテストするか** を記述する
- テスト実行: `bun test`

## 開発フロー

- 実装は step ごとにブランチを切って進める
  - ブランチ名は `step/<step名>` とする (例: `step/step0-scaffold`, `step/step0-server` など)
  - step の区切りは実装の論理的なまとまりに応じて判断する
- 各 step の実装が完了したら pull request を作成する
- pull request は approve されるまでマージしない
- approve を受けてからマージし, 次の step のブランチを切る

## Issue ドリブン開発

- 機能追加・バグ修正の仕様は GitHub Issues に記述する
- 実装開始時に該当 Issue を読み, 不明点があれば Issue にコメントで質問する
- 実装完了後, Issue にコメントで報告する
- PR の description に `Closes #N` を記載して Issue と紐付ける

## コーディング規約

### 1. 原始型エイリアス

原始型 (`string`, `number` など) をそのまま使わず, 意味的なエイリアスを定義する.

```typescript
export type NodeContent = string;
export type EdgeLabel = string;
export type FileName = string;
export type SheetName = string;
```

### 2. ID には Branded UUID 型

ID フィールドには Zod の `.brand()` を使って branded UUID 型を定義する.
異なるエンティティの ID を混同しないよう, エンティティごとに異なる型とする.
- Zod スキーマで UUID フォーマットを強制し, API 境界でバリデーションする
- ドメイン内部の境界 (React Flow など) では `as NodeId` のキャストを使う

```typescript
export const NodeIdSchema = z.string().uuid().brand<'NodeId'>();
export type NodeId = z.infer<typeof NodeIdSchema>;
// EdgeId, SheetId, FileId も同様
```

### 3. 固定値は定数として定義する

マジックリテラル (文字列・数値の直書き) は使わず, 名前付き定数として定義する.

```typescript
const SERVER_PORT = 3000;
const DEFAULT_FILE_NAME = '無題';
const DEFAULT_SHEET_NAME = 'Sheet 1';
```

## コードレビュー基準

優先度の高い順に

- 設計方針 (deepse/architecture/) との間に一貫性があること
- 必要十分な単体テストが存在し, テスト・コードにはそのコードを正確に反映するテスト仕様書 (.test.md) が存在し, 人間の開発者にとって理解し易いものであること
- lint / typecheck / test がすべてパスしていること
- 人間にも言語モデルにも理解しやすいように, できる限りシンプルなコードであること
- 自明でないロジックにはコメントが付加されていること
- それぞれの言語やライブラリ, ツールのベスト・プラクティスに従っていること
