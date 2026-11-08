# requestTarget.test.ts — 画面と依頼の操作のつなぎのテスト仕様

## 何を

`requestTarget.ts` (React Flow の node・edge から区画が描く状態を作る `requestTargetOf` と、区画のボタンを
GraphEvent にする `requestEventFor`、agent 段 4 R4) を検証する。

## なぜ

画面の state は React Flow の形で、状態の導出 (`requestStatus`) と操作 (`requestEvents.ts`) は Sheet の形を
受ける。ここで形を移し替えるときに、**消す予定の表示 (ゴースト) を数えると**、消した答えで「回答あり」に
見える。

## どのように

- 応答を求める node なら状態・送った回数・宛先を返し、違えば undefined
- ゴーストの答えの edge は数えない
- ボタンを GraphEvent にする: 送る → `sent` + 1、答える → 利用者の言語の label の付いた edge
- canvas に無い node には何もできない (`RequestActionError`)
