/**
 * edge の種類を選ぶメニュー (step3 Phase 4 Q8)。繋いだ両端から決まる種類の候補が複数あるとき、
 * 繋いだ直後に出す。**選ばずに閉じたら種類無しの edge のまま繋ぐ** (仕様: 一意に決まらない場合は
 * 選択肢を提示する。選ばないことも許す)
 *
 * 候補は template ごとにまとめて並べる (仕様: 種類は template ごとにまとまって表示されるとよい)
 */

import type { EdgeKindRef, Template } from '@conversensus/shared';
import { useEffect } from 'react';
import { FLOATING_UI_Z_INDEX } from './SettingsPopup';

type Props = {
  position: { x: number; y: number };
  candidates: readonly EdgeKindRef[];
  templates: readonly Template[];
  onSelect: (kind: EdgeKindRef | undefined) => void;
};

/** label の無い種類 (「この組は繋いでよい」だけを表す) の見せ方 */
const UNNAMED = '(名前なし)';

export function EdgeKindMenu({
  position,
  candidates,
  templates,
  onSelect,
}: Props) {
  // Escape で閉じる = 種類無しで繋ぐ
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onSelect(undefined);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSelect]);

  const groups = templates
    .map((t) => ({
      template: t,
      refs: candidates.filter((c) => c.templateId === t.id),
    }))
    .filter((g) => g.refs.length > 0);

  return (
    <div
      role="menu"
      aria-label="edge の種類"
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        zIndex: FLOATING_UI_Z_INDEX,
        background: '#fff',
        border: '1px solid #ccc',
        borderRadius: 6,
        boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
        padding: 4,
        minWidth: 160,
        fontSize: 12,
      }}
    >
      {groups.map(({ template, refs }) => (
        <div key={template.id}>
          <div style={{ color: '#888', padding: '2px 6px' }}>
            {template.name}
          </div>
          {refs.map((ref) => (
            <button
              key={ref.kind.id}
              type="button"
              role="menuitem"
              onClick={() => onSelect(ref)}
              style={ITEM}
            >
              {ref.kind.label || UNNAMED}
            </button>
          ))}
        </div>
      ))}
      <button
        type="button"
        role="menuitem"
        onClick={() => onSelect(undefined)}
        style={{ ...ITEM, color: '#888', borderTop: '1px solid #eee' }}
      >
        種類なしで繋ぐ
      </button>
    </div>
  );
}

const ITEM = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: '4px 6px',
  fontSize: 12,
} as const;
