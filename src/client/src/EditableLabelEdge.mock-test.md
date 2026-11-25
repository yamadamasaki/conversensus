# EditableLabelEdge テスト仕様

## 何をテストするか

`EditableLabelEdge` カスタム edge コンポーネントのインタラクション動作。

## なぜテストするか

- ダブルクリック→インライン編集→確定/キャンセルの状態遷移は UI の核心機能
- IME (日本語入力) の Enter 誤確定バグは発生しやすく, 回帰しやすい
- `setEdges` の呼び出し有無でビジネスロジック（永続化フロー）の正確性を担保する

## どのようにテストするか

`@testing-library/react` + `happy-dom` で DOM 環境を構築。
`@xyflow/react` を `mock.module()` でスタブ化し, `useReactFlow().setEdges` の呼び出しを検証。
`EdgeLabelRenderer` はポータルをバイパスして children を直接レンダリングするスタブに差し替える。

| テストケース | 検証内容 |
|---|---|
| ラベルを表示する | `label` が span として描画される |
| ラベルが空/未定義の場合は span を表示しない | 空の button が描画されるが textbox は現れない |
| ラベルをダブルクリックで編集モードに切り替わる | dblclick 後に textbox が出現し value が現在のラベル |
| ラベルなしでもボタンのダブルクリックで編集モードに切り替わる | 空ラベルでも button をクリックすれば編集できる |
| Enter で確定し setEdges を呼び出す | `setEdges` が 1 回呼ばれ, input が消える |
| Escape でキャンセルし setEdges を呼ばない | `setEdges` が呼ばれず, input が消える |
| onBlur で確定し setEdges を呼び出す | blur 時に `setEdges` が呼ばれ, input が消える |
| IME 変換中は Enter で確定しない | `compositionStart` 後の Enter は無視される |
| compositionEnd 後は Enter で確定できる | `compositionEnd` 後の Enter で `setEdges` が呼ばれる |

## 向かい合う辺 (#256)

端の接続点を持たない edge の向かい合う辺は、**この部品ではなく GraphEditor が接続点として渡す**
(`graph/facingSides.ts` の `withFacingHandles`、テストもそちら)。以前はこの部品が `useInternalNode` で
node を測って線の端だけをずらしていたが、付け替えのつかみ所は React Flow が別に描くので、線の端と
つかみ所がずれて付け替えられなかった (template-update 段 2 の実機の確認 W7)。この部品は渡された端を
そのまま使う。

## 別のプロセスで走らせる (#265)

`mock.module` はプロセス全体に効き、取り消せないので、このファイルは `*.mock-test.tsx` として他のテストと別の
プロセスで走らせる (`bun run test:mock`)。`@xyflow/react` は本物を再エクスポートして差分だけを替える — 名前が欠けると、
この部品が間接に読むモジュールの読み込みが壊れる (単独で走らせると `MarkerType` が見つからずに落ちていた)。

## 種類の名前を見る人の言語で出す (#356)

- **label は context (`KindLabelProvider`) の訳で出す**。context には edge であること・edge の property・元の label を
  渡す。訳すかどうか (種類の名前か、書き換えた label か) は shared の `displayKindLabel` が決める
  (`kindLocale.test.md`)。ここでは部品が context を通して描くことと、渡すものを固める

## 名前を変えたときの訳 (template-update D4 の後)

- **画面の言語の訳 (`label:ja`) があれば、label と一緒に書き換える**。template graph で edge の種類の名前を
  変えても、種の訳が残っていると表示は訳が勝つ。`EDGE_RELABELED` の `translation` に載せる (node の label と同じ、
  `renamedTranslation`)

## 種類の規則を外れた edge (template-update D5)

pull で template が変わり、既にある edge が種類の規則を外れたとき (種類が消された・端の組が許されなくなった)、
消しも置き換えもせず印で見せる (計画 K2、Q6 案 A)。判定は GraphEditor が `edgeViolationOf` で行い、
`EdgeViolationProvider` で渡す。

- **外れていれば線に印 (`data-edge-violation`、警告色の破線) を付け、hover で理由を出す** (線の当たり判定の
  path の `<title>`)。label の枠にも同じ理由を `title` で付ける — 線は細くて hover しにくい
- **外れていなければ印も理由も無い** (context の既定は「外れていない」)
