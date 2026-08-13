import { describe, expect, test } from 'bun:test';
import {
  isResizeObserverLoopMessage,
  suppressResizeObserverLoopErrors,
} from './suppressResizeObserverLoop';

/** cancelable な error イベントを作る (preventDefault の効きを見るため) */
function errorEvent(message: string): ErrorEvent {
  return new ErrorEvent('error', { message, cancelable: true });
}

describe('isResizeObserverLoopMessage', () => {
  test('既知のループ通知を認める', () => {
    expect(
      isResizeObserverLoopMessage(
        'ResizeObserver loop completed with undelivered notifications.',
      ),
    ).toBe(true);
    expect(
      isResizeObserverLoopMessage('ResizeObserver loop limit exceeded'),
    ).toBe(true);
  });

  test('ResizeObserver に触れる別のエラーは認めない', () => {
    // **広いパターンにしない**ことの検査。`includes('ResizeObserver')` だと
    // 本物のエラーまで消えてしまう
    expect(
      isResizeObserverLoopMessage(
        "TypeError: undefined is not a constructor (evaluating 'new ResizeObserver()')",
      ),
    ).toBe(false);
  });
});

describe('suppressResizeObserverLoopErrors', () => {
  test('ループ通知は既定の報告から外す', () => {
    const stop = suppressResizeObserverLoopErrors(window);
    const event = errorEvent(
      'ResizeObserver loop completed with undelivered notifications.',
    );

    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    stop();
  });

  test('他のエラーには触らない', () => {
    const stop = suppressResizeObserverLoopErrors(window);
    const event = errorEvent('TypeError: x is not a function');

    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    stop();
  });

  test('解除するとループ通知も素通しになる', () => {
    // **消し続ける仕掛けを残さない**ことの検査。テストや将来の呼び出し側が
    // 元へ戻せなければ, 本物のエラーを消したときに気付けない
    const stop = suppressResizeObserverLoopErrors(window);
    stop();
    const event = errorEvent(
      'ResizeObserver loop completed with undelivered notifications.',
    );

    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });
});
