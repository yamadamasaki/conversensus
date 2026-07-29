# readCutover.e2e.test — W3d-4 読み取り cutover end-to-end 検証

## 何を

step1 W3d (op-log 読み取り正典化) の end-to-end 契約を、**デーモンレベル**で検証する。
実 HTTP ハンドラ (`server.fetch`) + 実 SQLite (`events.db`) + 実 snapshot (`storage.ts`) +
クライアント読取関数 `projectFile` を一気通貫で通し、openFile が実運用の部品で正しく動くことを確認する。

設計: `deepse/plans/step1-w3d-read-cutover.md` §5 (W3d-4 スライス) / §6 (リスクと検証)。

## なぜ

W3d-1 (サーバ lazy migration) と W3d-2 (クライアント読取切替) は各層のユニット/結合テストで
個別に固めた。W3d-4 は **層をまたいだ実物の結線**を検証する段。ユニットテストは
モック・部分実装で通っても、実 SQLite・実 HTTP・実 projection を繋いだときに
migration→projection の契約が崩れていないことは別途保証が要る。

ブラウザ GUI (React Flow 描画・branch トグル・flag off の画面復帰) は本テストの範囲外で、
手動の目視パス (screenshot 記録) で確認する。本テストは HTTP 転送より内側の
「migration→projection が snapshot を忠実に再現する」正当性を機械的に固定する。

## どのように

`beforeEach` でテスト毎に一時 `DATA_DIR` を作り、`events.db` と snapshot JSON を隔離する
(`getEventStore` はパス単位でメモ化するので DATA_DIR 差し替えで別 DB になる)。

`richSnapshot()` で実運用相当の GraphFile を組む: 2 シート、複数ノード (content/properties)、
ラベル付きエッジ、ノードレイアウト (x/y/width/height)、エッジルーティング (pathType)。
`seedLegacySnapshot()` は `writeLegacySnapshot` (テスト専用ヘルパ) で snapshot を直接置き、続けて起動時の一括移行
(`migrateAllFilesToOplog`) を通す。**endpoint を経由しないのは経由では作れない状態だから** —
Phase 6 p6-1 以降 `POST /files` は op-log を作るので「snapshot だけが在る」状態にならない。
これは移行が実際に要る唯一の状況 (Phase 6 より前に作られたファイル) の再現である。

> 旧版は `POST /files` + `PUT /files/:id` で seed し、初回 GET の lazy migration を
> 発火させていた。p6-1 で読取時 migration を撤去したため seed 方法を実運用に合わせた。
> **検証している性質 (実 snapshot → 実 migration → projectFile の再現性) は変わらない**。

比較は `structural()` で正規化する: `projectFile` が `GraphFile` に再現するフィールド
(ファイルメタ・シート順・nodes・edges・node layouts・edge routing) だけを id 昇順にソートして
突き合わせる。edge の style / labelOffset は projection では presentation 経路 (GraphFile 非搭載)
なので equality には含めない — 過剰主張を避けるための線引き。

### ケース

1. **既存 snapshot が migration→projectFile で構造を再現する**:
   rich snapshot を置いて一括移行 → `GET /files/:id/batches` の batches を `projectFile` →
   元の snapshot と構造が一致。シート順 (メイン→サブ) も保たれる。
2. **migration はべき等**: 二度 `openViaOplog` して projection が完全一致
   (marker により再 genesis されない)。
3. **編集を再オープンで反映**: 初回 open で genesis の最大 clock を確認 → その後に
   nodeA の `node.setContent` batch を追記 → 再 open した projection で content が更新済み。
4. **flag off (snapshot 直読) は最新 snapshot を返す**: migration 後も `GET /files/:id`
   (= `READ_FROM_OPLOG=false` 相当の snapshot 直読) が元の GraphFile を返す。
   migration は snapshot を破壊しない → dual-read 安全弁が健在。

## 手動で確認する残項目 (本テスト対象外)

`deepse/plans/step1-w3d-read-cutover.md` §10.2 (ブラウザ目視パス) を参照。
ブラウザで実ファイルを開き projection が描画されること、trunk↔branch トグルが従来通り、
`VITE_READ_FROM_OPLOG=false` で snapshot 表示に復帰することを screenshot で記録する。
