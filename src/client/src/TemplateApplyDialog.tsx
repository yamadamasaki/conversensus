import { space } from './theme';
import { Button } from './ui/Button';
import { Dialog, DialogActions } from './ui/Dialog';
/**
 * template graph を当ててシートを足すダイアログ (step3 Phase 4 Q7)
 *
 * File の中の template graph をチェックボックスで並べる。**複数を当てられる** (仕様)。何も選ばずに
 * 足せばただのシートになる。File に template graph が 1 つも無いときは出さない (今の 1 クリックのまま)
 */

import { useState } from 'react';

type Props = {
  templateGraphs: readonly { id: string; name: string }[];
  onSubmit: (selected: string[]) => void;
  onCancel: () => void;
};

export function TemplateApplyDialog({
  templateGraphs,
  onSubmit,
  onCancel,
}: Props) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Dialog kind="input" label="Sheet を追加" onDismiss={onCancel}>
      <p style={{ margin: `0 0 ${space[2]}px` }}>
        当てる template graph を選んでください
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
        <Button onClick={onCancel}>キャンセル</Button>
        <Button
          variant="primary"
          // 並びは File の中の template graph の順にする (選んだ順ではない)
          onClick={() =>
            onSubmit(
              templateGraphs.map((t) => t.id).filter((id) => selected.has(id)),
            )
          }
        >
          Sheet を追加
        </Button>
      </DialogActions>
    </Dialog>
  );
}
