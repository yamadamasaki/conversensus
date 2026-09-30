# batchRkey.test.ts — テスト仕様

## 何をテストするか

PDS の batch / 判断レコードの **rkey スキーム v2** (`<fileId>~<actor の # を : に>~<seq12>`) を
組む・分解する純関数群 (step3 Phase 1 S1-3 / [設計](../../../../deepse/plans/step3-phase1-oplog-v2.md) D9。
v1 は step1 Phase 7 p7-1)。

- `batchRkey(fileId, actor, seq)` — 組み立て
- `batchRkeyPrefix(fileId)` — そのファイルの rkey が共有する prefix (走査の**停止条件**)
- `batchRkeyFileCursor(fileId)` — そのファイルの手前を指す**合成 cursor**
- `parseBatchRkey(rkey)` — 分解 (形式を満たさなければ `null`)
- `rkeyFromUri(uri)` — AT-URI の末尾

## なぜテストするか

**この文字列の性質がそのまま範囲取得の正しさになる**。ATProto の `listRecords` で使えるのは
`cursor` (= rkey そのもの) と `reverse` だけなので、「どのレコードが取れるか」は rkey の辞書順
だけで決まる。コードで守るしかない不変条件は次のとおり:

1. **ATProto の rkey として正しい** — 許される文字 (`[A-Za-z0-9._:~-]`) と長さ (512)。actor の `#` は
   使えないので `:` に置き換える
2. **往復する** — `parseBatchRkey(batchRkey(...))` が元に戻る。DID 自体が `:` を含むので、
   **最後の** `:` で戻せることを確かめる
3. **同じ端末の別 actor は別の rkey** — 未ログインの `local#dev` とログイン後の `did#dev` が
   同じ seq で衝突しない
4. **同じ actor の seq 順 = 辞書順** — ゼロ詰めの目的。桁あふれは throw する (静かに壊さない)
5. **prefix と cursor の関係** — prefix はそのファイルの rkey にだけ一致し、cursor はそのファイルの
   どの rkey よりも小さい (昇順の seek がそのファイルの先頭に着地する)

分解側は**寛容にしすぎない**。桁数の違う seq や空のセグメントを「読めた」ことにしない。
v1 の rkey (4 セグメント) も `null` になる。

## どのようにテストするか

PDS 非依存の純関数なのでモック不要。

- **1・2 と 5 は全称命題なので性質で書く** (`fast-check`)。actor の生成器は実際に現れる形
  (`genesis`、`did:plc:…#<uuid>`、`did:web:…#<uuid>`、`local#<uuid>`) だけから引く。
  `did:web:example.com` を混ぜるのは、`.` と `:` を含む DID でも往復することを見るためである
- seq は 12 桁に収まる範囲全体から引く (境界の 0 と 10^12 - 1 も入りうる)
- 3・4 と分解の拒否は、具体的な値で固定する方が読みやすいので例で書く
