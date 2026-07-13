# outbox テスト仕様

## 何を

`Outbox` (step1 Phase 4b、remote へ未 push の batches を保持する送信キュー) をテストする。
enqueue の順序・べき等性、`flush` のオンライン成功・オフライン保留、および in-flight
enqueue の非喪失を検証する。

## なぜ

`Outbox` は architecture §6 の「オフライン時は operations を outbox に積み、復帰時に
flush」を担う中核。次の3点が回帰すると、オフライン編集が静かに失われる:

1. **オフライン分岐**: `provider.push` が reject したとき保留を維持しないと、送信前の
   操作が消える。逆に成功時に除去しないと二重送信になる。
2. **復帰後の再送**: 一度失敗した保留が、次回 flush で送信できること (offline→online)。
3. **in-flight 非喪失**: push の await 中に積まれた新規 batch を、成功時の一括クリアで
   巻き込んで消してはならない。「送信に出したスナップショット分だけ」を id 指定で除く
   設計の正しさを固定する。

enqueue のべき等性 (同一 BatchId の無視) は、再試行・重複投入で保留が膨れないための保証。

## どのように

- **enqueue**: 積んだ batches を FIFO 保持 / 同一 id の再投入を無視 (べき等)。
- **flush (オンライン)**: `RecordingProvider` (push を記録) で、保留を push し成功時に除去。
  空 outbox の flush は `NullSyncProvider` で no-op 成功 (`{ ok: true, flushed: 0 }`)。
- **flush (オフライン分岐)**: `RecordingProvider.online = false` で push を reject させ、
  保留維持 + `ok: false` を確認。その後 `online = true` にして再 flush し送信成功を確認。
- **in-flight enqueue**: `RecordingProvider.onPush` フックで push の最中に別 batch を
  enqueue し、スナップショット分のみ除去され新規分が保留に残ることを確認。
