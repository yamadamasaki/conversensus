# リリース手順

リリースの手順 (特に semver の MAJOR/MINOR が上がる場合. PATCH レベルの場合には, 必ずしもこの手順に従う必要はない) をある程度確立する.

## 事前条件

- github リポジトリがリリース可能な状態になっていること. つまり,
  - ユーザに対して説明可能な, まとまった機能, あるいは実装内容がリポジトリに存在すること
  - それが少なくともコード・レベル (単体) での品質基準を満たしていること

## リリース準備

- 必要と思われる場合には, コード・レベルのレビューを行い, レビュー結果に基づいてリファクタリングを行う
- 前リリースから feature が追加/変更されている場合には, UI レビューを行ない, レビュー結果の中で必要な対応を行う
- 前リリースからアーキテクチャが大きく変更されている場合には, アーキテクチャ・レビューを行い, レビュー結果の中で必要な対応を行う
- 前リリースから feature が追加/変更されている場合には, introductory_guide_to_conversensus (`docs/`、日本語・英語、図は `bun run docs:shots`) を更新する
- リリース後に確認すべき重要な項目がある場合には, 確認の手順書を記述する

## リリース作業

本番は「クライアントの静的配信」と「PDS」の 2 つだけである。出し方・確かめ方・版の決まりは
`deepse/requirements/user-test-environment.md` の §11 が正で、ここには順序だけを書く
(詳細を二重に持たない)。

1. **版を決める** (§11.5)。前回の tag からの変更を見て MAJOR / MINOR / PATCH を選ぶ。
   op-log や lexicon の形式を壊すなら MAJOR、機能や op の種類を足すなら MINOR、直すだけなら PATCH
2. **版を上げる PR を出して merge する** (`chore/vX.Y.Z`)。`src/client/package.json` と
   `src/shared/package.json` の `version` を同じ数にし、`bun install` で `bun.lock` も更新する
   (v1.3.0 は PR #338)。同じ PR で §11.5 の版の表に行を足す (commit は出した後に分かるので、後から埋める)
3. **main で検査する**: `git switch main && git pull`、作業ツリーが clean であること、
   `bun run lint && bun run typecheck && bun run test` が通ること
   (WebKit の実機に効く変更があれば `bun run test:e2e` も)
4. **出す** (§11.1): `git push origin main:release`。GitHub Actions (`deploy.yml`) が走る。
   `gh run watch <run id> --exit-status` で成功を待つ。ビルドが失敗したら配信は触られない
5. **出した後に確かめる** (§11.2): COOP/COEP のヘッダ、`client-metadata.json`、PDS の `_health`、
   `version.json` の版、ブラウザで `crossOriginIsolated` と OAuth ログイン。
   service worker が前の版を持っているので、再読み込みしてから見る
6. **tag と GitHub Release** (§11.5): 出して確かめた commit に注釈付きの tag を打ち、
   `gh release create` で説明を付ける。説明は「足したもの / 直したもの / 文書」の見出しで、
   issue・PR の番号を添える (v1.3.0 の Release が見本)
7. **版の表を埋める**: §11.5 の表に commit と内容を書く (docs の PR で足りる)

文書のサイト (docs.conversensus.site) は `docs/**` が main に入ると `docs.yml` が別に出す。
リリースの手順に含めず、入門の更新はリリース準備で済ませておく。

### 戻すとき

`release` は main を進めるだけのブランチなので、問題が出たら **原因の commit を revert した PR を main に入れ、
もう一度 `main:release` を push する** (履歴を書き換えない)。急ぐときだけ、確かめ済みの前の commit を
`git push --force-with-lease origin <前の commit>:release` で出し直してよい (Actions は同じ手順で前の版を配る)。
PDS の設定を変えたリリースは、PDS 側も戻す必要がある (§11.3)。

## リリース確認

- 確認の手順書がある場合には, それに従ってリリースがうまく行っているかどうかを確認する
- 確認の手順書がない場合には,
  - アプリケーションにアクセスし, 最低限の操作が問題なく実行できることを確認する
  - ドキュメント類が問題なく表示できることを確認する
- リリース・ノートを公開する
  - GitHub Release の説明がリリース・ノート (v1.0.0 から作っている。上の手順の 6)
