# project.test.ts — projection のテスト仕様

## 何を

`project.ts` の `projectBatches` (統一イベント → グラフ状態の fold)、`toSheet`、`projectFile` (Batch[] → `GraphFile`, W3 読み取り経路) を検証する。

## なぜ

projection は step1 §4 の「集約は projection (導出ビュー)」を実現する要。エディタ・エクスポート・拡張エンジンがすべてこの導出結果を読むため、畳み込みの意味論 (LWW・カスケード削除・layout の部分更新) を正確に固定する必要がある。`projectFile` は複数シート + ファイルメタを op-log から導出する読み取り経路 (D4) の中核で、content/構造の分離とシート順序の reconcile が正しいことを固定する。

## どのように

- **状態構築**: node.add / edge.add から nodes / edges マップが構築されることを確認する。
- **LWW (投入順非依存)**: 同一ノードへの content 変更を、投入順を入れ替えて渡しても clock 昇順で解決され、clock 最大が勝つことを確認する。決定論的なマージの土台。
- **カスケード削除**: node.remove が接続エッジも削除する (現行 `applyEvent` の NODE_DELETED と同じ挙動) ことを確認する。
- **layout の部分更新**: 移動 (x/y) と リサイズ (width/height) を別々の setLayout で与えても合成されることを確認する。滑らかな移動・リサイズを独立イベントとして扱うため。
- **presentation の分離**: presentation op (edge.setStyle 等) は presentation マップに入り、意味的な状態 (edges の properties 等) に影響しないことを確認する (D7: presentation はローカル限定)。
- **toSheet**: projection が既存の `Sheet` 形式へ変換されることを確認する (現行資産との接続点)。

### projectFile (W3 読み取り経路, §3.3)

- **基本射影**: `file.setName` + `sheet.create` + content batch から `GraphFile` (id・name・シート) が導出されることを確認する。
- **content のグルーピング**: content batch が `sheetId` で正しいシートへ振り分けられることを確認する。1 ユーザー操作 = 1 シート内完結の前提 (§3.1) を固定する。
- **sheet.remove**: 削除されたシートとその content が射影から消えることを確認する (remove-wins + 削除シートの content は射影時に無視, critic H2-new)。
- **順序の reconcile**: 最新 `sheet.reorder` の順に並べ、order に無い live シートを createClock 昇順で末尾に追加することを確認する (レビュー H2, 孤立シートを表示から落とさない防御)。
- **未作成シートの防御**: 存在しないシートを指す content batch は無視されることを確認する (壊れた入力でも落ちない)。
- **メタの LWW**: `sheet.setName` / `file.setDescription` が後勝ちで反映されることを確認する。

### orderBatches の順序規則 (Phase 4d-3, 設計 §3.2b)

tiebreak を **`clock → timestamp → id` から `clock → actor → id` へ変更**した。

**なぜ**: 第 2 キーの `timestamp` は端末のウォールクロックであり、端末間では信頼できない
(ずれ・巻き戻り・タイムゾーン設定ミス)。単一端末では clock が一意なので実質使われない
キーだが、**受信では常時 tiebreak の主役になる**。同一 clock の衝突は偶然ではなく構造的に
起きる — 同一 snapshot から genesis した端末は同じ連番 clock を seed し、同じ値から発番を
始める (設計 §1.1)。`actor` は端末一意の識別子 (4d-2, `did#deviceId`) なので端末間でも安定する。

**退行しないことは構造的に言える**: `LamportClock.tick()` は単調増加なので同一 actor 内で
clock は必ず一意であり、単一 actor では第 2 キーが発動しない。これをテストで機械的に固定する。

- **単一 actor での退行なし**: 同一 actor・一意 clock の batch を timestamp 逆順で与えても、
  clock 昇順で解決されることを確認する。timestamp が順序に影響しないことの直接の証拠。
- **同一 clock・異なる actor**: timestamp を逆にしても actor 昇順で順序が決まること、
  かつ投入順を入れ替えても同じ結果になること (決定論的な全順序) を確認する。
- **clock も actor も同一**: id (UUID) の辞書順で決まることを確認する。最終の tiebreak。

### foldFileStructure の現挙動の固定 (Phase 4d-3, 設計 §3.2 / §1.4)

**4d では `foldFileStructure` を変更しない。** 順序規則の変更が構造の畳み込みへどう波及するかを
固定し、4e で改善するときの回帰検出点にする。ここを 4d で触ると 4d-3 のスコープが破裂する。

`applyFileOp` は `clock` を引数に取りながら `sheet.create` の `createClock` にしか使わず、
`file.setName` / `sheet.setName` / `sheet.reorder` は**比較なしの逐次上書き**である。つまり
「LWW」ではなく「**整列後の最終適用が勝つ**」— `orderBatches` の順序を変えれば挙動が直接変わる。

- **`sheet.setName` の逐次上書き**: 同一 clock で actor の異なる 2 つの setName を与え、
  timestamp ではなく actor 昇順で後になった方が勝つことを確認する。
- **`sheet.reorder` の後勝ち**: 並行する 2 つの reorder をマージせず、順序で後になった方の
  order が丸ごと採用されることを確認する (片方の並べ替えが捨てられる。4e で見直す対象)。
