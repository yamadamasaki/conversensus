# property editor

## Property

conversensus は, Labelled Property Graph をベースとしているので, node と edge はプロパティのリストを持つ. 各プロパティは名前, 型, 値から成る.

名前は任意の文字列だが, 後述するような規約に則るものとする.

値も任意の文字列だが, 型に基づく制約を受ける. ただし, 実際の型制約のチェックは今回は行わない (→ step 3).

## 型制約

型は以下のものを許す.

- string
- number
- boolean
- date/datetime
- `[]` 配列リテラル
- `|` ユニオン・リテラル

step 3 以降は, JSON, Node, Edge, File, Sheet, RDF schema などを追加するかもしれない (→ step 3).

## 名前

判定規則は **「名前が `.` を含むか否か」の一点**である.

| 種類 | 名前 | 例 |
| --- | --- | --- |
| システム (system) | `app.conversensus.*` | `app.conversensus.image` |
| 拡張 (extension) | 拡張システムの提供者のドメイン (逆順) | `jp.co.metabolics.claim` |
| カスタム (custom) | **`.` を含まない任意の文字列** | `期限`, `優先度`, `出典` |

- system: 通常, ユーザには不可視, 変更不可
- extension: 一部は不可視. 可視性は拡張システム側で制御する. その他は可視で, 可視である以上変更可能
- custom: グラフの編集者が必要に応じて自由に付けられる

**custom に名前空間を要求しない**のは, custom には衝突相手がいないからである. system と extension は, conversensus 本体と複数の拡張提供者が同じグラフに書き込むので名前空間が要る. 一方, 同じ File の共同作業者どうしが `期限` というキーを使ったら, それは衝突ではなく同じことを指している. `alice.期限` と `bob.期限` に分かれる方が困る. プロパティはグラフのコンテンツなので, 共同作業者の間で共有されるべきものである.

`date` のような無限定な名前も custom では許す. system の `app.conversensus.date` とは別物として共存できるし, 短くて自然な名前を自由に使えることが custom の存在理由である.

なお [ATProto の Lexicon style guide](https://atproto.com/ja/guides/lexicon-style-guide) は識別子に逆順ドメインを要求するが, あれは repo の record 名 (NSID) の規約であって, record の中身にあるプロパティのキーを縛るものではない. system と extension はこれに揃えるが, custom は対象外とする.

システムによるチェックは少なくとも step 2 では行わない (→ step 3).

## 既存のプロパティ

現時点で実際に使われているプロパティは, すべて画像に関するものである.

| キー | 値 | 状態 |
| --- | --- | --- |
| `image` | `{cid, mimeType, size}` の構造体 | 現行 |
| `imageUrl` | string | 現行 |
| `imageBlobCid` | string | 旧形式 (読み取りのみ) |
| `imageBlobMimeType` | string | 旧形式 (読み取りのみ) |
| `imageDataUrl` | string | 旧形式 (読み取りのみ) |

`image` 以外は string と見做してよい. `image` だけは構造体なので, 型の扱いを別に決める必要がある.

上記の規約に照らすと, いずれも `.` を含まないので **custom (ユーザのプロパティ) に見えてしまう**. システムが使っているものは移行が必要である.

| 現在 | 移行後 |
| --- | --- |
| `image` | `app.conversensus.image` |
| `imageUrl` | `app.conversensus.imageUrl` |
| `imageBlobCid` / `imageBlobMimeType` / `imageDataUrl` | 読み取りのみなので, そのまま (新規には書かない) |

## Property Editor

node と edge はプロパティを持ち得る/追加できる. node/edge の右クリックでメニューを選択すると, property editor がポップアップする (例えば右サイドバーに表示されるのでもいい. その場合には, アイコンの表示がなくても, node/edge を選択すればプロパティやその他の node/edge に関する情報が表示されるのでもいい).

そのアイコンをクリック (あるいは node/edge を選択) すると, property editor が表示される.

property editor には, その node/edge が持つ property の一覧 (名前, 型, 値) が表示され, 変更可能なセルは編集できる.

| 種類 | デフォルトの可視性/変更可能性 | 備考 |
| --- | --- | --- |
| system |  見えない, 追加/変更/削除できない |  |
| extension | 見える/見えない, 追加/変更/削除できる/できないが混在 | 責務は拡張の仕組みが持つ |
| custom | 見える, 追加/変更/削除できる |  |

システム・プロパティ, 拡張プロパティはデフォルトでは表示されず, 何らかの (例えば pulldown menu) で選択すると表示される (step 2 では表示されないままでも良い. → step 3).

値がすでに入っている場合の型, あるいは型がすでに決まっている場合の値を変更しようとした時には, 何らかの型の整合性検証 (例えば zod を利用する) を行い, 不整合があった場合には入力を受け付けず, ユーザに理由を示す (→ step 3).

プロパティ・エディタが扱う情報は, node/edge 本体が持つコンテンツに較べて繊細, 精細である場合が多くなるような気がする. そうすると, 複数の node/edge のプロパティを並べて見たいというような欲求が出てくるかもしれない. あるいは, グラフとは異なる view が必要なのかもしれない. それらの検討は → step 3

## 共同作業でのプロパティ

プロパティの変更は op-log に載るので, バージョン管理と同期の対象である.

step 2 では競合判定を**キー単位**にする (→ [merging](./merging.md) の「op の粒度」). 現行の `setProperties` は properties 全体を置換するので, 別のキーを編集しただけで競合になり, 負けた側のキーが消えてしまうためである.

## プロパティの可視化

プロパティの値によって, グラフ上での node/edge の見た目を (システム側から) 設定できるようにしたい (→ step 3).
