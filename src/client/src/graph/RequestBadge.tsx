/**
 * 応答を求める node の状態の印 (agent 段 4 R4, 計画 Q2 案 A)
 *
 * node には状態だけを描き、操作は右の欄の「依頼」の区画に置く。「回答あり」は edge から導くので、
 * React Flow の edge の store を読む。**読むのは boolean 1 つ** (この依頼の最後の送信への答えが
 * あるか) で、edge が変わっても答えが変わらなければ描き直さない。応答を求める node だけがこれを描く
 * ので、普通の node は edge を見張らない。
 */

import { answersOf, sentCountOf, statusOf } from '@conversensus/shared';
import { useStore } from '@xyflow/react';
import { useMessages } from '../i18n/messages';
import { color, font, radius } from '../theme';

type Props = {
  nodeId: string;
  properties: Record<string, unknown>;
};

export function RequestBadge({ nodeId, properties }: Props) {
  const t = useMessages();
  const node = { properties };
  const sent = sentCountOf(node);
  const answered = useStore((s) =>
    s.edges.some(
      (e) =>
        e.source === nodeId &&
        e.data?.ghost !== true &&
        answersOf({
          properties: e.data?.properties as Record<string, unknown>,
        }) === sent,
    ),
  );
  // 答えの有無だけを edge から数え、状態の規則は shared の 1 か所 (`statusOf`) に任せる
  const status = statusOf(node, answered);
  const tone =
    status === 'answered'
      ? color.primary
      : status === 'sent'
        ? color.text
        : color.textMuted;
  return (
    <span
      data-request-status={status}
      style={{
        fontSize: font.caption,
        color: tone,
        border: `1px solid ${color.border}`,
        borderRadius: radius.sm,
        padding: '0 5px',
        marginLeft: 4,
        marginBottom: 4,
        display: 'inline-block',
      }}
    >
      {t.request.status[status]}
    </span>
  );
}
