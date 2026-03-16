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

## 開発フロー

- 実装は step ごとにブランチを切って進める
  - ブランチ名は `step/<step名>` とする (例: `step/step0-scaffold`, `step/step0-server` など)
  - step の区切りは実装の論理的なまとまりに応じて判断する
- 各 step の実装が完了したら pull request を作成する
- pull request は approve されるまでマージしない
- approve を受けてからマージし, 次の step のブランチを切る
