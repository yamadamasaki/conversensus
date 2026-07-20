# remoteSyncQueue テスト仕様

## 何を

`RemoteSyncQueue` (step1 W3d5-3) をテストする。remote (ATProto) への未送信を破棄せず
保持する再送キュー。enqueue でのフィルタ適用、best-effort flush の成功除去・失敗保持・
再送、pending 購読、容量上限 (D1)、catch-up の取りこぼし回収を検証する。

## なぜ

このキューは設計 §3.1 / §3.6 の「純 fire-and-forget を採らず、失敗に気づけて回復できる」を
成立させる中核。次が破れると remote 同期が静かに壊れる:

- **フィルタ (C1/D7)**: enqueue が genesis actor batch を積む、または presentation を
  remote に載せると、genesis 衝突 (remote 汚染) / presentation 漏洩が起きる。フィルタを
  enqueue 内に閉じ込め、呼び出し側が生の batch を渡しても安全にする契約を固定する。
- **破棄しない (§3.6)**: flush 失敗時に未送信を捨てると、サイレント消失する。失敗で保持し、
  復帰後の再 flush で送信できることを固定する。ローカル正典 (Outbox) の非喪失契約を remote
  でも保つ。
- **上限 (D1)**: remote が長時間落ちると保留が無制限に膨れる。capacity で最古から溢れさせ
  無制限成長を防ぐ。溢れてもローカル正典 + catch-up で回収できるのでデータは失われない。
- **catch-up (取りこぼし回収)**: best-effort push がオフライン中に落とした分を、remote 全件
  pull と突き合わせて積み直す。remote に既にある分は二重投入しない (id 一致で除外) こと、
  genesis は積まない (C1) ことを固定する。
- **pending 購読 (§3.7)**: UI が未同期件数を追えるよう、登録直後の現在値通知と enqueue/flush
  での更新、解除後の非通知を固定する。

## どのように

テスト用 `FakeProvider` (push/pull を記録、`online` で push 成否、`pullBatches` で pull 応答を
切替) を注入して単体で閉じる (PDS 非依存)。

- **enqueue (フィルタ)**: genesis actor batch を積まない / 全 presentation batch を積まない /
  mixed batch は presentation を除いて積む。
- **flush**: 成功でキューから除去 (provider に push される) / 失敗で破棄せず保持 /
  復帰後の再 flush で送信。
- **pending 購読**: 登録直後に現在値 (0) を通知、enqueue で 1・flush で 0 を観測、解除後は
  通知されない。
- **上限 (D1)**: `capacity: 2` で 3 件積むと最古が溢れ直近 2 件を保持・`overflowed=true`。
  既定 `REMOTE_QUEUE_MAX` が正の有限値であること。
- **catchUp**: remote に既にある id を除いた取りこぼしのみ push する / catch-up 経由でも
  genesis batch は積まない。

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
