# applicability テスト仕様

## 何を

`analyzeApplicability` — 「op-log の各 op が実際に projection へ効いたか」を計測する関数を
テストする。効かなかった op を理由付き (`drops`) で返し、落ちてはいないが人間に届かない
可能性のあるもの (`warns`) を分けて返す。

## なぜ

step1 Phase 4d の受入基準 6 (「適用不能 op が 0 件」) を機械判定するための土台であり、
この関数が誤ると **4d-6 の実機検証そのものが嘘をつく**。

設計 §1.10 のとおり、受信 batch がローカル正典に着地しても projection に効くとは限らない:

- 未知 sheetId 宛の content batch は `projectFile` のグルーピングで**無言で捨てられる**
  (シート作成 batch を受け取っていない bootstrap ギャップ)。
- 対象不在の setter (`node.setContent` 等) は `applyOp` の `if (node)` で**無言で no-op になる**。

このため、既存の受入基準では穴が塞げない:

- 基準 1「op-log に行が増えた」→ 増えても落ちていれば意味がない。
- 基準 5「両端末の projection が一致する」→ **双方が同じだけ落としていれば一致してしまう**。

落ちた op を直接数えるしかない、というのがこの関数の存在理由である。

## どのように

この関数は `projectFile` / `projectBatches` の畳み込み規則を写した**第 2 の実装**なので、
テストは「規則の写し取りが正しいか」を軸に組む。

- **健全系のベースライン**: シート作成 → ノード/エッジ追加 → setter という素直な列で
  `drops` / `warns` が空になり、`appliedOps` が全 op 数と一致すること。これが崩れると
  実機で無関係な FAIL が出て検証が回らない。

- **drop の 3 分類** (受入基準 6 が FAIL とするもの):
  - `unknown-sheet`: 未知 sheetId 宛の content batch (§1.10 の本命ケース)。
  - `no-scope`: `sheetId` を持たない batch に content op が入っている (宛先不明で捨てられる)。
  - `missing-target`: 対象不在の setter / reconnect。
  - `sheet.setName` を未作成シート宛に出した場合も `unknown-sheet` になること。

> **カスケード削除だけは規則を共有している** (`cascade.ts`)。この規則は op ではなく
> そのときの状態 (親子関係) に依存するので、写すと必ずずれる。他の判定規則は従来どおり
> `applyOp` を写した独立な第 2 の実装である。

- **時点判定と最終判定の使い分け** (誤検出の防止):
  - content op の宛先シートは**最終 live 集合**で判定する。`projectFile` が全 batch を
    畳み込んだ後の構造でグルーピングするため、後から作られたシート宛でも落ちない。
  - `sheet.setName` 等の file op は **op 時点の live 集合**で判定する。`applyFileOp` は
    畳み込みの途中で `if (meta)` を見るため。よって「作成 → 改名 → 削除」の改名は
    確かに効いており drop にしてはいけない。この 2 つを取り違えると、正常な操作列が
    赤くなるか、逆に本当の欠落を見逃す。
  - setter も **op 時点**で対象が居れば drop にしない (後で削除されても、その時は効いていた)。
  - `node.remove` のカスケード削除で消えたエッジへの setter は `missing-target` になること
    (存在集合の更新規則が `applyOp` と揃っているかの確認)。
  - 🔴 **グループを消したときの子孫**も同じく `missing-target` になること。ここは
    2026-09-07 まで抜けていた — `removeNode` が「`applyOp` と同じ」と書かれていながら
    端点を失うエッジしか消しておらず、子孫が live に残っていた。projection では消える
    ノードへの setter が applied に数えられ、**落ちた op を数えるというこのモジュールの
    目的そのものが崩れていた**。カスケードだけは規則を `cascade.ts` に一本化して共有し
    (Phase 3 T0)、projection の結果と突き合わせる形で回帰を固定した。
  - `node.setParent` で後から子になったノードも、親の削除で消えること。カスケードは
    op ではなく**そのときの親子関係**に依存するので、所属先の変更を追わないとずれる。

- **warn に留めるもの** (FAIL にしない):
  - `redundant-remove`: 不在対象への remove。削除は冪等なので異常ではない。
  - `orphan-decoration`: 対象不在の layout / style。`applyOp` は対象の有無に関わらず
    Map へ書き込むので**落ちてはいない**。孤児として保持されるだけなので警告に留める。

- **順序非依存**: 入力の配列順を入れ替えても結果が変わらないこと。`orderBatches` で
  整列してから判定していることの確認。実機の op-log は受信順で並ぶため必須。

- **実物との突き合わせ**: `unknown-sheet` を報告したケースについて、`projectFile` の
  実際の出力からもノードが消えていることを確認する。第 2 の実装が本物からずれていないか
  を、判定と実物の両方を走らせて裏取りする。

### node.setLabel も対象不在を数える (Phase 5 P1)

`REQUIRES_TARGET` は「`applyOp` が `if (node)` / `if (edge)` で守っている分岐」の写しである。
`node.setLabel` はその分岐を持つので、載せないと**落ちた op を数え損なう**。

型が守ってくれない所であることに注意する — `REQUIRES_TARGET` は
`Partial<Record<Op['kind'], ...>>` なので、**新しい op を足しても抜けは型検査に出ない**。
テストで見るしかない。
