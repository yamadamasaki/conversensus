# node・edge に書いた人を表示する (#354、設計 D2a、実装計画)

> 設計: [agent-actor.md](../architecture/step4/agent-actor.md) D2a (A8)。前の段: agent の宣言 D2 (PR #365)。
> issue: #354。branch: `step/authors-354`。

## 1. 目標と完了基準

誰が書いた node・edge かを avatar で表示する。人間にも agent にも同じく効き、agent は見分けられる。

**完了基準**:

1. 「書いた」の定義どおりに作者を導く。作者は op に既にあるので、op-log からの導出で足りる (op は足さない)
   - 数える: その要素の意味を変える op。作成 (`node.add`・`edge.add`)、中身・ラベル・プロパティ・親・つなぎ替え
     (`setContent`・`setLabel`・`setProperty`・`setProperties`・`setParent`・`reconnect`)
   - 数えない: 位置と見た目 (`setLayout`・`setStyle`・`setLabelOffset`)、消すこと
   - 並べ方: 作った人を先頭に、あとは最後に書いた順 (新しい順)
2. node には常に、edge には選んだときに、avatar を出す。多いときは重ねて出し、hover で広げてハンドル名を出す
3. avatar はハンドル名の頭文字の丸で、色は DID から決まる。agent は bot の印 (裏付けありは実線、名乗りのみは点線)
4. ヘッダで avatar を on/off できる (既定は on、端末に覚える — map の on/off と同じ)
5. 開発用の環境で、人間 2 人と agent が書いた node に avatar が出ることを手で確かめる

**非目標**: Bluesky の profile の画像、group の node の avatar、作者での絞り込み・検索。

## 2. 決めたこと (利用者 2026-11-10、すべて推奨案)

- avatar は**頭文字の丸 + DID の色**。agent は bot の印
- **node は常に、edge は選んだとき**
- **ヘッダで on/off、既定は on**

## 3. スライス

| | 内容 | 確かめ方 |
| --- | --- | --- |
| W1 | 作者の導出 (`authorsOf(batches)`: 要素 → DID の列)。shared の純粋な関数 | 単体 + 性質 |
| W2 | 画面に作者を降ろす: File の op-log を読み、変わったら読み直して作者を導く (`useElementAuthors`)。ハンドル名と agent の宣言も引く。context で node・edge の部品へ | 単体 |
| W3 | avatar の部品 (頭文字の丸・色・bot の印・重ね・hover で広げる)。node の角 (`EditableNode`・`ImageNode`) と、選んだ edge の label のそば (`EditableLabelEdge`) | 単体・App 結合 |
| W4 | ヘッダの on/off (既定 on、端末に覚える) | 単体・App 結合 |
| W5 | 開発用の環境で手で確かめる | 利用者 |

### 3.1 進捗

| | 状態 | メモ |
| --- | --- | --- |
| W1 | 済 | shared の `events/authors.ts` (`authorsOf`)。数える op は作成・中身・ラベル・プロパティ・親・つなぎ替え。並べ方は畳み込みと同じ物差し (`compareByClockActorId`)。未ログインの actor は数えない。性質 2 つは、壊し方 2 つで落ちることを確かめた |
| W2 | 済 | `useElementAuthors` (trunk と見ている branch の op-log を読み、正典が変わったら読み直す。作者のハンドル名と agent の宣言も引く)、`AuthorsProvider`/`useAuthorsView` (React Flow が描く部品へ降ろす)。agent の宣言の入れ物は参加者一覧と同じもの (`agentDeclarationCache`) にした — 一覧で認めた結果が avatar にも効く |
| W3 | | |
| W4 | | |
| W5 | | |
