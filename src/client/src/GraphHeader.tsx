import { color, font, radius, shadow } from './theme';
/**
 * ヘッダ (step3 Phase 3 S3-4a, 仕様 design-language「ヘッダ」)
 *
 * ボディで表示されているグラフ全体に関するオプション・アクション・状態を出す。**アクティブな
 * view に対して 1 本** (Q5)。以前は React Flow の浮きパネル (`GraphEditor` の中) と、branch の
 * コミット・merge の浮き要素 (App) に分かれていた。
 *
 * canvas に触れる操作は `GraphEditorControls` を通す。口がまだ無い (canvas を描いている途中) 間は
 * それらのボタンを押せなくする。
 */

import { type CSSProperties, useState } from 'react';
import type { GraphEditorControls } from './graph/editorControls';

export const GRAPH_HEADER_HEIGHT = 40;

/** 開いている branch の状態と操作。trunk を見ているときは渡さない */
export type HeaderBranch = {
  name: string;
  merged: boolean;
  pendingCount: number;
  canMerge: boolean;
  onCommit: () => void;
  onMerge: () => void;
};

type Props = {
  controls: GraphEditorControls | null;
  searchOpen: boolean;
  onToggleSearch: () => void;
  propertyOpen: boolean;
  onToggleProperty: () => void;
  branch: HeaderBranch | null;
  /**
   * 並べられるもの (multiple モードの開発用の入口, S3-5 / Q6)。開いている他のタブのアドレスで、
   * 選ぶとこのタブの pane として並ぶ。渡さなければ「⧉」は出さない (本番の既定)
   */
  paneCandidates?: readonly { label: string; onAdd: () => void }[];
};

const BUTTON: CSSProperties = {
  padding: '4px 10px',
  fontSize: font.body,
  cursor: 'pointer',
  background: color.bgActive,
  color: color.text,
  border: 'none',
  borderRadius: radius.md,
};
const ACCENT = color.selection;
const COMMIT_COLOR = color.primary;
const MERGE_COLOR = color.primary;
const DISABLED_COLOR = color.textDisabled;

function toggleStyle(on: boolean): CSSProperties {
  return on
    ? { ...BUTTON, background: ACCENT, color: color.textOnPrimary }
    : BUTTON;
}

function actionStyle(enabled: boolean, bg: string): CSSProperties {
  return {
    ...BUTTON,
    background: enabled ? bg : DISABLED_COLOR,
    color: color.textOnPrimary,
    cursor: enabled ? 'pointer' : 'not-allowed',
  };
}

export function GraphHeader({
  controls,
  searchOpen,
  onToggleSearch,
  propertyOpen,
  onToggleProperty,
  branch,
  paneCandidates,
}: Props) {
  const ready = controls !== null;
  const [paneMenuOpen, setPaneMenuOpen] = useState(false);
  return (
    <div
      role="toolbar"
      aria-label="グラフの操作"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        height: GRAPH_HEADER_HEIGHT,
        flexShrink: 0,
        padding: '0 8px',
        borderBottom: `1px solid ${color.border}`,
        background: color.bgSubtle,
      }}
    >
      {/* 検索の口 (step2 Phase 7)。仕様「検索ボタンで検索窓がポップアップ」 */}
      <button
        type="button"
        onClick={onToggleSearch}
        title="このシートを検索"
        aria-pressed={searchOpen}
        style={toggleStyle(searchOpen)}
      >
        🔍
      </button>
      {/* property editor 表示の on/off。**選んだ要素に対して出す** (step2 Phase 4 Q2) */}
      <button
        type="button"
        onClick={onToggleProperty}
        title="プロパティ"
        aria-pressed={propertyOpen}
        style={{ ...toggleStyle(propertyOpen), marginRight: 8 }}
      >
        🏷
      </button>
      <button
        type="button"
        onClick={() => controls?.undo()}
        disabled={!ready}
        style={BUTTON}
      >
        Undo
      </button>
      <button
        type="button"
        onClick={() => controls?.redo()}
        disabled={!ready}
        style={{ ...BUTTON, marginRight: 8 }}
      >
        Redo
      </button>
      <button
        type="button"
        onClick={() => controls?.groupSelected()}
        disabled={!ready}
        style={{ ...BUTTON, background: ACCENT, color: color.textOnPrimary }}
      >
        グループ化
      </button>
      <button
        type="button"
        onClick={() => controls?.ungroupSelected()}
        disabled={!ready}
        style={{
          ...BUTTON,
          background: ACCENT,
          color: color.textOnPrimary,
          marginRight: 8,
        }}
      >
        グループ解除
      </button>
      <button
        type="button"
        onClick={() => controls?.exportPng()}
        disabled={!ready}
        style={BUTTON}
      >
        PNG
      </button>
      {paneCandidates && (
        <div style={{ position: 'relative', marginLeft: 8 }}>
          <button
            type="button"
            title="並べる (開発用)"
            aria-expanded={paneMenuOpen}
            onClick={() => setPaneMenuOpen((open) => !open)}
            style={toggleStyle(paneMenuOpen)}
          >
            ⧉
          </button>
          {paneMenuOpen && (
            <div
              role="menu"
              aria-label="並べるグラフ"
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                zIndex: 10,
                background: color.bg,
                border: `1px solid ${color.border}`,
                borderRadius: radius.md,
                boxShadow: shadow.dialog,
                minWidth: 200,
                padding: 4,
              }}
            >
              {paneCandidates.length === 0 ? (
                <div
                  style={{
                    fontSize: font.body,
                    color: color.textMuted,
                    padding: 6,
                  }}
                >
                  並べられるタブがありません
                </div>
              ) : (
                paneCandidates.map((c) => (
                  <button
                    key={c.label}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      c.onAdd();
                      setPaneMenuOpen(false);
                    }}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: font.body,
                      padding: '4px 6px',
                    }}
                  >
                    {c.label}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}
      {branch && (
        <div
          style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span style={{ fontSize: font.body, color: color.textMuted }}>
            ⎇ {branch.name}
            {branch.merged && ' (merged)'}
            {branch.pendingCount > 0 ? ` (${branch.pendingCount} 変更)` : ''}
          </span>
          <button
            type="button"
            onClick={branch.onCommit}
            disabled={branch.pendingCount === 0}
            style={actionStyle(branch.pendingCount > 0, COMMIT_COLOR)}
          >
            コミット
          </button>
          <button
            type="button"
            onClick={branch.onMerge}
            // merge できるのは「commit 済み」= 未コミットの編集が無く commit が
            // 1 件以上ある状態だけ。画面に出ている差分がそのまま merge の対象になる
            disabled={!branch.canMerge}
            style={actionStyle(branch.canMerge, MERGE_COLOR)}
          >
            merge ↑
          </button>
        </div>
      )}
    </div>
  );
}
