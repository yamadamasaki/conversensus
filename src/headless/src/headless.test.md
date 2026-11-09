# headless.test.ts — headless の client のテスト仕様

## 何を

`Headless` (ブラウザの外で 1 つの DID として conversensus を同期する client) を検証する。
H1 では「開く・ログイン・閉じる」と、起動をまたいで同じ actor であること。

## なぜ

- headless は client の大域 (正典の口・認証の口・`localStorage`) を差し替えて動く。**差し替えが
  閉じた後に戻らないと**、同じプロセスの次のもの (テストなら次のテスト) が前の端末の DB と
  セッションで動く
- agent は起動と停止を繰り返す。**起動のたびに新しい actor になると**、名簿と判断ログに使われない
  actor が積もる (計画 `agent-stage2-headless.md` 完了基準 6)

## どのように

偽の PDS (`testing/headlessWorld.ts`) の上で、`dataDir` を一時 directory に作って開く。
境界 (PDS への fetch) だけが偽物で、内側は本物である (App 結合と同じ方針)。

- ログインすると DID と actor が決まる。ログイン前に DID を読むと例外
- 🔴 **同じ `dataDir` で開き直すと、ログインし直さずに同じ actor で続く** — セッションと端末の id が
  `storage.json` に残ることの確認
- 別の `dataDir` は別の端末 (同じ DID・別の actor)
- ログアウトして閉じたら、開き直しても未ログイン
- 1 プロセスに同時に 2 つは開けない (大域が 1 つなので)
- 閉じたら `localStorage` の定義を元に戻す
- 偽の PDS の外へは通信しない

## ログインを保つ (agent 段 5 S1)

常駐の agent は何週間も走る。その間に PDS のセッション (access も refresh も) が切れても、
**人の手なしに app password で入り直して**書き続けられることを見る (設計 A2')。
失効は偽の PDS の `expireSessions` で起こす。

- セッションが生きていれば `ensureSignedIn` は何もしない。発番器 (`clockOf`) も同じものが返る
- 🔴 **失効の後は入り直し、同じ actor・同じ発番器で書いて PDS に届く**。発番器を作り直すと
  番号が戻り、同じ actor の batch の番号が重なる。届くかは PDS の record の数で見る
  (失効の前に一度同期して、`createFile` の batch を数から除く)
- パスワードが違えば例外。**この例は修正前に「成功」していた** — `login` が前のログインの結果を
  持ち続け、入り直しが何もしていなかった (`client.ts` の `resumeSession` が、戻せないときに捨てるようにした)
