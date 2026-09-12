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

# GitNexus — 任意の道具

このリポジトリは GitNexus で index されている (`.gitnexus/`)。ただし **常用はしない**。
呼び出しは義務ではなく、下記の「効く場面」に当たったときだけ引く。

## なぜ格下げしたか (2026-09-09)

GitNexus が見るのは **named symbol の呼び出しグラフ**である。一方このコードベースの
結合は, その多くが symbol ではない所を通っている。

- 判別共用体の **文字列リテラル** (`'NODE_CONTENT_CHANGED'` などの event type)
- React Flow の `data` のような **`Record<string, unknown>` のキー** (`data.content`)
- Zod schema と branded 型, op の projection

実例: Phase 5 P0 の改称 (`NODE_RELABELED` → `NODE_CONTENT_CHANGED`,
`data.label` → `data.content`) は 24 ファイル・70 箇所近くに及んだが,
`context "NODE_CONTENT_CHANGED"` は `not found` を返す。範囲を出したのは grep で,
食い違いを捕まえたのは **型検査ではなくテスト 17 件** だった。

つまり step2 の作業 (op / projection / event type) は GitNexus が最も苦手な形をしている。
464 ファイル・テスト 1586 件・テストコードまで typecheck が通る状態では,
**grep + typecheck + test** で足りている。

## 効く場面 (このときだけ引く)

- named な関数・クラス・メソッドの **rename / extract / move**。`rename` は呼び出しグラフを
  理解するので find-and-replace より安全
- 触ったことのない領域の **呼び出し関係を俯瞰したい** とき — `query({search_query: "概念"})`,
  `context({name: "symbolName"})`
- ハブになっている symbol を変える前の当たり確認 — `impact({target, direction: "upstream"})`

## 読むときの注意

- `risk: UNKNOWN` は「低リスク」ではなく **「グラフが答えられなかった」**。呼び出し元 0 件は
  未使用の証拠にならない (動的ディスパッチ, plain object のプロパティ経由, 文字列キー)。
  必ず grep で裏を取る
- index が古いときは実ファイルが正。`.gitnexus/meta.json` の `lastCommit` を HEAD と見比べる

## 再 index と version 整合

```bash
gitnexus analyze --force        # brew 側 (node 26) の gitnexus が走る
```

**注意**: gitnexus が複数入っていると, analyze した側が DB の storage version を上げて
MCP サーバ側が読めなくなる (`Database file version: 43, Current build storage version: 42`)。
MCP の command と, シェルで解決される `gitnexus` を **同じ実体に揃えておく**こと
(`which -a gitnexus` で確認)。

MCP が読めないときも CLI は動く: `gitnexus impact "sym" --direction upstream --repo .`

## Resources

| Resource | Use for |
| --- | --- |
| `gitnexus://repo/conversensus/context` | Codebase overview, index の鮮度確認 |
| `gitnexus://repo/conversensus/processes` | 実行フロー一覧 |
| `gitnexus://repo/conversensus/process/{name}` | 実行フローの追跡 |

CLI とツールの詳細は `.claude/skills/gitnexus-*/SKILL.md` を参照。

> このファイル末尾の `<!-- gitnexus:start -->` 〜 `<!-- gitnexus:end -->` は
> `gitnexus analyze` が自動生成する枠で, 上書きされる。**判断はこの節が正**であり,
> 枠の中の "MUST" は無効とする。

<!-- gitnexus:start -->
<!-- gitnexus:end -->
