# 既存の sheet に template を追加で当てる (#355、実装計画)

> 設計: [agent-actor.md](../architecture/step4/agent-actor.md) 問 B8 から切り出し。op の語彙は
> [step3.md](../architecture/step3.md) §3.3 D3 (コアが閉じる)。issue: #355。branch: `feature/apply-template-355`。

## 1. 目標と完了基準

今の template は sheet を**作るとき**にしか当てられない (`sheet.create.templateIds`)。既にある sheet にも
後から template を当て、種類 (例: 依頼・相談) を使えるようにする。

**完了基準**:

1. 既にある sheet に template graph を当てられる。当てた後は、作るときに当てたものと同じく種類のメニュー・
   接続の可否・property の候補が効く (画面と headless の両方)
2. 既に当たっている template graph は選択肢に出さない。当てられるものが無ければ入口を出さない
3. **op の種類は足さない**。`sheet.setProperty` で表す (D3)
4. 当てた template は**当てた時点の template graph の切断面**を指す。後で template graph を編集しても、
   当てた sheet の解釈は変わらない (作るときと同じ規則)
5. 2 人が同時に別の template を当てても、どちらも残る
6. import (#327) で、後から当てた template への参照も付け替わる
7. 開発用の環境で、依頼の template を後から当てた sheet で依頼を作って送れることを手で確かめる

**非目標** (§2 の問いで変わりうる): 当てた template を外すこと、作るときに当てたものの切断面を新しくすること、
既にある node に種類を付け直すこと。

## 2. 設計

### 2.1 表し方: template graph ごとに 1 つの sheet のプロパティ

```
sheet.setProperty  target=<当てる先の sheet>
                   name=app.conversensus.appliedTemplate.<template graph の sheet の id>
                   value={ "at": <切断面 (VersionVector)> }
```

- **template graph ごとに別のキーにする。**`sheet.setProperty` はキーごとに後勝ちなので、1 つのキーに配列を
  置くと、同時に別の template を当てたとき片方が消える (完了基準 5)。キーを分ければ両方残る
- 値の形は `TemplateSheetRef` から `sheet` を除いたもの (`sheet` はキーにある)。読むときに `TemplateSheetRef` に戻す
- 名前空間は既存の sheet のプロパティ (`app.conversensus.sheetKind`) にそろえる
- 値を消せば (`value` 省略) 外れる形になるので、外すことは後から足せる (今回は非目標)
- 持たない相手 (古い版) には、知らないプロパティとして保存して運び無視される (D3 の連続的な劣化)

### 2.2 読み方: 当たっている template の一覧を 1 か所で求める

`appliedTemplateRefs(sheet): TemplateRef[]` を shared に置き、`sheet.templateIds` を読んでいる所
(`useResolvedTemplates` の呼び出し・`Headless.encode`・`Headless` の sheet の解決・encoding の `template-ref` 行)
をすべてこれに替える。

- 並びは「作るときのもの → 後から当てたもの (template graph の sheet の id の順)」。誰の手元でも同じ順になる
- 同じ template graph が両方にあれば、**作るときのもの**を採る (後から当てる入口には出さないので、ふつうは起きない。
  同時に当てたときだけ起きうる)
- projection の畳み込み (`toSheet`) は変えない。`Sheet.templateIds` は今までどおり「作るときのもの」

### 2.3 切断面

作るときと同じく、書き込みが落ち切ってから (`trunkSettled`) 手元の trunk の op-log の vector (`heldMaxima`) を取る。
`applyTemplateGraphs` の切断面を取る所を関数に切り出して共用する。

### 2.4 画面

sheet の「…」(設定のポップアップ) に「template を当てる」を足し、今の `TemplateApplyDialog` を
「既に当たっているものを除いた template graph」で開く。template graph・metagraph の sheet には出さない。

### 2.5 import

`remapTemplateReferences` に、sheet のプロパティのキー `app.conversensus.appliedTemplate.<id>` の付け替えを足す。
切断面は `templateIds` と同じく genesis 全体にする (`importTemplateRefs.ts` の理由と同じ)。

## 3. スライス

| | 内容 | 確かめ方 |
| --- | --- | --- |
| T1 | プロパティの名前・値の形と `appliedTemplateRefs` (shared の純粋な関数) | 単体 + 性質 (並びが決まる・作るときのものが勝つ) |
| T2 | 読む所を `appliedTemplateRefs` に替える (画面・headless・encoding) | 単体・既存のテスト |
| T3 | import の付け替え | 単体 |
| T4 | 画面: sheet の「…」から当てる。既に当たっているものを除く | 単体・App 結合 (当てると種類のメニューが出る / 同時に当てて両方残る) |
| T5 | 開発用の環境で手で確かめる (手順を user-test-environment.md に) | 利用者 |

## 4. 決めたこと (利用者 2026-11-10、すべて推奨案)

- Q1 入口は sheet の「…」のポップアップ
- Q2 headless (MCP) に当てる道具は今回は足さない (後から当てたものを読むところまでは headless も対応する)
- Q3 外すことは今回は非目標 (プロパティを消せば外れる形にしておく)

### 4.1 進捗

| | 状態 | メモ |
| --- | --- | --- |
| T1 | 済 | shared の `template/applied.ts`。プロパティ名は `app.conversensus.appliedTemplate.<id>` にした (`app.conversensus.template` は template graph の種別の値として既にあり、取り違えやすいため)。性質 2 つは、並べる所と重なりを除く所を壊すと落ちることを確かめた |
| T2 | 済 | 画面 (`useResolvedTemplates` に渡す参照)・headless (`encode`・書く道具の Sheet の解決) を `appliedTemplateRefs` に替えた。encoding の `template-ref` の行は作るときのもののまま (注釈を除いた行から元に戻せる性質のため。後から当てたものは `prop` の行に出る) とし、そのプロパティに template の名前を注釈する |
| T3 | 済 | `remapAppliedTemplates`。File を丸ごと取り込んで後から当てた template が解決できることも `localStore.test.ts` で見る |
| T4 | 済 | `applicableTemplateGraphs` (入口とダイアログが同じ答えを使う)、`handleApplyTemplates` (template graph ごとに `SHEET_PROPERTY_CHANGED`)、`TemplateApplyDialog` の `apply` の形、`SettingsPopup` の口。切断面の取り方はシートを足すときと共用 (`currentCut`) |
| T5 | 済 | `user-test-environment.md` §5.11。利用者が確認した (2026-11-11) |

