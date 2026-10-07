import { afterEach, describe, expect, it } from 'bun:test';

const { render, screen, cleanup } = await import('@testing-library/react');
const { IMAGE_LINK_PREFIX, MarkdownImageAsLink, MarkdownLink } = await import(
  './markdownComponents'
);

afterEach(() => {
  cleanup();
});

describe('MarkdownImageAsLink (#287)', () => {
  it('画像を読み込まない — img を作らず、画像の場所へのリンクにする', () => {
    const { container } = render(
      <MarkdownImageAsLink src="https://example.com/x.png" alt="図 1" />,
    );
    expect(container.querySelector('img')).toBeNull();
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('https://example.com/x.png');
    expect(link.textContent).toBe(`${IMAGE_LINK_PREFIX}図 1`);
  });

  it('代替の文字が無ければ URL を見せる', () => {
    render(<MarkdownImageAsLink src="https://example.com/x.png" alt="" />);
    expect(screen.getByRole('link').textContent).toBe(
      `${IMAGE_LINK_PREFIX}https://example.com/x.png`,
    );
  });

  it('画像のリンクも新しいタブで、開いた先にこの画面を渡さない', () => {
    render(<MarkdownImageAsLink src="https://example.com/x.png" />);
    const link = screen.getByRole('link');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('URL が落とされていれば (javascript: など) リンクにせず文字だけ', () => {
    const { container } = render(<MarkdownImageAsLink src="" alt="図" />);
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toBe(`${IMAGE_LINK_PREFIX}図`);
  });
});

describe('MarkdownLink (#287)', () => {
  it('新しいタブで開き、開いた先にこの画面と URL を渡さない', () => {
    render(<MarkdownLink href="https://example.com/">先</MarkdownLink>);
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('https://example.com/');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.textContent).toBe('先');
  });

  it('URL が落とされていれば (javascript: など) リンクにせず文字だけ', () => {
    // 落とされた URL は空の href で届く。空の href のリンクは押すとこの画面を新しいタブで開く
    const { container } = render(<MarkdownLink href="">j</MarkdownLink>);
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toBe('j');
  });

  it('書き手が target や rel を書いても上書きする', () => {
    render(
      <MarkdownLink href="https://example.com/" target="_self" rel="opener">
        先
      </MarkdownLink>,
    );
    const link = screen.getByRole('link');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });
});
