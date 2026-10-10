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

import {
  Columns2,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  Group,
  ImageDown,
  PanelRight,
  Redo2,
  Search,
  Undo2,
  Ungroup,
} from 'lucide-react';
import { useState } from 'react';
import type { GraphEditorControls } from './graph/editorControls';
import type { GroupAbility } from './hooks/useGroupNodes';
import { Button, ICON_SIZE, IconButton } from './ui/Button';

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
  /** 「group にまとめる / 解く」を押せるか (#269)。押せないときは隠さず無効にする */
  groupAbility: GroupAbility;
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

/** 操作のまとまりの間を空ける (visual language §3 の余白の段) */
const GROUP_GAP = 12;

export function GraphHeader({
  controls,
  groupAbility,
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
      <IconButton
        icon={Search}
        label="このシートを検索"
        onClick={onToggleSearch}
        aria-pressed={searchOpen}
      />
      {/* property editor 表示の on/off。**選んだ要素に対して出す** (step2 Phase 4 Q2) */}
      <IconButton
        icon={PanelRight}
        label="プロパティ"
        onClick={onToggleProperty}
        aria-pressed={propertyOpen}
        style={{ marginRight: GROUP_GAP }}
      />
      <IconButton
        icon={Undo2}
        label="Undo"
        onClick={() => controls?.undo()}
        disabled={!ready}
      />
      <IconButton
        icon={Redo2}
        label="Redo"
        onClick={() => controls?.redo()}
        disabled={!ready}
        style={{ marginRight: GROUP_GAP }}
      />
      {/* **使えないときは無効にして見せる** (#269)。隠すと置き場所が変わる */}
      <Button
        variant="plain"
        icon={Group}
        onClick={() => controls?.groupSelected()}
        disabled={!ready || !groupAbility.canGroup}
      >
        グループ化
      </Button>
      <Button
        variant="plain"
        icon={Ungroup}
        onClick={() => controls?.ungroupSelected()}
        disabled={!ready || !groupAbility.canUngroup}
        style={{ marginRight: GROUP_GAP }}
      >
        グループ解除
      </Button>
      <IconButton
        icon={ImageDown}
        label="PNG で書き出す"
        onClick={() => controls?.exportPng()}
        disabled={!ready}
      />
      {paneCandidates && (
        <div style={{ position: 'relative', marginLeft: 8 }}>
          <IconButton
            icon={Columns2}
            label="並べる (開発用)"
            aria-expanded={paneMenuOpen}
            onClick={() => setPaneMenuOpen((open) => !open)}
          />
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
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: font.body,
              color: color.textMuted,
            }}
          >
            <GitBranch size={ICON_SIZE} aria-hidden />
            {branch.name}
            {branch.merged && ' (merged)'}
            {branch.pendingCount > 0 ? ` (${branch.pendingCount} 変更)` : ''}
          </span>
          <Button
            variant="secondary"
            icon={GitCommitHorizontal}
            onClick={branch.onCommit}
            disabled={branch.pendingCount === 0}
          >
            コミット
          </Button>
          <Button
            variant="secondary"
            icon={GitMerge}
            onClick={branch.onMerge}
            // merge できるのは「commit 済み」= 未コミットの編集が無く commit が
            // 1 件以上ある状態だけ。画面に出ている差分がそのまま merge の対象になる
            disabled={!branch.canMerge}
          >
            merge ↑
          </Button>
        </div>
      )}
    </div>
  );
}
