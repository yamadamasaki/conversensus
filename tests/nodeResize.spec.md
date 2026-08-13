# nodeResize.spec.ts — ノードのサイズ変更 (ANA-125 S4)

## 何をテストするか

ノードを選んでサイズ変更ハンドルを掴んで動かしたとき,

1. 実際にノードが大きくなること
2. **未処理例外・コンソールエラーが 0 件**であること

## なぜテストするか

実 Safari の使い込み (ANA-125 S4) で, **サイズ変更のドラッグ中に
`ResizeObserver loop completed with undelivered notifications.` が未処理例外として
数百件上がる**ことが分かった。**WebKit だけ**で起き, Chromium では出ない (両エンジンで実測)。

放置できない理由は, 壊れるからではなく**コンソールが読めなくなるから**である。
step1 は一貫して「無言の失敗」をコンソールで見つけてきた
(`deepse/requirements/user-test-environment.md` §7.2)。数百件のノイズはその道具を壊す。

出所は `@xyflow/react` (12.6.4) の中の `ResizeObserver` (2 箇所, rAF で包まれていない)
であり, アプリ側に直す場所が無い。仕様上も非致命 (配りきれなかった通知を次フレームへ
回しただけ) なので, **メッセージを限定して握り潰す**方針を採った
(`src/client/src/suppressResizeObserverLoop.ts`, ユーザー判断 2026-08-13)。
このテストはその抑止が効き続けることの回帰である。

## どのようにテストするか

- **ハンドルは刻んで動かす** (20 回に分ける)。通知のループはフレームをまたいで
  積み上がるので, 1 回で運ぶと再現しない
- **「例外 0 件」だけを合格条件にしない。** ハンドルを掴み損ねていても例外は 0 件になる。
  ノードの幅が実際に増えたことを併せて見る
- 抑止の**中身** (どのメッセージを消すか, 解除できるか) は単体テスト
  `src/client/src/suppressResizeObserverLoop.test.ts` が持つ。ここは
  「実際のブラウザで実際のドラッグをしたときに出ない」ことだけを見る

## 反証で確かめたこと

**抑止を外すと webkit で赤くなる**ことを確認した
(`pageerror: ResizeObserver loop completed with undelivered notifications.` が 3 件)。
chromium は抑止の有無にかかわらず緑である — エンジン差であることの裏付けでもある。
