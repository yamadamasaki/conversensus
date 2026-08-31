# U6-P1 スパイクレポート: DtR の器を新しい sheetId にしてよいか

> 日付: 2026-08-31 / Phase: 0 ([step2 実装計画](../plans/step2-implementation.md) §5 の U6)
> スパイク: `src/client/src/spikes/u6/p1.spike.ts` (投棄前提, **実 PDS を叩く**)
> 実行: `bun run src/client/src/spikes/u6/p1.spike.ts` (ローカル PDS + alice.test / bob.test)
> production コードの変更: **ゼロ**

## 判定: ✅ **Go** — DtR の器は trunk の fileId 内の新しい sheetId でよい

問いは「新しい `sheetId` を DtR の器としたとき、**他 actor の手元で** ①読める
②既存 File の projection が壊れない ③**File が勝手に増えない**」だった。3 つとも通った。

**旧案 (DtR graph を branch として書いて読み戻す) を実装してはならない**という判断
(事実 5: branch batches は remote へ出ないので local で完結して通ってしまう) の代わりに
置いたスパイクである。こちらは**実際に 2 つの DID をまたいで**確かめている。

## 検証タスクの結果

alice が自分の repo の 1 つの fileId の中に、通常のシート S1 と **DtR の器としての
新しいシート S2** を書き、**bob のセッションで alice の repo を読んだ**。

| # | 検証 | 結果 |
|---|---|---|
| ① | DtR の器 (新しい sheetId) が他 actor の手元で読める | ✅ 4 件取得、S2 の batch を含む |
| ② | 既存シート S1 の projection が壊れない | ✅ S1 のノードがそのまま出る |
| ②b | DtR の器 S2 も同じ File の 1 シートとして出る | ✅ シート数 2 (本編, DtR) |
| ③ | **File が増えない** | ✅ 書く前後の差分は書いた 2 つの fileId のみ。**3 つ目は現れない** |

③ は「alice の repo に既にあった 23 個の fileId」を対照に取り、**書く前後の集合の差分**で
判定した。DtR の器が新しい File として materialize されるなら、ここに 3 つ目が現れる。

## ⚠️ Phase 2 で必ず要る対策が 1 つ見つかった

**他 actor の repo に対して `listFileHeads` を回すと、その actor の File が全部見える。**

スパイクでは bob が alice の repo から **23 個の fileId** を列挙できた。共同作業している
File だけではなく、alice が一人で作った File もすべて含まれる。

`discoverRemoteFiles` は**未知の fileId を新しい File として materialize する**ので、
Phase 2 で他 actor の repo をそのまま発見経路に通すと、**bob のサイドバーに alice の
無関係な File が全部並ぶ**。

ATProto の repo は誰でも読める設計なので、これは秘密の漏洩ではない。**materialize の
問題**である。対策は仕様側に既にある — 「名簿を先に読み、グラフを後に読む」
(architecture §2)。**発見の対象は「その File の名簿に自分が載っている File」に限る**
必要があり、repo 全体の列挙を発見経路にそのまま繋いではならない。

これは Phase 2 のタスクとして計画に足した。

## 副次的な確認

**範囲取得 (`listByRkeyPrefix`) を使わないと届かない。**最初の実行は 1 ページ読み
(100 件・降順) で書いたばかりの batch を 1 件も拾えず、4 項目すべて落ちた。alice の repo に
過去のテストの File が 23 個あったためである。

step1 Phase 7 の rkey スキーム (`v1~<fileId>~…`) と prefix 範囲取得は、単一端末の効率化と
して入れたものだが、**多アクタでは効率ではなく正しさの問題になる** — 相手の repo は
自分の repo より大きいのが普通だからである。

## Phase 1 / 2 に引き継ぐ課題

- **発見の対象を名簿で絞る** (上記)。Phase 2 のタスクに追加済
- スパイクは `putRecord` を 1 件ずつ回した。Phase 2 の受信側は読むだけなので影響しないが、
  DtR の器を作る側 (Phase 6) は `createMany` を使うか決めること
