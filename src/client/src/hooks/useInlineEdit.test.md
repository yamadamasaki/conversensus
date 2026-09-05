# useInlineEdit.test.tsx — インライン編集の読み取り専用ゲートのテスト仕様

## 何を

`useInlineEdit` が**読み取り専用のときに編集へ入らない**ことを検証する
(step2 Phase 2 S6)。

## なぜ

再参加した actor は、同期が済むまでその File を読み取り専用にする (`syncObligation.test.md`)。
インライン編集の入口は `EditableNode` / `GroupNode` / `EditableLabelEdge` / `ImageNode` の
4 つあるが、**`useInlineEdit` に畳まれている**。判定をここに置くのは、
**4 箇所それぞれで見ると足し忘れた 1 つから編集できてしまう**からである。

**入ってから confirm を捨てる形にしない。**それだと画面には編集後の文字が出たまま
op-log には入らない状態が生まれ、次の再 projection で黙って戻る —
「読めない」ではなく「別のものが正しく見える」形の不具合になる。

## どのように

- **通常は編集に入れる** (ゲートが常時 on になっていないこと)
- **⚠️ 読み取り専用なら編集に入らない。**`editing` が立たないことで見る
- **Provider が無ければ編集できる。**既定値は「編集できる」である —
  置き忘れで利用者の操作を奪わない (`imageErrorContext` と同じ判断)

## 引かなかったもの

- **読み取り専用になる条件**は `syncObligation.test.md` が持つ
- **React Flow 側のゲート** (動かす・繋ぐ・繋ぎ替える) は `GraphEditor` の props であり、
  ライブラリの挙動を確かめることになるのでここでは見ない
