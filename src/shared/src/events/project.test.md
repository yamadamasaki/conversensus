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
