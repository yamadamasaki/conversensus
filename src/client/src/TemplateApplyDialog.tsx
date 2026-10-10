import { color, font, overlay, radius } from './theme';
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
    <div
      role="dialog"
      aria-label="シートを追加"
      style={{
        position: 'fixed',
        inset: 0,
        background: overlay,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        style={{
          background: color.bg,
          borderRadius: radius.md,
          padding: 16,
          minWidth: 280,
          fontSize: font.body,
        }}
      >
        <p style={{ margin: '0 0 8px' }}>
          当てる template graph を選んでください
        </p>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {templateGraphs.map((t) => (
            <li key={t.id}>
              <label style={{ display: 'flex', gap: 6, padding: '2px 0' }}>
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
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            marginTop: 12,
          }}
        >
          <button type="button" onClick={onCancel}>
            キャンセル
          </button>
          <button
            type="button"
            // 並びは File の中の template graph の順にする (選んだ順ではない)
            onClick={() =>
              onSubmit(
                templateGraphs
                  .map((t) => t.id)
                  .filter((id) => selected.has(id)),
              )
            }
          >
            シートを追加
          </button>
        </div>
      </div>
    </div>
  );
}
