# step2 Phase 1 設計: 判断ログ (名簿)

> 2026-08-31 / 仕様: [participation](../requirements/spec/participation.md) /
> アーキテクチャ: [step2](../architecture/step2.md) §2〜§4 /
> 計画: [step2-implementation](./step2-implementation.md) の Phase 1
>
> 前提となるスパイク: [u6-p2-report](../spikes/u6-p2-report.md) (畳み込みの分離) /
> [u6-p1-report](../spikes/u6-p1-report.md) (他 actor の repo の読み)

## 0. この Phase が決めること

名簿を op-log として持つ。**op を clock 順に畳みながら pre 条件を検証し、満たさないものを
捨てる**のが中核で、これによって「招待されていない actor の承認は無効」と「取り消し合いが
起きても誰の手元でも同じ結論になる」が同時に決まる。

Phase 0 のスパイクが答えを 2 つ持ち込んでいる。

- **判断の畳み込みはグラフの畳み込みと分離できる** (P2)。分岐は要らず、述語で filter する
- **判断ログとグラフの op-log は同じ clock 空間を共有しなければならない** (P2)。
  pre 条件が「この操作より前」だから

## 1. 「名簿 collection」ではなく「判断ログ collection」として切る

**名簿専用に切ってはならない。**DtR の承認も同じ「pre 条件を検証して捨てる」畳み込みなので、
狭く切ると Phase 6 で 3 つ目の collection が要る。広く切るコストは命名と lexicon の形だけで、
**改名の最後の機会がこの Phase である** (architecture §4.3)。

### NSID

```
app.conversensus.graph.judgment
```

`app.conversensus.graph.*` の名前空間を保つ (既存の 10 個と揃える)。`judgment` は
architecture が「判断ログ」と呼んでいる語をそのまま採る。

**`participation` にしない理由**は上のとおり — 承認が入らなくなる。逆に
`app.conversensus.judgment` と `graph` を外さないのは、既存の NSID がすべて `graph.` の
下にあり、ここだけ外すと lexicon の置き場 (`lexicons/app/conversensus/graph/`) も割れるためである。

### 1 レコード = 1 batch (op の列)

グラフ側と同じ形にする。**op 単位のレコードにしない。**

- 「招待して同時に別の誰かを取り消す」のような複数 op の原子性が要る
- **clock を batch が持つ**ので、グラフ側の batch と同じ規則で全順序に並べられる (下記 §2)
- rkey スキームもグラフ側をそのまま流用できる

### rkey

```
v1~<fileId>~<clock を 12 桁ゼロ詰め>~<batchId>
```

グラフ側 (`batchRkey`) と同一。**理由は多アクタで効く** — 「actor X の repo から file f の
名簿だけを読む」を prefix 範囲取得で行えなければ、相手の判断ログを全部読むことになる。
P1 スパイクが示したとおり、**相手の repo は自分のより大きいのが普通である**。

`batchRkey` は fileId / clock / batchId しか見ないので、そのまま再利用してよい。

## 2. ⚠️ clock 空間はグラフと共有する

**判断ログに独立した採番を作ってはならない。**

pre 条件は「記録された呼び出し対象の全員の承認が、**この操作より前に**記録されていること」
のように「より前」を含む。判断ログとグラフの clock が別空間だと、承認が実際には先に
起きているのに数として比べると後になり、**正当な再 merge が落ちる** (P2 スパイクの検証 5)。

現状の `LamportClock` は端末に 1 つなので、**同じ writer を通す限り自然に共有される**。
Phase 1 で判断 op を書く経路を作るとき、そこで新しい採番器を作らないこと。

collection を分けることと clock 空間を分けることは別である。**分けるのは畳み込みの意味論だけ**。

## 3. op 語彙

| op | 意味 | pre 条件 |
| --- | --- | --- |
| `participation.genesis` | この file の最初の参加者を宣言する (§4) | 同じ fileId の genesis が未出 |
| `participation.invite` | a が a' を招待する | a ∈ participatingActors かつ a' の DID が自 PDS に属する |
| `participation.accept` | 招待を承認する | 発行者 ∈ invitedActors |
| `participation.resign` | 参加を取りやめる | 発行者 ∈ participatingActors |
| `participation.revoke` | a' の招待/参加を取り消す | a ∈ participatingActors かつ a' ∈ invited ∪ participating |

**取り消しは承認の前後を問わず 1 つの op** である (仕様の決定)。`invite` の取り消しと
`accept` 後の取り消しを別の op にすると、境界で「どちらでもない」状態が生まれる。

**断る op は設けない** (仕様)。承認しなければよい。

> Phase 6 の DtR 承認 (`dtr.open` / `dtr.approve`) も同じ collection に入る。
> **この Phase では実装しないが、語彙の形は今の判断と食い違わせないこと** —
> P2 スパイクの `judgmentFold.ts` が置いた形が下敷きになる。

### 被招待者の DID が自 PDS に属することの検証

仕様は他 PDS のアカウントの招待を「やらない」ではなく**「無効とする」**と書いている
(`spec-step2.md`)。したがってこれは UI の入力チェックではなく **pre 条件の一部**であり、
projection の段階で落ちる。

判定は DID の解決先が自分の PDS かどうかで行う。**UI の入力はハンドル名**なので、
`com.atproto.identity.resolveHandle` で DID に直してから参加コードに載せる。

## 4. ⚠️ 名簿の起点をどう置くか (事実 7)

**「file を作った actor が自動的に参加する」を成立させる手段が現状ゼロである。**
`file.create` op が無く、genesis batch の actor は `GENESIS_ACTOR` という固定文字列なので、
**作成者の DID が op-log のどこにも載っていない**。最初の 1 人が決まらないと最初の招待が
pre 条件で落ち、誰も参加できない。

### 判断ログ側の genesis op で置く (採用)

`participation.genesis` を判断ログに置き、発行者自身を最初の参加者とする。

**却下したのは「グラフ側に `file.create` op を足して作成者の DID を載せる」案**である。
これをやると**判断の畳み込みがグラフの畳み込みに依存する**。P2 スパイクが確かめた
「依存は一方向 (判断 → グラフ)」がここで崩れ、Phase 6 の承認まで巻き込んで循環する。
名簿の起点は名簿の中に置く。

### 自己申告でよい理由

「自分が作った」と誰でも宣言できるように見えるが、問題にならない。**名簿の読み出しには
起点があり、起点と繋がっていない genesis はそもそも読まれない**からである。

起点は architecture §2「名簿の読み出しは不動点計算になる」が既に 2 つ挙げている。

- 既に参加している actor: **自分自身**
- まだ参加していない被招待者: **参加コードが指す招待者の DID**

この Phase が足すのは、**その起点の repo に何があれば名簿が始まるか**の答えである。
それが `participation.genesis` で、起点の repo にこれが無ければ名簿は空のままになる。
不動点計算の側から見れば、genesis は**初期値**にあたる。

### 既存 File の bootstrap

step1 で作った File には genesis が無い。**移行が要る。**

- 起動時に、ローカルの各 File について judgment ログを見て、genesis が無ければ
  **今ログインしている DID を genesis として書く**
- step1 の File は単一 actor で作られているので、これで取り違えは起きない
- 移行の marker は既存の rkey 移行 (`migrateRemoteRkey.ts`) と同じ形で DID 単位に持つ

## 5. projection は「確定した名簿」と「捨てた op」の両方を返す

UI の一覧に **`invalid`** (招待されていない actor が承認しようとした) を出すと決めた以上、
**捨てて終わりにしてはならない**。捨てた op とその理由を返さないと画面に出せない。

```
foldParticipation(batches) -> {
  participating: Set<Did>,        // 確定した名簿
  invited: Set<Did>,              // 招待済・未承認
  history: ...,                   // 参加期間 (同期のフィルタに使う)
  rejected: { op, reason }[],     // 捨てた op と理由 ← invalid の表示元
}
```

`rejected` はグラフ側の projection には存在しない出力である。**「無効な op がある」という
名簿側の意味論が、そのまま型に現れる**箇所なので、ここを削らないこと。

状態の対応は仕様の UI 例のとおり: sent / accepted / revoked / resigned / **invalid**。

## 6. 読み出しのパス数 (U1)

**名簿は自分の repo だけでは作れない。**「a が a' を招待した」op は a の repo にあるので、
名簿に載っている全 actor の judgment を読む必要がある。誰を読むかを名簿が決め、その名簿は
読んだ結果で決まる — **不動点計算**である。

**既定は 1 パスとする。**

- 種の repo を読む → そこで得た participating の全員の repo を読む → 畳む
- ここで新しい actor が増えても、**そのパスでは読みに行かない**
- 増えた分は次の同期で拾う。**名簿の食い違いは仕様が許容すると決めている**

収束まで回すとラウンドトリップが名簿の深さに比例する。招待の連鎖が深いほど遅くなり、
しかも**遅れて見えることは仕様上の異常ではない**ので、待つ価値がない。

> U1 のもう半分「食い違いの見せ方」は UI の判断なので、この設計では決めない。
> ただし **`rejected` があれば「知らないだけ」と「無効」を区別して見せられる**ことは
> ここで担保しておく。

## 7. 参加コード

招待者 DID + 被招待者 DID + fileId を JSON にして圧縮・エンコードしたもの。

**秘密ではない。**本人以外の承認は projection の pre 条件で落ちるので、第三者が入手しても
参加できない。したがって暗号的な要求は無く、**署名も要らない** — 署名を足しても
「招待者の repo にその invite op があるか」を確かめる方が確実で、そちらは無料である。

被招待者は参加コードを受け取ったら、**招待者の repo の judgment を 1 レコード読んで**
「本当に自分が招待されたか」を確かめられる。仕様が名簿を別 collection にした理由の 1 つが
これである (被招待者はまだ参加者ではないので、招待者のグラフを読む筋合いがない)。

## 8. テストの方針

**pre 条件の網羅から書く。**ここが名簿の中核だからである。

例で書くもの (具体的な振舞いの固定):

- 招待されていない actor の承認が捨てられる
- 取り消し合い: a が a' を取り消した後、それを知らない a' が出した「a の取り消し」が捨てられる
- 他 PDS の DID への招待が捨てられる
- genesis が 2 つ来たら 2 つ目が捨てられる

**性質で書くもの** (CLAUDE.md「全称命題は性質として書く」):

- **∀ 配送順. 同じ op 集合を畳めば同じ名簿になる** — これが「誰の手元でも同じ結論」の
  本体で、例ベースでは原理的に書けない
- **∀ op 列. 捨てられた op を取り除いてから畳んでも、結果は同じ** (`rejected` の健全性)

生成器は **actor を 3〜4 人の小さなプールから引く**こと。値を広く振ると同じ actor に対する
invite / revoke が並ばず、**取り消し合いに当たらない** (PBT パイロットの教訓と同じ形である)。

## 9. この Phase で作らないもの

- **DtR の承認** (`dtr.open` / `dtr.approve`)。collection と語彙の形は今そろえるが、実装は Phase 6
- **他 actor のグラフの同期**。名簿ができても、それを使ってグラフを読むのは Phase 2
- **参加期間によるフィルタ**。名簿は期間を持つが、それで batch を絞るのは Phase 2

## Exit

招待 → 承認で名簿に載り、取消で外れる。**取り消し合いを両方の端末で畳んで結論が一致する。**
