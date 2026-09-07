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
- **テスト・コードも型検査の対象にする** (`bun run typecheck`)。`bun test` は transpile only で
  走るので, ここで見ないとフェイクと本物のインタフェースの乖離が実行時まで分からない
  - 単体: client は `src/client/tsconfig.test.json` (本番ビルド用の `tsconfig.app.json` と分ける),
    server と shared は本体用の設定にテストを含める (どちらも tsc でビルドしないため)
  - E2E: `tsconfig.e2e.json`

### 全称命題は性質として書く (property-based testing)

主張が「**ある** 入力で成り立つ」ではなく「**あらゆる** 入力で成り立つ」形のときは, 例ではなく **性質**として書く (`fast-check`). 往復 (`apply(from, diff(from, to))`), 冪等 (`f(f(x)) = f(x)`), 全順序, 畳み込みの収束などが該当する.

- 例で書くと, コードが述べているのは 1 つの例で, **一般命題は `.test.md` の日本語の側にしかない**. 述べたい命題と検証している命題が別の場所にある状態になる
- 性質として書けば**コードが一般命題そのものを述べる**ので, `.test.md` は「なぜその性質が重要か」に専念できる
- **生成器の設計が命題の強さそのものである.** 何を引かないかは, 何を検証しないかと同じ意味を持つ. `.test.md` に生成器の判断とその理由を書く
  - 値は**広い生成器より小さなプールが効く**ことが多い. 広いと同じ値を引かないので, 「差分が空になる」ような境界に当たらない (実例: `properties.test.md`)
- 性質が見つけた反例は, **例のテストとして残す**. 乱数が毎回そこを引く保証はない
- 例ベースのテストを置き換えるのではなく, **全称命題の部分だけを性質にする**. 具体的な振舞いの固定は例の方が読みやすい

### E2E (ブラウザ)

- **エンジンをまたいで壊れるものだけ**を E2E にする (WebKit 適合の検証: ANA-125)
- `tests/*.spec.ts` に置き, 同じ場所に `tests/*.spec.md` を添える (単体と同じ規約)
- 実行: `bun run test:e2e` (webkit = 本命 / chromium = 対照)。サーバは Playwright が
  専用ポートで自前に起動するので, 事前の起動は要らない
- **画面が正しく見えることを合格条件にしない**。`tests/pageProblems.ts` を併用し,
  未処理例外・コンソールエラー・読み込み失敗が 0 件であることを見る

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

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **conversensus** (6145 symbols, 14017 relationships, 354 execution flows).

> Index stale? Run `node .gitnexus/run.cjs analyze --index-only` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? Bootstrap with `npx`, `bunx`, or `pnpm dlx` — e.g. `bunx gitnexus@latest analyze` (npm 11 npx crash; #1939).

## Always Do

- **MUST run impact analysis before editing.** Use `impact({target: "symbolName", direction: "upstream"})` (MCP) or `node .gitnexus/run.cjs impact "symbolName" --direction upstream --repo .` (CLI fallback); report callers, processes, and risk. Never substitute grep for graph analysis.
- **MUST analyze graph changes before committing.** Use `detect_changes({scope: "all"})` (MCP) or `node .gitnexus/run.cjs detect-changes --scope all --repo .` (CLI fallback). `partial: true` or `truncated: true` is not a clean check — a zero means unseen, not unaffected; re-run it. For regression review: `detect_changes({scope: "compare", base_ref: "main"})` or `node .gitnexus/run.cjs detect-changes --scope compare --base-ref "main" --repo .`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- **MUST treat `risk: UNKNOWN` as unresolved, not as low.** An empty caller set is not evidence the symbol is unused — it can also mean the callers are not resolvable by the index (plain-object property access, dynamic dispatch, cross-language calls). `impact` pairs `UNKNOWN` with a `riskNote` saying so. Confirm with a text search before treating the symbol as safe to change or delete; do not proceed on the strength of a zero.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method before MCP/CLI impact analysis.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis, and never read `UNKNOWN` as an all-clear — it means the walk could not answer, which is the one verdict that requires confirming by other means.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit before MCP/CLI graph change analysis.

## Resources

| Resource | Use for |
| --- | --- |
| `gitnexus://repo/conversensus/context` | Codebase overview, check index freshness |
| `gitnexus://repo/conversensus/clusters` | All functional areas |
| `gitnexus://repo/conversensus/processes` | All execution flows |
| `gitnexus://repo/conversensus/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
| --- | --- |
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
