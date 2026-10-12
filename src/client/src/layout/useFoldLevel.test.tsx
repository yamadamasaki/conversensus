import { afterEach, describe, expect, test } from 'bun:test';
import { cleanup, render } from '@testing-library/react';
import { useRef } from 'react';
import { MAX_FOLD_LEVEL } from './headerFold';
import { useFoldLevel } from './useFoldLevel';

afterEach(cleanup);

/**
 * 段ごとの中身の幅を決めて描く。箱の幅は `boxWidth`。happy-dom は配置をしないので、
 * 箱の `scrollWidth` / `clientWidth` を段に応じた値に差し替える
 */
function Probe({
  contentWidthAt,
  boxWidth,
  contentKey,
  minLevel = 0,
  onLevel,
}: {
  contentWidthAt: (level: number) => number;
  boxWidth: number;
  contentKey: string;
  minLevel?: number;
  onLevel: (level: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const levelRef = useRef(0);
  const attach = (el: HTMLDivElement | null) => {
    ref.current = el;
    if (!el) return;
    Object.defineProperty(el, 'scrollWidth', {
      configurable: true,
      get: () => contentWidthAt(levelRef.current),
    });
    Object.defineProperty(el, 'clientWidth', {
      configurable: true,
      get: () => boxWidth,
    });
  };
  const level = useFoldLevel(ref, minLevel, contentKey);
  levelRef.current = level;
  onLevel(level);
  return <div ref={attach} />;
}

/** 段ごとに 100 ずつ縮む中身 (段 0 で 600) */
const shrinking = (level: number) => 600 - level * 100;

describe('useFoldLevel', () => {
  test('溢れなくなる最初の段まで上げる', () => {
    let level = -1;
    render(
      <Probe
        contentWidthAt={shrinking}
        boxWidth={350}
        contentKey="a"
        onLevel={(l) => {
          level = l;
        }}
      />,
    );
    // 600, 500, 400 は溢れ、300 で収まる
    expect(level).toBe(3);
  });

  test('畳み切っても溢れるなら上限で止まる', () => {
    let level = -1;
    render(
      <Probe
        contentWidthAt={() => 10_000}
        boxWidth={100}
        contentKey="a"
        onLevel={(l) => {
          level = l;
        }}
      />,
    );
    expect(level).toBe(MAX_FOLD_LEVEL);
  });

  test('中身が変わったら下限からやり直す (短くなった名前で畳みすぎのままにしない)', () => {
    let level = -1;
    const onLevel = (l: number) => {
      level = l;
    };
    const { rerender } = render(
      <Probe
        contentWidthAt={shrinking}
        boxWidth={350}
        contentKey="長い名前"
        onLevel={onLevel}
      />,
    );
    expect(level).toBe(3);
    rerender(
      <Probe
        contentWidthAt={(l) => 300 - l * 100}
        boxWidth={350}
        contentKey="短い名前"
        onLevel={onLevel}
      />,
    );
    expect(level).toBe(0);
  });

  test('下限より下には下げない (狭い画面は記号だけから)', () => {
    let level = -1;
    render(
      <Probe
        contentWidthAt={() => 0}
        boxWidth={1000}
        contentKey="a"
        minLevel={1}
        onLevel={(l) => {
          level = l;
        }}
      />,
    );
    expect(level).toBe(1);
  });
});
