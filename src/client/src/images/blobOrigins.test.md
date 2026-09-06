# blobOrigins.test.ts — 画像 blob の由来のテスト仕様

## 何を

`collectBlobOrigins` (op-log から `cid → その blob を持つ repo の DID` を導く) を検証する。

## なぜ

**`ImageNode` が持つのは `cid` と `mimeType` だけである。**blob は op-log の外にあり、
参照するには **repo を名指しする**必要があるが、どの repo かはノードに書かれていない。
単一 actor では自分の repo で足りていたが、**多アクタでは他 actor が貼った画像が自分の
repo に無い**ので足りない (step2 Phase 2 §5, Exit 4)。

答えは op-log にある — **その画像を載せた batch の `actor`** がそれである。

**鍵は cid であってノードではない。**blob は content-addressed なので「その cid が
どの repo にあるか」は cid の性質である。ノード (`GraphNode`) に持たせると
`GraphFile` に載り、**export/import で別 File に古い DID が付いて回る** —
由来は op-log から導かれるものであって、書かれた内容ではない。

## どのように

- **画像を載せた batch の actor が由来になる**
- **同じ人の複数端末は 1 人として数える。**`actor` は `did#deviceId` だが、repo は
  DID 単位である
- **画像を持たない op からは何も出ない** / **cid ごとに別の由来を持つ**
- **⚠️ 同じ cid を 2 人が載せたら、最初の 1 人を採る。**どちらの repo からでも引けるので
  結果は変わらないが、**誰の手元でも同じ URL を叩く**ことは要る。`orderBatches` で
  並べてから先頭を採ることで決定論になる
- **⚠️ 入力の順序で結論が変わらない。**上の裏返しで、受信順は手元ごとに違う。
  逆順に与えても同じ由来になることを直接見る
- **genesis の batch は由来にならない。**`GENESIS_ACTOR` は DID ではないので repo を
  名指しできない
- **未ログインで書かれた batch は由来にならない。**actor は `local#<deviceId>` で、
  やはり DID が無い。由来が入らなければ呼び出し側は自分の repo に落ちるので、
  **単一 actor 時代の File はこれまで通り表示される**

## 引かなかったもの

- **性質 (PBT) にしていない。**「∀ 入力順で同じ結論」は性質の形をしているが、
  `orderBatches` の全順序をそのまま使っているだけで、命題の中身は
  `project.test.ts` の配送順の性質と同じものである。ここでは逆順の 1 例で足りる
- **由来が引けなかったときの挙動**は `imageBlob.test.ts` (`resolveImageUrl`) が持つ。
  ここは「何を集めるか」だけを見る
