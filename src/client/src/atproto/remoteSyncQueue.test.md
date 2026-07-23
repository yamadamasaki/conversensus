# remoteSyncQueue テスト仕様

## 何を

`RemoteSyncQueue` (step1 W3d5-3) をテストする。remote (ATProto) への未送信を破棄せず
保持する再送キュー。enqueue でのフィルタ適用、best-effort flush の成功除去・失敗保持・
再送、pending 購読、容量上限 (D1)、catch-up の取りこぼし回収を検証する。

## なぜ

このキューは設計 §3.1 / §3.6 の「純 fire-and-forget を採らず、失敗に気づけて回復できる」を
成立させる中核。次が破れると remote 同期が静かに壊れる:

- **フィルタ (D7, Phase 4e-0 で C1 見直し)**: enqueue が presentation を remote に載せると
  presentation 漏洩が起きる。フィルタを enqueue 内に閉じ込め、呼び出し側が生の batch を
  渡しても安全にする契約を固定する。genesis actor batch は Phase 4e-0 (C1 見直し) で
  remote へ**通す**ようになった — bootstrap の起源として届くことを固定する。
- **破棄しない (§3.6)**: flush 失敗時に未送信を捨てると、サイレント消失する。失敗で保持し、
  復帰後の再 flush で送信できることを固定する。ローカル正典 (Outbox) の非喪失契約を remote
  でも保つ。
- **上限 (D1)**: remote が長時間落ちると保留が無制限に膨れる。capacity で最古から溢れさせ
  無制限成長を防ぐ。溢れてもローカル正典 + catch-up で回収できるのでデータは失われない。
- **catch-up (取りこぼし回収)**: best-effort push がオフライン中に落とした分を、remote 全件
  pull と突き合わせて積み直す。remote に既にある分は二重投入しない (id 一致で除外) こと、
  genesis も積む (Phase 4e-0・C1 見直し) ことを固定する。
- **pending 購読 (§3.7)**: UI が未同期件数を追えるよう、登録直後の現在値通知と enqueue/flush
  での更新、解除後の非通知を固定する。

## どのように

テスト用 `FakeProvider` (push/pull を記録、`online` で push 成否、`pullBatches` で pull 応答を
切替) を注入して単体で閉じる (PDS 非依存)。

- **enqueue (フィルタ)**: genesis actor batch も積む (Phase 4e-0) / 全 presentation batch を
  積まない / mixed batch は presentation を除いて積む。
- **flush**: 成功でキューから除去 (provider に push される) / 失敗で破棄せず保持 /
  復帰後の再 flush で送信。
- **pending 購読**: 登録直後に現在値 (0) を通知、enqueue で 1・flush で 0 を観測、解除後は
  通知されない。
- **上限 (D1)**: `capacity: 2` で 3 件積むと最古が溢れ直近 2 件を保持・`overflowed=true`。
  既定 `REMOTE_QUEUE_MAX` が正の有限値であること。
- **catchUp**: remote に既にある id を除いた取りこぼしのみ push する / catch-up 経由でも
  genesis batch を積む (Phase 4e-0)。

## fileId の運搬 (Phase 4d-1)

`RemoteSyncQueue` は**セッション単位** (ATProto の batch コレクションが repo 全体で 1 つ) だが、
remote レコードは fileId を必要とする。そこで `enqueue(batches, fileId)` で受け取り、内部の
`Outbox<RemoteBatch>` に `{ fileId, batch }` として積む。fileId を供給するのはファイル単位の
`FanoutSyncProvider` 側。

- enqueue で渡した fileId が送信エンベロープに添えられること。
- **別ファイルの batch がそれぞれの fileId で積まれること** — 1 つのキューが複数ファイルの
  batch を同時に抱えうる (セッション単位なので) ため、取り違えないことを固定する。

重複排除キーは `batch.id` のまま (fileId は運搬のために添えるだけ)。`catchUp` も適用先の
fileId を受け取る。

## catchUp の fileId フィルタ (Phase 4d-4, 設計 §1.11 D-6)

4d-1 から繰延していた対応。前提条件だった「`pull` が fileId を返せること」が
`pullRemote(): Promise<RemoteBatch[]>` で揃ったため実装した。

remote の batch コレクションは **repo 全体で 1 つ**なので `pullRemote` は他ファイルの
batch も返す。`localBatches` は 1 ファイル分なので、他ファイル分と突合しても一致しよう
がなく、**無関係な全件を毎回舐めるコストだけが残っていた**。

**直していたのは正しさではなくコストである** — batch id は UUID なのでファイルを跨いで
衝突せず、誤マッチは起きなかった。ただし fileId で絞る方が意図が明示的になり、
将来 id 生成方式が変わったときの安全余裕にもなる。

- **fileId で絞ってから突合する**: remote に `FILE` の '1' と別ファイル `OTHER` の '2' が
  ある状態で `catchUp([1,2], FILE)` → '1' は送らず '2' を積み直すこと。別ファイルの '2' が
  「FILE として送信済み」と誤判定されないことを固定する。
- **他ファイルの batch しか無ければローカル全件を積み直す**: 積み直したエンベロープが
  すべて `FILE` 宛であることも確認する (fileId の取り違えが起きない)。
