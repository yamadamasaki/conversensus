/**
 * 右の欄の「依頼」の区画 (agent 段 4 R4, 計画 Q2 案 A)
 *
 * 応答を求める node を選んだときに、property の欄の上に出す。状態・宛先と、今できる操作だけを
 * ボタンにする (送る・送り直す・閉じる・開き直す・答える)。**できない操作のボタンは出さない** —
 * 押せるのに効かない形を作らない。
 *
 * 判断 (何ができるか) は状態から決まる。GraphEvent にするのは `requestTarget.ts`・`requestEvents.ts`。
 */

import type { Did } from '@conversensus/shared';
import { X } from 'lucide-react';
import { useState } from 'react';
import type { Participant } from './hooks/useFileParticipants';
import { useMessages } from './i18n/messages';
import type { RequestAction, RequestTarget } from './request/requestTarget';
import { color, font, radius, space } from './theme';

/** × のアイコンの大きさ */
const ICON_SIZE = 12;

type Props = {
  request: RequestTarget;
  /** 宛先の候補 (開いている File の参加者) */
  participants: readonly Participant[];
  onAction: (action: RequestAction) => void;
  readOnly: boolean;
};

export function RequestPanel({
  request,
  participants,
  onAction,
  readOnly,
}: Props) {
  const t = useMessages();
  const [answer, setAnswer] = useState('');
  const { status, sent, addressee } = request;
  const labelOf = (did: Did) =>
    participants.find((p) => p.did === did)?.label ?? did;
  const addable = participants.filter((p) => !addressee.includes(p.did));
  const open = status === 'sent' || status === 'answered';

  const button = (label: string, action: RequestAction) => (
    <button
      type="button"
      onClick={() => onAction(action)}
      style={{ padding: '4px 10px', fontSize: font.body, cursor: 'pointer' }}
    >
      {label}
    </button>
  );

  return (
    <section
      aria-label={t.request.region}
      style={{
        padding: `0 ${space[3]}px ${space[3]}px`,
        borderBottom: `1px solid ${color.border}`,
        display: 'flex',
        flexDirection: 'column',
        gap: space[2],
        fontSize: font.body,
      }}
    >
      <h4 style={{ margin: 0, fontSize: font.body }}>{t.request.heading}</h4>
      <p role="status" style={{ margin: 0 }}>
        {t.request.status[status]}
        {sent > 0 && (
          <span style={{ color: color.textMuted }}>
            {' · '}
            {t.request.sentCount(sent)}
          </span>
        )}
      </p>

      <div>
        <span style={{ color: color.textMuted }}>{t.request.addressee}: </span>
        {addressee.length === 0 ? (
          <span>{t.request.anyone}</span>
        ) : (
          <ul
            aria-label={t.request.addressee}
            style={{
              display: 'inline-flex',
              flexWrap: 'wrap',
              gap: space[1],
              margin: 0,
              padding: 0,
              listStyle: 'none',
            }}
          >
            {addressee.map((did) => (
              <li
                key={did}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 2,
                  padding: '0 6px',
                  border: `1px solid ${color.border}`,
                  borderRadius: radius.sm,
                }}
              >
                {labelOf(did)}
                {!readOnly && (
                  <button
                    type="button"
                    aria-label={t.request.removeAddressee(labelOf(did))}
                    className="cs-btn cs-btn--icon cs-btn--sm"
                    onClick={() =>
                      onAction({
                        kind: 'setAddressee',
                        dids: addressee.filter((d) => d !== did),
                      })
                    }
                  >
                    <X size={ICON_SIZE} aria-hidden />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {!readOnly && addable.length > 0 && (
        <select
          aria-label={t.request.addAddressee}
          value=""
          onChange={(e) => {
            const did = e.target.value as Did;
            if (did)
              onAction({ kind: 'setAddressee', dids: [...addressee, did] });
          }}
          style={{ fontSize: font.body }}
        >
          <option value="">{t.request.addAddressee}</option>
          {addable.map((p) => (
            <option key={p.did} value={p.did}>
              {p.label}
            </option>
          ))}
        </select>
      )}

      {!readOnly && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: space[1] }}>
          {status === 'draft' && button(t.request.send, { kind: 'send' })}
          {open && button(t.request.resend, { kind: 'send' })}
          {open && button(t.request.close, { kind: 'close' })}
          {status === 'closed' && button(t.request.reopen, { kind: 'reopen' })}
        </div>
      )}

      {!readOnly && open && (
        <div
          style={{ display: 'flex', flexDirection: 'column', gap: space[1] }}
        >
          <textarea
            aria-label={t.request.answerPlaceholder}
            placeholder={t.request.answerPlaceholder}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            rows={3}
            style={{ fontSize: font.body, resize: 'vertical' }}
          />
          <button
            type="button"
            disabled={answer.trim() === ''}
            onClick={() => {
              onAction({ kind: 'answer', content: answer });
              setAnswer('');
            }}
            style={{
              alignSelf: 'flex-start',
              padding: '4px 10px',
              fontSize: font.body,
              cursor: answer.trim() === '' ? 'not-allowed' : 'pointer',
            }}
          >
            {t.request.answer}
          </button>
        </div>
      )}
    </section>
  );
}
