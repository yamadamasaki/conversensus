# flowContext.test.ts — node の操作の文脈のテスト仕様

## 何を

React Flow の node・edge から、module に渡す文脈 (`NodeActionContext`) を作る `sheetOfFlow`・`actionContextOf`
(計画 node-actions-request-module.md N2) を検証する。

## なぜ

module は React Flow を知らず、Sheet の形だけを読む (計画 §3.2)。画面には**ゴースト** (消す予定の表示) が
混ざるので、ここで落とさないと、消える node が操作の対象になったり、消える edge が状態の導出
(依頼の「回答あり」など) に数えられたりする。

## どのように

例で確かめる。

- Sheet の形にするとき、ゴーストの node と edge は数えない
- 文脈は、対象の node・Sheet・操作する人・参加者を持つ
- 無い node・ゴーストの node には文脈が無い (操作の対象にしない)
