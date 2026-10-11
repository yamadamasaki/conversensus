# useViewLink のテスト

## 何をテストするか

`useViewLink` は、URL の fragment といま見ている view を結ぶ (#251 Deep Link)。

- **読む**: 起動時の fragment と、後で書き換えられた fragment (`hashchange`) が view のリンクなら開く
- File の一覧を読み終えるまでは開かずに待つ。手元に無い File なら開かずに `onMissing` で知らせる
- **書く**: いま見ている view が動くたびに fragment をそのアドレスにし、何も開いていなければ外す
- ログインの戻り (`canWrite` が false の間) は fragment に触らない
- 届いたリンクを開くまでは、前の view で上書きしない
- 自分で書いた fragment の `hashchange` を、届いたリンクとして扱わない

## なぜテストするか

- 一覧を読む前に「手元に無い」と判断すると、ある File へのリンクでも毎回「ありません」と出る
- タブの側は開けない File のタブを黙って閉じる (`useTabNavigation`)。リンクで開こうとして黙って消えると、
  利用者にはリンクが壊れているように見える。だからこちらで先に断って知らせる
- OAuth のライブラリは戻りの値を fragment から読む。読む前に書き換えるとログインが壊れる
- 開く前の view で上書きすると、利用者が貼ったリンクがアドレスバーから消えて見える
- `replaceState` で `hashchange` を出す実装がある (happy-dom。ブラウザは出さない)。自分で書いた値を
  開き直すと、移る途中の姿 (branch を開く前の trunk) のタブへ引き戻す。App 結合で実際に
  「再読み込みしてもタブが並ぶ (Q3)」が落ちて見つかった

## どのようにテストするか

- `renderHook` で描き、`open` / `onMissing` は mock、File の有無は props の並びで渡す
- happy-dom の既定の URL (`about:blank`) では fragment を書けないので、このファイルの間だけ
  `http://127.0.0.1:5173/` にし、終わったら戻す
- `hashchange` は手で出す。自分で書いた後に出すことで、happy-dom 以外でも同じ振舞いを固定する
