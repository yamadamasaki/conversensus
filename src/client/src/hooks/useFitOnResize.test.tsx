import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { act, cleanup, render } from '@testing-library/react';
import { useFitOnResize } from './useFitOnResize';

/** 大きさの変化を手で起こせる ResizeObserver */
let notify: () => void = () => {};
const disconnect = mock(() => {});
class FakeResizeObserver {
  constructor(callback: () => void) {
    notify = callback;
  }
  observe() {}
  disconnect() {
    disconnect();
  }
}

const original = globalThis.ResizeObserver;
beforeEach(() => {
  globalThis.ResizeObserver =
    FakeResizeObserver as unknown as typeof ResizeObserver;
  disconnect.mockClear();
});
afterEach(() => {
  cleanup();
  globalThis.ResizeObserver = original;
});

/** 合わせるのは 1 フレーム後 (React Flow の測り直しを先に通す) */
const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

let moveStart: (
  event: MouseEvent | TouchEvent | null | Record<string, unknown>,
) => void = () => {};
function Canvas({ fit }: { fit: () => void }) {
  const { containerRef, onMoveStart } = useFitOnResize(fit);
  moveStart = onMoveStart;
  return <div ref={containerRef} />;
}

describe('useFitOnResize (#257)', () => {
  test('観測を始めた直後の 1 回は合わせず、その後の大きさの変化で合わせる', async () => {
    const fit = mock(() => {});
    render(<Canvas fit={fit} />);
    act(() => notify());
    await nextFrame();
    expect(fit).not.toHaveBeenCalled();
    act(() => notify());
    // 同じ変化を React Flow も受けて測り直すので、すぐには合わせない
    expect(fit).not.toHaveBeenCalled();
    await nextFrame();
    expect(fit).toHaveBeenCalledTimes(1);
  });

  test('利用者が表示を動かした後は合わせ直さない', async () => {
    const fit = mock(() => {});
    render(<Canvas fit={fit} />);
    act(() => notify());
    moveStart(new MouseEvent('mousedown'));
    act(() => notify());
    await nextFrame();
    expect(fit).not.toHaveBeenCalled();
  });

  test('プログラムからの移動 (event が無い・内側の印) では止めない', async () => {
    const fit = mock(() => {});
    render(<Canvas fit={fit} />);
    act(() => notify());
    moveStart(null);
    // React Flow は表示の同期で、素の object の印を event の場所に渡してくる (実機で発覚)
    moveStart({ sync: true });
    act(() => notify());
    await nextFrame();
    expect(fit).toHaveBeenCalledTimes(1);
  });

  test('外したら観測をやめる', () => {
    const { unmount } = render(<Canvas fit={() => {}} />);
    unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
