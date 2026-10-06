/**
 * node の本文の Markdown の描き方 (#287)。`ReactMarkdown` の `components` に渡す。
 *
 * 本文は共有相手が書いたものなので:
 * - **画像は読み込まず、リンクにする**。読み込むと、開いた人のブラウザが画像の置き場へ取りに行き、
 *   開いた人の IP と時刻がその置き場に伝わる。見たい人は押して開く
 *   (画像 node の外部 URL はこの対象ではない — node を置いた人が画像として置いたもの)
 * - **リンクは新しいタブで開く**。同じタブで移ると編集中の画面を離れる。`noopener` で開いた先から
 *   この画面を触らせず、`noreferrer` でこの画面の URL を渡さない
 *
 * `javascript:` などの URL は react-markdown の `urlTransform` が既に落としている (`href` / `src` が
 * 空で届く)。
 */

import type { ComponentPropsWithoutRef } from 'react';
import type { Components, ExtraProps } from 'react-markdown';

const NEW_TAB = '_blank';
const SAFE_REL = 'noopener noreferrer';
/** 画像の代わりのリンクの頭 */
export const IMAGE_LINK_PREFIX = '画像: ';

type AnchorProps = ComponentPropsWithoutRef<'a'> & ExtraProps;
type ImageProps = ComponentPropsWithoutRef<'img'> & ExtraProps;

/** リンクは新しいタブで、開いた先にこの画面を渡さない。URL が落とされていれば文字だけ */
export function MarkdownLink({ node: _node, ...props }: AnchorProps) {
  if (!props.href) return <span>{props.children}</span>;
  return <a {...props} target={NEW_TAB} rel={SAFE_REL} />;
}

/** 画像は読み込まず、画像の場所へのリンクにする。URL が落とされていれば代替の文字だけ */
export function MarkdownImageAsLink({ src, alt }: ImageProps) {
  const label = `${IMAGE_LINK_PREFIX}${alt || src || ''}`;
  if (typeof src !== 'string' || src === '') return <span>{label}</span>;
  return (
    <a href={src} target={NEW_TAB} rel={SAFE_REL} title={src}>
      {label}
    </a>
  );
}

export const MARKDOWN_COMPONENTS: Components = {
  a: MarkdownLink,
  img: MarkdownImageAsLink,
};
