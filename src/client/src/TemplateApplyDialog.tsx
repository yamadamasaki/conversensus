import { space } from './theme';
import { Button } from './ui/Button';
import { Dialog, DialogActions } from './ui/Dialog';
/**
 * template graph を当てるダイアログ (step3 Phase 4 Q7、#355)
 *
 * File の中の template graph をチェックボックスで並べる。**複数を当てられる** (仕様)。
 *
 * - `add` (既定): シートを足す。何も選ばずに足せばただのシートになる。File に template graph が 1 つも
 *   無いときは出さない (今の 1 クリックのまま)
 * - `apply`: 既にあるシートに後から当てる (#355)。並べるのはまだ当たっていないものだけ (呼ぶ側が絞る)。
 *   何も選ばなければ当てられない
 */

import { useState } from 'react';
import { useMessages } from './i18n/messages';

type Props = {
  templateGraphs: readonly { id: string; name: string }[];
  mode?: 'add' | 'apply';
  onSubmit: (selected: string[]) => void;
  onCancel: () => void;
};

export function TemplateApplyDialog({
  templateGraphs,
  mode = 'add',
  onSubmit,
  onCancel,
}: Props) {
  const t = useMessages();
  const apply = mode === 'apply';
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Dialog
      kind="input"
      label={apply ? t.templateApply.applyTitle : t.templateApply.title}
      onDismiss={onCancel}
    >
      <p style={{ margin: `0 0 ${space[2]}px` }}>
        {apply ? t.templateApply.applyBody : t.templateApply.body}
      </p>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {templateGraphs.map((t) => (
          <li key={t.id}>
            <label
              style={{
                display: 'flex',
                gap: space[2],
                padding: `${space[1] / 2}px 0`,
              }}
            >
              <input
                type="checkbox"
                checked={selected.has(t.id)}
                onChange={() => toggle(t.id)}
              />
              {t.name}
            </label>
          </li>
        ))}
      </ul>
      <DialogActions>
        <Button onClick={onCancel}>{t.common.cancel}</Button>
        <Button
          variant="primary"
          disabled={apply && selected.size === 0}
          // 並びは File の中の template graph の順にする (選んだ順ではない)
          onClick={() =>
            onSubmit(
              templateGraphs.map((t) => t.id).filter((id) => selected.has(id)),
            )
          }
        >
          {apply ? t.templateApply.applySubmit : t.templateApply.submit}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
