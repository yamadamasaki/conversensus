/**
 * ボタンを押していないのに続いているドラッグを終わらせる (ANA-125 S4 / ANA-115)
 *
 * **症状**: トラックパッドで操作していると, ノードや画面全体がカーソルに付いて動き続け,
 * もう一度クリックするまで止まらない。実 Safari の使い込みで観測した (#51 のコメントには
 * 「ノードが付いてくる」とあったが, 掴んだ先によっては画面全体が動く)。
 *
 * **原因** (実測):
 *
 * - WebKit はトラックパッドの**タップ**を `buttons=0` / `pressure=0` の押下として配送し,
 *   さらに `mouseup`/`pointerup` を **`mousedown`/`pointerdown` より先に**配送することがある
 * - 先に来た解放イベントは誰も待っていないので捨てられ, 後から来た押下で始まった
 *   ドラッグには**終わらせる解放イベントが残らない**
 * - React Flow のドラッグは d3-drag で動き, **d3-drag は移動中に `buttons` を見ない**。
 *   だから「押していないのに動き続ける」状態が成立してしまう
 * - **押し込んだ本物のドラッグでは起きない** — 実測で押下・移動とも `buttons=1` である
 *
 * **直し方**: 移動イベントの `buttons` が 0 なら, ボタンは押されていない。
 * そのとき合成した `mouseup` を投げてドラッグを終わらせる。
 * 正常なドラッグ中は `buttons=1` なので, ここは何もしない。
 *
 * ライブラリの中に手を入れず, **イベントの事実 (押されていない) だけで判定する**ので,
 * 「WebKit ならこうする」という分岐にならない。Blink でも同じ列が来れば同じく直る。
 */

/** ボタンが 1 つも押されていないことを表す `MouseEvent.buttons` の値 */
const NO_BUTTONS_PRESSED = 0;

/**
 * 押されていないポインタで続くドラッグを打ち切る。**戻り値は解除関数**である。
 *
 * capture フェーズで登録するのは, d3-drag のリスナより先に判定するためである。
 */
export function guardAgainstStuckDrag(target: Window = window): () => void {
  let maybeDragging = false;

  const onDown = () => {
    maybeDragging = true;
  };
  const onUp = () => {
    maybeDragging = false;
  };
  const onMove = (event: Event) => {
    const mouse = event as MouseEvent;
    if (!maybeDragging || mouse.buttons !== NO_BUTTONS_PRESSED) return;
    // **先に降ろす。** 合成した mouseup をここで拾って二重に投げないため
    maybeDragging = false;
    target.dispatchEvent(
      new MouseEvent('mouseup', {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: target,
        button: 0,
        buttons: NO_BUTTONS_PRESSED,
        clientX: mouse.clientX,
        clientY: mouse.clientY,
      }),
    );
  };

  target.addEventListener('mousedown', onDown, true);
  target.addEventListener('mouseup', onUp, true);
  target.addEventListener('mousemove', onMove, true);

  return () => {
    target.removeEventListener('mousedown', onDown, true);
    target.removeEventListener('mouseup', onUp, true);
    target.removeEventListener('mousemove', onMove, true);
  };
}
