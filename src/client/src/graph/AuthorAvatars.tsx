/**
 * node・edge を書いた人の avatar (#354、設計 agent-actor.md D2a)
 *
 * - **頭文字の丸**: ハンドル名の頭文字を、DID から決まる色の丸に描く。外の profile (画像) に頼らないので、小さな PDS
 *   どうしの連合でもそのまま動く
 * - **agent は bot の印**: 宣言 (D2) があれば、頭文字の代わりに bot の icon。裏付けありは実線の縁、名乗りのみは点線の縁
 * - **重ねる**: 作った人を先頭に `MAX_STACKED` 人まで重ねて出し、残りは「+n」。hover (と focus) で広げ、
 *   ハンドル名を並べる
 *
 * 作者・表示名・宣言は context (`useAuthorsView`) から読む。無ければ何も描かない。
 */

import type { AgentDeclaration, Did } from '@conversensus/shared';
import { Bot } from 'lucide-react';
import { useState } from 'react';
import { useMessages } from '../i18n/messages';
import { color, font, radius, shadow } from '../theme';
import { useAuthorsView } from './authorsContext';

/** node の角との間 (px)。丸の半分を枠の外に出す */
const NODE_CORNER_INSET = 8;
/** node の右下の角に置く */
export const NODE_AVATAR_CORNER: React.CSSProperties = {
  right: NODE_CORNER_INSET,
  bottom: -NODE_CORNER_INSET,
};
/** edge の label から下へずらす (px) */
export const EDGE_AVATAR_OFFSET_Y = 16;

/** 丸の直径 (px) */
const AVATAR_SIZE = 18;
/** 重ねたときの、隣の丸との重なり (px) */
const OVERLAP = 6;
/** 重ねて出す人数。これより多い分は「+n」 */
export const MAX_STACKED = 3;
/** 色相を決める余り (色相環の度) */
const HUE_RANGE = 360;
/** 丸の色の彩度・明度 (白い頭文字が読める濃さ) */
const SATURATION = 55;
const LIGHTNESS = 42;
/** bot の icon の大きさ */
const BOT_ICON_SIZE = 12;

/** DID から決まる色 (同じ人はどの node でも同じ色) */
export function colorOfDid(did: Did): string {
  let hash = 0;
  for (const ch of did) hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) | 0;
  const hue = Math.abs(hash) % HUE_RANGE;
  return `hsl(${hue} ${SATURATION}% ${LIGHTNESS}%)`;
}

/** 頭文字: ハンドル名の最初の字。DID のまま (引けていない) なら、最後の `:` の後の最初の字 */
export function initialOf(label: string): string {
  const name = label.startsWith('did:')
    ? label.slice(label.lastIndexOf(':') + 1)
    : label;
  const [first] = name;
  return (first ?? '?').toUpperCase();
}

type Props = {
  elementId: string;
  /** 置く所 (position: absolute の値)。node の角・edge の label のそば */
  style?: React.CSSProperties;
};

export function AuthorAvatars({ elementId, style }: Props) {
  const view = useAuthorsView();
  const t = useMessages();
  const [open, setOpen] = useState(false);
  if (!view) return null;
  const authors = view.authorsOf(elementId);
  if (authors.length === 0) return null;

  const nameOf = (did: Did) => {
    const label = view.labelOf(did);
    const declaration = view.agentOf(did);
    return declaration?.status === 'verified'
      ? t.authors.agentVerified(label)
      : declaration?.status === 'claimed'
        ? t.authors.agentClaimed(label)
        : label;
  };
  const shown = open ? authors : authors.slice(0, MAX_STACKED);
  const hidden = authors.length - shown.length;

  return (
    <fieldset
      aria-label={t.authors.region(authors.map(nameOf).join(', '))}
      data-authors={authors.join(' ')}
      // hover と focus で広げる (触れるだけで開き、離れれば重ねに戻す)
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: 広げてハンドル名を読めるように、キーボードでも focus できる
      tabIndex={0}
      style={{
        position: 'absolute',
        margin: 0,
        padding: 0,
        border: 'none',
        minWidth: 0,
        display: 'flex',
        alignItems: 'center',
        zIndex: 1,
        ...(open && {
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: 4,
          padding: 6,
          background: color.bg,
          border: `1px solid ${color.border}`,
          borderRadius: radius.md,
          boxShadow: shadow.pop,
        }),
        ...style,
      }}
    >
      {shown.map((did, i) => (
        <div
          key={did}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginLeft: !open && i > 0 ? -OVERLAP : 0,
          }}
        >
          <Avatar
            did={did}
            label={view.labelOf(did)}
            declaration={view.agentOf(did)}
            title={nameOf(did)}
          />
          {open && (
            <span style={{ fontSize: font.caption, whiteSpace: 'nowrap' }}>
              {nameOf(did)}
            </span>
          )}
        </div>
      ))}
      {hidden > 0 && (
        <span
          title={t.authors.more(hidden)}
          style={{
            marginLeft: 2,
            fontSize: font.caption,
            color: color.textMuted,
          }}
        >
          +{hidden}
        </span>
      )}
    </fieldset>
  );
}

function Avatar({
  did,
  label,
  declaration,
  title,
}: {
  did: Did;
  label: string;
  declaration: AgentDeclaration | undefined;
  title: string;
}) {
  const agent = declaration && declaration.status !== 'none';
  return (
    <span
      title={title}
      data-avatar-agent={agent ? declaration.status : undefined}
      style={{
        width: AVATAR_SIZE,
        height: AVATAR_SIZE,
        borderRadius: '50%',
        background: colorOfDid(did),
        color: 'white',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 10,
        fontWeight: 'bold',
        lineHeight: 1,
        flexShrink: 0,
        boxSizing: 'border-box',
        // agent: 裏付けありは実線、名乗りのみは点線の縁。人は背景との境の白い縁
        border: agent
          ? `2px ${declaration.status === 'verified' ? 'solid' : 'dashed'} ${color.text}`
          : `1.5px solid ${color.bg}`,
      }}
    >
      {agent ? <Bot size={BOT_ICON_SIZE} aria-hidden /> : initialOf(label)}
    </span>
  );
}
