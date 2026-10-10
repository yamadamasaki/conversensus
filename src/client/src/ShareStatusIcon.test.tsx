import { afterEach, describe, expect, it } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import { ShareStatusIcon } from './ShareStatusIcon';

afterEach(cleanup);

describe('ShareStatusIcon', () => {
  it('共有しているときは ✕ を描かない', () => {
    render(<ShareStatusIcon detached={false} />);
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('共有が切れているときだけ ✕ を重ねる', () => {
    render(<ShareStatusIcon detached />);
    expect(screen.getByRole('img', { name: '共有が切れている' })).toBeTruthy();
  });

  it('✕ は絵文字ではなく図形として描かれている', () => {
    // 絵文字の合成はエンジンごとに位置も大きさも変わる (WebKit が本命: ANA-125)。
    // 「✕ が出ている」ことを文字の有無で見ると, この判断ごと素通しになる
    const { container } = render(<ShareStatusIcon detached />);
    const mark = screen.getByRole('img', { name: '共有が切れている' });
    expect(mark.querySelectorAll('line').length).toBe(2);
    expect(mark.querySelectorAll('circle').length).toBe(2); // 縁 + 本体
    expect(container.textContent).toBe('');
  });

  it('下地の共有の絵は塗り潰されない', () => {
    // 15px では全面の ✕ が下地を消してしまい「✕」としか読めなくなる。
    // 何が切れたのかを言うには共有の絵が残っていなければならない
    // 共有の絵は Lucide の Users (visual language §4)
    const { container } = render(<ShareStatusIcon detached />);
    const base = container.querySelector('svg.lucide-users');
    expect(base).not.toBeNull();
    expect(base?.getAttribute('style') ?? '').not.toContain('opacity');
  });

  it('✕ は当たり判定を持たない — 箱ごとボタンの一部である', () => {
    render(<ShareStatusIcon detached />);
    const svg = screen.getByRole('img', { name: '共有が切れている' });
    expect(svg.getAttribute('style')).toContain('pointer-events: none');
  });
});
