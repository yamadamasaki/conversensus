# template の種類の名前を言語ごとに表示する (#356、実装計画)

> 設計: [agent-actor.md](../architecture/step4/agent-actor.md) D6 から切り出し。issue: #356。
> branch: `feature/kind-i18n-356`。改める決定: #330 案 B (`src/shared/src/template/seedLocale.ts`)。

## 1. 目標と完了基準

template の種類の名前は、作った人の言語で File に焼き込まれる。参加者の言語が違うと読めない名前が出る。
template graph に言語ごとの名前を持たせ、**見る人の言語で表示する**。

**完了基準**:

1. template graph の種類の node・edge に、言語ごとの名前 (と node の説明) を property で持たせられる。
   利用者が property を編集すれば訳を足せる (コードを変えずに多言語の template が作れる)
2. 当てたシートで、種類のメニュー (node・edge) と、種類を持つ node・edge の label が、見る人の言語の訳で出る。
   訳の無い言語では template graph の名前のまま
3. 利用者が書き換えた label (種類の名前でもその訳でもないもの) は、そのまま出す
4. **データは変えない。**node を作るときに書く label は今までどおり種類の名前 (template graph の label)。
   同じ File を、言語の違う参加者がそれぞれの言語で読む
5. 作り込みの種 (Toulmin・依頼・相談) を File に複製すると、種が持つすべての言語の訳が property として入る
6. 開発用の環境で、日本語と英語の参加者が同じシートをそれぞれの言語で読めることを手で確かめる

**非目標** (利用者 2026-11-11): template の名前 (template graph のシートの名前) の訳、headless の encoding の訳
(agent には template graph の名前のまま渡す)。既にある File の種 (訳を持たずに焼き込まれたもの) を後から多言語にする
こと — 利用者が property を足せばよい。

## 2. 設計

### 2.1 訳の置き場所: 種類の node・edge ごとの property (利用者 2026-11-11)

```
[主張] node (template graph)          [支える] edge (template graph)
  label:en       = Claim                label:en = supports
  label:ja       = 主張
  description:en = The conclusion ...
```

- **種類の隣に置く。**表を 1 か所にまとめると、種類の id (NodeId、UUID) をキーに書く必要がある。種類ごとなら
  id を書かずに済み、種類を消せば訳も消え、複製でも付いてくる
- 名前は `label:<言語>`・`description:<言語>` (言語は client の `Locale` と同じ綴り)。利用者が書く property なので
  system の名前空間 (`app.conversensus.`) には置かない
- これらは**既定値から外す** (`templateFromSheet` の `defaultsOf`)。外さないと、当てたシートの node ごとに訳が
  複製される
- `Template` の種類は `labels` (と node の `descriptions`) として持つ。`templateGraphOf` は逆に property へ書くので、
  往復の性質はそのまま成り立つ

### 2.2 表示: 書き換えていなければ訳す (利用者 2026-11-11)

当てたシートの node・edge の label は、作るときに種類の名前が書き込まれ、headless などからは書き換えうる
(画面では種類の label は変えられない)。表示は次で決める:

- その要素が種類を持ち、label が**その種類の名前かその訳のどれか**に等しければ、見る人の言語の訳を出す
  (無ければ template graph の名前)
- それ以外 (書き換えた label・種類を持たない要素) は label のまま

訳の一覧と照らすのは、別の言語の名前で焼き込まれた既にある File (#330 案 B で英語の参加者が作った種) も訳すため。
データは変えないので、既にある File もそのまま訳される。

照合と選択は shared の純粋関数 (`displayKindLabel`) に置き、画面は context で node・edge の部品に渡す。
label を描く所だけが訳を使い、編集・diff・保存は今までどおり生の label を扱う。

### 2.3 種

`localizeSeed` は今までどおり作った人の言語の名前を template graph の label にする (表の名前)。それに加えて、
種の表の言語 (日本語) と `translations` のすべての言語の名前・説明を `labels`・`descriptions` に入れ、
`templateGraphOf` が property として書く。#330 案 B の「表示のたびに言語で引き直さない」はこの issue で改める。

## 3. スライス

| | 内容 | 確かめ方 |
| --- | --- | --- |
| K1 | shared: 種類の `labels`・`descriptions`、`templateFromSheet`/`templateGraphOf` の往復、`displayKindLabel` | 性質 (往復・訳の選択) と例、変異 |
| K2 | 種: すべての言語の訳を template graph に入れる。`seedLocale.ts` の決定の書き換え | 単体 |
| K3 | 画面: 種類のメニューと node・edge の label を見る人の言語で出す | 単体・App 結合、変異 |
| K4 | 開発用の環境で手で確かめる (手順を user-test-environment.md に) | 利用者 |

## 4. 決定

- 訳の置き場所は種類の node・edge ごとの property (利用者 2026-11-11)
- 表示は「書き換えていなければ訳す」(利用者 2026-11-11)
- 範囲は種類の名前と説明。template の名前と headless は訳さない (利用者 2026-11-11)

### 4.1 進捗

| | 状態 | メモ |
| --- | --- | --- |
| K1 | | |
| K2 | | |
| K3 | | |
| K4 | | |
