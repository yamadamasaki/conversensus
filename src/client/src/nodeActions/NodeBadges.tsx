/**
 * node の上の印 (計画 node-actions-request-module.md N3)
 *
 * どの印を出すかは module が決め (`NodeModule.badge`)、描くのはここである。node の部品
 * (`EditableNode`) は module を名指しせず、これを置くだけになる。
 *
 * ## 描き直しを抑える
 *
 * 印は**すべての node について、canvas が変わるたびに**決め直す。React Flow の store から読む値は
 * **印の中身を文字列にしたもの**だけにし、edge が動いても印が変わらなければ描き直さない。
 * 出ていく edge は module が引いたときにだけ数える (`NodeBadgeContext.outgoing`) — 印を持たない node は
 * property を見るだけで済む。
 */

import type { GraphEdge, GraphNode } from '@conversensus/shared';
import { useStore } from '@xyflow/react';
import { useMemo } from 'react';
import { fromFlowEdges } from '../graphTransform';
import { useLocale } from '../i18n/messages';
import { color, font, radius } from '../theme';
import type { BadgeTone } from './nodeAction';
import type { ModuleBadge, NodeActionRegistry } from './registry';
import { useNodeActionRegistry } from './registryContext';

const TONE_COLOR: Record<BadgeTone, string> = {
  muted: color.textMuted,
  normal: color.text,
  primary: color.primary,
};

type Props = {
  nodeId: string;
  content: string;
  properties: Record<string, unknown> | undefined;
};

/** 印を持つ module が無ければ何もしない (store も読まない) */
export function NodeBadges(props: Props) {
  const registry = useNodeActionRegistry();
  return registry.modules.some((m) => m.badge) ? (
    <BadgesOf {...props} registry={registry} />
  ) : null;
}

function BadgesOf({
  nodeId,
  content,
  properties,
  registry,
}: Props & { registry: NodeActionRegistry }) {
  const locale = useLocale();
  const node = useMemo(
    () => ({ id: nodeId, content, properties }) as GraphNode,
    [nodeId, content, properties],
  );
  // 印の中身を文字列で読む (同じなら描き直さない)
  const serialized = useStore((s) => {
    const outgoing = (): readonly GraphEdge[] =>
      fromFlowEdges(
        s.edges.filter((e) => e.source === nodeId && e.data?.ghost !== true),
      ).edges;
    return JSON.stringify(registry.badgesFor({ node, outgoing }));
  });
  const badges = JSON.parse(serialized) as ModuleBadge[];
  if (badges.length === 0) return null;
  return (
    <>
      {badges.map(({ moduleId, badge }) => (
        <span
          key={moduleId}
          data-node-badge={moduleId}
          data-badge-value={badge.value}
          style={{
            fontSize: font.caption,
            color: TONE_COLOR[badge.tone],
            border: `1px solid ${color.border}`,
            borderRadius: radius.sm,
            padding: '0 5px',
            marginLeft: 4,
            marginBottom: 4,
            display: 'inline-block',
          }}
        >
          {badge.text[locale]}
        </span>
      ))}
    </>
  );
}
