/**
 * 引数の要る操作の dialog (計画 N2、Q2 案 a)
 *
 * module は引数を**宣言**するだけで、描くのはここである。宣言の型ごとに入力を 1 つ出す:
 *
 * | 型 | 入力 |
 * | --- | --- |
 * | `actors` | 参加者の checkbox (0 人以上) |
 * | `choice` | select (1 つ) |
 * | `text` | 1 行の入力か、複数行の textarea |
 *
 * 初めの値は `initial` (多くは node の property — 前に決めた値が入っている)。「実行」で値を返し、
 * 実行できなかった理由 (dialog を開いている間に使えなくなった・値が合わない) が返れば dialog の中に出す。
 */

import type { Did } from '@conversensus/shared';
import { useId, useState } from 'react';
import { useLocale, useMessages } from '../i18n/messages';
import { color, font, radius, space } from '../theme';
import { Button } from '../ui/Button';
import { Dialog, DialogActions } from '../ui/Dialog';
import type {
  ActionActor,
  ActionArgs,
  ActionArgValue,
  ActionParam,
  NodeAction,
} from './nodeAction';

type Props = {
  action: NodeAction;
  /** 初めの値 (`action.initial` の結果) */
  initial: ActionArgs;
  /** `actors` の候補 */
  participants: readonly ActionActor[];
  /** 実行する。できなければ理由を返す (dialog に出す) */
  onSubmit: (args: ActionArgs) => string | undefined;
  onCancel: () => void;
};

const FIELD_STYLE = {
  width: '100%',
  padding: space[2],
  fontSize: font.body,
  borderRadius: radius.sm,
  border: `1px solid ${color.border}`,
  boxSizing: 'border-box',
} as const;

/** textarea の高さ (行) */
const TEXTAREA_ROWS = 4;

/** 必須の本文が空なら実行できない (確かめは registry でもう一度する) */
function missingRequired(
  params: readonly ActionParam[],
  args: ActionArgs,
): boolean {
  return params.some(
    (p) =>
      p.kind === 'text' &&
      p.required === true &&
      String(args[p.name] ?? '').trim() === '',
  );
}

export function NodeActionDialog({
  action,
  initial,
  participants,
  onSubmit,
  onCancel,
}: Props) {
  const t = useMessages();
  const locale = useLocale();
  const idBase = useId();
  const params = action.params ?? [];
  const [args, setArgs] = useState<ActionArgs>(initial);
  const [error, setError] = useState<string | undefined>();
  const set = (name: string, value: ActionArgValue) =>
    setArgs((prev) => ({ ...prev, [name]: value }));
  const title = action.label[locale];

  const submit = () => {
    if (missingRequired(params, args)) return;
    setError(onSubmit(args));
  };

  const field = (param: ActionParam) => {
    const id = `${idBase}-${param.name}`;
    const label = param.label[locale];
    switch (param.kind) {
      case 'actors': {
        const chosen = (args[param.name] as readonly Did[] | undefined) ?? [];
        // 選ばれているのに候補にいない人 (参加者の一覧がまだ届いていない) も外せるように出す
        const candidates = [
          ...participants,
          ...chosen
            .filter((did) => !participants.some((p) => p.did === did))
            .map((did) => ({ did, label: did })),
        ];
        return (
          <fieldset key={param.name} style={{ border: 'none', padding: 0 }}>
            <legend style={{ marginBottom: space[1] }}>{label}</legend>
            {candidates.length === 0 && (
              <p style={{ margin: 0, color: color.textMuted }}>
                {t.nodeActions.noActors}
              </p>
            )}
            {candidates.map((p) => (
              <label key={p.did} style={{ display: 'block' }}>
                <input
                  type="checkbox"
                  checked={chosen.includes(p.did)}
                  onChange={(e) =>
                    set(
                      param.name,
                      e.target.checked
                        ? [...chosen, p.did]
                        : chosen.filter((d) => d !== p.did),
                    )
                  }
                />{' '}
                {p.label}
              </label>
            ))}
          </fieldset>
        );
      }
      case 'choice':
        return (
          <div key={param.name}>
            <label htmlFor={id} style={{ display: 'block' }}>
              {label}
            </label>
            <select
              id={id}
              value={String(args[param.name] ?? '')}
              onChange={(e) => set(param.name, e.target.value)}
              style={FIELD_STYLE}
            >
              {param.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label[locale]}
                </option>
              ))}
            </select>
          </div>
        );
      case 'text':
        return (
          <div key={param.name}>
            <label htmlFor={id} style={{ display: 'block' }}>
              {label}
            </label>
            {param.multiline ? (
              <textarea
                id={id}
                rows={TEXTAREA_ROWS}
                value={String(args[param.name] ?? '')}
                onChange={(e) => set(param.name, e.target.value)}
                style={{ ...FIELD_STYLE, resize: 'vertical' }}
              />
            ) : (
              <input
                id={id}
                type="text"
                value={String(args[param.name] ?? '')}
                onChange={(e) => set(param.name, e.target.value)}
                style={FIELD_STYLE}
              />
            )}
          </div>
        );
    }
  };

  return (
    <Dialog kind="input" label={title} title={title} onDismiss={onCancel}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: space[3] }}>
        {params.map(field)}
        {error && (
          <p role="alert" style={{ margin: 0, color: color.dangerText }}>
            {error}
          </p>
        )}
      </div>
      <DialogActions>
        <Button onClick={onCancel}>{t.common.cancel}</Button>
        <Button
          variant="primary"
          onClick={submit}
          disabled={missingRequired(params, args)}
        >
          {t.nodeActions.run}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
