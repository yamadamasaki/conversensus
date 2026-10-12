import { afterEach, describe, expect, test } from 'bun:test';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { CLIPPED_TOOLTIP_DELAY_MS, ClippedText } from './ClippedText';

afterEach(cleanup);

/** happy-dom は配置をしないので、文字の幅 (`scrollWidth`) と箱の幅 (`clientWidth`) を差し替える */
function setWidths(el: HTMLElement, content: number, box: number) {
  Object.defineProperty(el, 'scrollWidth', {
    configurable: true,
    get: () => content,
  });
  Object.defineProperty(el, 'clientWidth', {
    configurable: true,
    get: () => box,
  });
}

const wait = (ms: number) =>
  act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));

const NAME = 'とても長い File の名前';

describe('ClippedText', () => {
  test('切れていれば、少し待ってから全体を tooltip に出し、離れたら消す', async () => {
    render(<ClippedText full={NAME} />);
    const text = screen.getByText(NAME);
    setWidths(text, 300, 100);
    fireEvent.mouseEnter(text);
    expect(screen.queryByRole('tooltip')).toBeNull(); // すぐには出さない
    await wait(CLIPPED_TOOLTIP_DELAY_MS + 50);
    expect(screen.getByRole('tooltip').textContent).toBe(NAME);
    fireEvent.mouseLeave(text);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  test('切れていなければ出さない', async () => {
    render(<ClippedText full={NAME} />);
    const text = screen.getByText(NAME);
    setWidths(text, 100, 100);
    fireEvent.mouseEnter(text);
    await wait(CLIPPED_TOOLTIP_DELAY_MS + 50);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  test('待っている間に離れたら出さない (通り過ぎるだけのポインタ)', async () => {
    render(<ClippedText full={NAME} />);
    const text = screen.getByText(NAME);
    setWidths(text, 300, 100);
    fireEvent.mouseEnter(text);
    fireEvent.mouseLeave(text);
    await wait(CLIPPED_TOOLTIP_DELAY_MS + 50);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  test('中身を渡せば中身を描き、tooltip には全体の文字を出す', async () => {
    render(
      <ClippedText full="研究 / Sheet 1">
        <span>研究 / </span>
        <strong>Sheet 1</strong>
      </ClippedText>,
    );
    const box = screen.getByText('Sheet 1').parentElement as HTMLElement;
    setWidths(box, 300, 100);
    fireEvent.mouseEnter(box);
    await wait(CLIPPED_TOOLTIP_DELAY_MS + 50);
    expect(screen.getByRole('tooltip').textContent).toBe('研究 / Sheet 1');
  });
});
