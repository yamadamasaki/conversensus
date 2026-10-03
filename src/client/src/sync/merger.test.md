# merger の姿のテスト

## 何を

- `mergerSnapshot` — merger が並べる 3 つの姿 (merge 元・merge 先・merge 後) と競合を、op-log から求める
  (step3 Phase 5 S5-0)
- `carryChecks` / `allChecked` — conflict list のチェック状態の引き継ぎと、merge を押せるかの判定

## なぜ

merger は「merge したらこうなる」を見せて、利用者がそれを直してから merge する道具である。**見せた
merge 後の姿と、実際に merge した結果が食い違えば、merger は嘘をつく** — 利用者が確かめた姿と違うものが
trunk に載り、しかも merge は追記なので戻せない。

だから merge 後の姿は実際の merge と**同じ計画** (`planMerge`) から作り、点だけを仮に振る。その一致は
「あらゆる歴史で」の主張なので性質として書く。

## どのように

### 生成器

- 分岐点までの trunk はシートと node n1。その後に trunk (bob) と branch (alice) へ交互に編集を積む
- node は 3 つの**小さなプール**、本文は 2 種類。両側が同じ node を触る (競合する) 場面に当たるため
- 1 度 merge した後に続けて編集し、もう一度見る歴史も引く (写し済みの元を落とす経路)

### 性質

| 性質 | 固定すること |
| --- | --- |
| merge 後の姿 = 実際に merge した後の trunk の姿 | merger が見せる姿が嘘をつかない |
| 1 度 merge した後に続けて編集しても、merge 後の姿 = 2 度目の merge の結果 | 写し済みを落とす経路でも一致する |

### 例

- 元は開いた時点 (`startedAt`) の branch、先は trunk の最新、後は branch の勝ち。両側が同じ node を書き換えたら
  競合になり、対象は分岐点での名前で呼べる。`startedAt` は**全 actor を含む vector** でなければならない (genesis を
  外すとシートの作成まで切断面の外に出る)
- チェック状態: 残っている競合のチェックは引き継ぎ、消えた競合のチェックは捨てる。すべてにチェックが入ったとき
  だけ merge でき、新しい競合が増えたら押せなくなる

## 変異で確かめたこと

- 写しの点を trunk の下に潜らせる → 性質 2 つと例が落ちる
- 写し済みの batch も二重に写す → **落ちない (等価な変異)**。projection が「承認を経ていない再 merge の写し」
  (同じ元を指す 2 つ目以降の写し) を画面に出さない規則 (D3) を持つので、二重に写しても姿は変わらない

## 差分の印と競合の対象 (S5-1b)

- `diffMarks(base, current)`: 足した node は追加、本文が違う node は変更、同じ node は印なし。**消えた node は
  印を付けない** (`current` に居ないので、描く場所が無い)
- `conflictTargets`: 競合の対象の id の集合 (同じ対象の競合が複数あっても 1 つ)
