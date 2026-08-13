import { afterEach, describe, expect, test } from 'bun:test';
import { guardAgainstStuckDrag } from './stuckDragGuard';

function mouse(type: string, buttons: number): MouseEvent {
  return new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    view: window,
    buttons,
    clientX: 100,
    clientY: 100,
  });
}

/** ガードが投げた mouseup を数える。合成分だけを見たいので type で絞る */
function countMouseUps(): { count: () => number; stop: () => void } {
  let n = 0;
  const listener = () => {
    n += 1;
  };
  window.addEventListener('mouseup', listener);
  return {
    count: () => n,
    stop: () => window.removeEventListener('mouseup', listener),
  };
}

let release: (() => void) | null = null;
afterEach(() => {
  release?.();
  release = null;
});

describe('guardAgainstStuckDrag', () => {
  test('押していない移動が来たらドラッグを終わらせる', () => {
    release = guardAgainstStuckDrag(window);
    const ups = countMouseUps();

    // タップ相当: 押下は来るが解放が来ない (WebKit + トラックパッドで実測した列)
    window.dispatchEvent(mouse('mousedown', 0));
    window.dispatchEvent(mouse('mousemove', 0));

    expect(ups.count()).toBe(1);
    ups.stop();
  });

  test('押している間の移動には触らない', () => {
    // **ここが本物のドラッグを壊さないことの保証である。**
    // 実測では押し込んだドラッグは押下・移動とも buttons=1 だった
    release = guardAgainstStuckDrag(window);
    const ups = countMouseUps();

    window.dispatchEvent(mouse('mousedown', 1));
    window.dispatchEvent(mouse('mousemove', 1));
    window.dispatchEvent(mouse('mousemove', 1));

    expect(ups.count()).toBe(0);
    ups.stop();
  });

  test('押下していないのに動いているだけなら何もしない', () => {
    // ただカーソルを動かしているだけの状態。ここで mouseup を投げ続けてはいけない
    release = guardAgainstStuckDrag(window);
    const ups = countMouseUps();

    window.dispatchEvent(mouse('mousemove', 0));
    window.dispatchEvent(mouse('mousemove', 0));

    expect(ups.count()).toBe(0);
    ups.stop();
  });

  test('打ち切りは 1 回だけで, 動き続けても投げ直さない', () => {
    release = guardAgainstStuckDrag(window);
    const ups = countMouseUps();

    window.dispatchEvent(mouse('mousedown', 0));
    window.dispatchEvent(mouse('mousemove', 0));
    window.dispatchEvent(mouse('mousemove', 0));
    window.dispatchEvent(mouse('mousemove', 0));

    expect(ups.count()).toBe(1);
    ups.stop();
  });

  test('正常に解放された後の移動では投げない', () => {
    release = guardAgainstStuckDrag(window);

    window.dispatchEvent(mouse('mousedown', 1));
    window.dispatchEvent(mouse('mouseup', 0));
    const ups = countMouseUps();
    window.dispatchEvent(mouse('mousemove', 0));

    expect(ups.count()).toBe(0);
    ups.stop();
  });

  test('解除すると何もしなくなる', () => {
    const stop = guardAgainstStuckDrag(window);
    stop();
    const ups = countMouseUps();

    window.dispatchEvent(mouse('mousedown', 0));
    window.dispatchEvent(mouse('mousemove', 0));

    expect(ups.count()).toBe(0);
    ups.stop();
  });
});
