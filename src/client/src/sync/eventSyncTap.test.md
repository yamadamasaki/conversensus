# eventSyncTap テスト仕様

## 何を

`EventSyncTap` (step1 Phase 4 実配線 W2、dispatch された GraphEvent を操作ログへ流す
tap) をテストする。event → Batch 変換・clock 採番・Outbox への enqueue・SyncProvider
への flush と、オフライン分岐を検証する。

## なぜ

漸進移行の要。既存の GraphEvent/undo-redo を残しつつ「編集 = 操作ログの追記」を
成立させる副経路であり、ここが回帰すると編集が op-log に載らず local-first の
永続が壊れる。次を固定する:

1. **ops を生じる event だけ流す**: presentation の空更新など ops 0 件の event は
   Batch にせずスキップし、**clock も消費しない** (無駄な採番で順序がずれない)。
2. **clock の単調増加**: 連続操作で Lamport clock が 1,2,3… と進む (LWW 順序の担保)。
3. **オフライン分岐**: provider.push が失敗しても保留を維持し (Outbox)、復帰後の
   操作が drain を再起動して未送信分ごと再送する。編集がオフラインで失われない保証。
4. **再起動後の clock 復元 (W3)**: 初回 drain で永続ログ (`provider.pull`) の
   max(clock) を観測して `seed` し、発番を max+1 から再開する。再起動をまたいでも
   採番が既存 batch を必ず超え、順序が壊れない。復元は tick より前に行うため、
   復元前に届いた event は保留し (clock 未割当)、復元成功後に FIFO 順で採番する。
5. **restore 失敗時の保留**: pull が失敗した場合は seed も採番もせず event を保留し、
   onError 通知のうえ次の record で再試行する (0 起点の誤採番を防ぐ)。

`LocalServerSyncProvider` は api.ts (薄い fetch ラッパー) への委譲のみのためテスト対象外。
tap のロジックを framework 非依存に固定する。

## どのように

- テスト用 `RecordingProvider` (push を記録、`online` で成否を切替) を注入。
- **push**: `NODE_RELABELED` (node.setContent を生む) を record → settled 後に 1 件 push、
  ops が node.setContent であること。
- **空 ops スキップ**: width/height 無しの `NODE_STYLE_CHANGED` を record → push 0 件、
  注入した `LamportClock` が tick されていない (current()===0)。
- **clock 単調増加**: relabel を 3 連続 record → push された batch の clock が [1,2,3]
  (空ログを pull → seed(0) → tick 1,2,3)。
- **再起動後の復元**: `existing` に clock 5,7,6 の batch を仕込み、0 起点の clock を注入して
  record → seed(max=7) 後の tick で clock [8,9] が push される。
- **restore 失敗**: `pullFails=true` で record → push 0・pending 1・clock 0・onError 1 回。
  その後 `pullFails=false`・`existing=[clock 3]` にして別 record → seed(3) 後の tick で
  clock [4,5] が push され pending 0 (保留分ごと再試行)。
- **オフライン**: `online=false` で record → push 0・pending 1・onError 1 回。その後
  `online=true` にして別 record → 保留分 + 新規の 2 件が push され pending 0。
- **sheetId の付与 (W3c2)**: `record(event, sheetId)` で渡した sheetId が push された
  content batch に載ること、`record(event)` (sheetId 省略) では batch が sheetId を
  持たない (structure 経路) ことを固定する。sheetId は event と対で保留され、drain 時の
  `graphEventToBatch(event, tick, sheetId)` で載るため、clock 採番タイミングと独立に正しく紐づく。
- `settled()` で直列化された flush チェーンの完了を待つ。

## actor の注入 (Phase 4d-2)

`EventSyncTap` は `actor` を必須の dep として受け取り、生成する全 batch に載せる。

**actor は UI の `GraphEvent` ではなく同期層が与える。** 以前は `GraphEvent.userId`
(常に `'local'`) を actor にしていたが、actor は「誰が編集したか」という UI 上の属性ではなく、
**Lamport の因果順序と重複排除の単位を識別する同期層の識別子**だからである
(設計 `step1-phase4d-receive.md` §1.1 / §3.1)。値の組み立ては `sync/actor.ts` が担う
(`<did>#<deviceId>`)。

この移動に伴い `GraphEvent.userId` は消費者が無くなったので削除した (`makeEventBase` は
セッションに触れない純関数なので、そこで `did#deviceId` を組み立てるにはモジュール
レベルの可変状態が要り、テストしづらくなる)。

- tap に渡した actor が push される batch に載ること。

## Lamport 受信規則の入口 (Phase 4d-3)

`observeRemote(remoteClock)` は受信 batch の論理時刻を観測し、自端末 clock を
`max(local, remote) + 1` へ前進させる (`LamportClock.observe`)。

**なぜ必要か**: これが無いと、端末をまたいだ `a.clock < b.clock` の比較が
「因果的に後」を表現しない。設計 `step1-phase4d-receive.md` §1.6 のとおり
`LamportClock.observe` はプリミティブとして存在しながら本番コードから一度も
呼ばれていなかった (受信規則が未実装だった)。順序規則 (§3.2b) をどう作っても、
この配線が無ければ因果は表現できない。

**なぜ `seed` ではないか**: `seed` は復元用で `+1` しない。受信で `seed` を使うと
受信分と同じ clock を自端末が再発番しうる。受信では必ず `observe` を使う。

**呼び出し元は 4d-5 で配線する** — 4d-3 時点では受信経路そのものが存在しないため、
入口とその挙動だけを固定する。

- **受信後の発番が受信分を追い越す**: ローカルで clock 1 を発番 → `observeRemote(10)`
  → 次の record が clock 12 で push されること (observe が 11 にし、tick が 12)。
  受信分 (10) より必ず大きい値から発番されることを固定する。
- **自身の方が大きくても前進する**: clock 20 の状態で `observeRemote(5)` → 21 になること。
  遅れて届いた古い受信でも `+1` する (`seed` との差を固定する)。
