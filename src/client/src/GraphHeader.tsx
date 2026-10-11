import { color, font, fontWeight, radius, shadow } from './theme';

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

import type { LucideIcon } from 'lucide-react';
import {
  Columns2,
  Ellipsis,
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
import { type ReactNode, useState } from 'react';
import type { GraphEditorControls } from './graph/editorControls';
import type { GroupAbility } from './hooks/useGroupNodes';
import { Button, ICON_SIZE, ICON_SIZE_SM, IconButton } from './ui/Button';

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

/** 開いているグラフの名前と、どの流れか (#276) */
export type HeaderTitle = {
  fileName: string;
  sheetName: string;
  /** merger のタブ。merge 後の姿を見ている */
  merger: boolean;
};

type Props = {
  controls: GraphEditorControls | null;
  /**
   * 開いているグラフの名前と状態 (#276)。design language の「ヘッダ = 個々のグラフを管理する」
   * なので、タブだけでなくここにも出す。状態は trunk / branch (merged・未 commit の変更) / merge
   */
  title: HeaderTitle;
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
  /**
   * 狭い画面 (visual language §9.2)。文字のボタンを記号だけにし、たまにしか使わないもの
   * (PNG・並べる) を `Ellipsis` のメニューへ入れる
   */
  compact?: boolean;
};

/** 文字のボタン。狭い画面では記号だけにする (名前は aria-label と tooltip に残す) */
function LabeledButton({
  compact,
  icon,
  label,
  variant = 'plain',
  ...rest
}: {
  compact: boolean;
  icon: LucideIcon;
  label: string;
  variant?: 'plain' | 'secondary';
  onClick: () => void;
  disabled?: boolean;
  style?: React.CSSProperties;
}) {
  return compact ? (
    <IconButton icon={icon} label={label} {...rest} />
  ) : (
    <Button variant={variant} icon={icon} {...rest}>
      {label}
    </Button>
  );
}

/** ヘッダから開くメニュー (並べる・その他の操作) */
function HeaderMenu({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div
      role="menu"
      aria-label={label}
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
      {children}
    </div>
  );
}

const MENU_ITEM = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  width: '100%',
  textAlign: 'left',
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  fontSize: font.body,
  padding: '4px 6px',
} as const;

/** 操作のまとまりの間を空ける (visual language §3 の余白の段) */
const GROUP_GAP = 12;
/** 名前が長くても道具のボタンを押し出さないよう、名前の幅に上限を置く */
const TITLE_MAX_WIDTH = 240;
const COMPACT_TITLE_MAX_WIDTH = 72;

/** 状態の印。流れ (trunk / branch / merge) と、未 commit の変更 */
function Chip({
  tone,
  children,
  title,
}: {
  tone: 'neutral' | 'branch' | 'pending';
  children: ReactNode;
  title?: string;
}) {
  const tones = {
    neutral: { bg: color.bg, fg: color.textMuted, border: color.border },
    branch: {
      bg: color.selectionBg,
      fg: color.text,
      border: color.selection,
    },
    pending: {
      bg: color.warningBg,
      fg: color.warningText,
      border: color.warning,
    },
  } as const;
  const t = tones[tone];
  return (
    <span
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        flexShrink: 0,
        padding: '0 6px',
        lineHeight: '20px',
        fontSize: font.caption,
        whiteSpace: 'nowrap',
        borderRadius: radius.sm,
        border: `1px solid ${t.border}`,
        background: t.bg,
        color: t.fg,
      }}
    >
      {children}
    </span>
  );
}

/** 開いているグラフの名前と状態 (#276) */
function GraphTitle({
  title,
  branch,
  compact,
}: {
  title: HeaderTitle;
  branch: HeaderBranch | null;
  compact: boolean;
}) {
  const full = `${title.fileName} / ${title.sheetName}`;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        minWidth: 0,
        marginRight: GROUP_GAP,
        fontSize: font.body,
      }}
    >
      <span
        title={full}
        style={{
          minWidth: 0,
          maxWidth: compact ? COMPACT_TITLE_MAX_WIDTH : TITLE_MAX_WIDTH,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {/* 狭い画面では File の名前を tooltip に退け、Sheet の名前だけを残す */}
        {!compact && (
          <span style={{ color: color.textMuted }}>{title.fileName} / </span>
        )}
        <strong style={{ fontWeight: fontWeight.strong }}>
          {title.sheetName}
        </strong>
      </span>
      {title.merger ? (
        <Chip tone="branch">
          <GitMerge size={ICON_SIZE_SM} aria-hidden />
          merge
        </Chip>
      ) : branch ? (
        <Chip tone="branch" title={compact ? branch.name : undefined}>
          <GitBranch size={ICON_SIZE_SM} aria-hidden />
          {!compact && <span>{branch.name}</span>}
          {branch.merged && <span>(merged)</span>}
        </Chip>
      ) : (
        <Chip tone="neutral">trunk</Chip>
      )}
      {branch && branch.pendingCount > 0 && (
        <Chip tone="pending" title="まだ commit していない変更">
          {branch.pendingCount} 変更
        </Chip>
      )}
    </div>
  );
}

export function GraphHeader({
  controls,
  title,
  groupAbility,
  searchOpen,
  onToggleSearch,
  propertyOpen,
  onToggleProperty,
  branch,
  paneCandidates,
  compact = false,
}: Props) {
  const ready = controls !== null;
  const [paneMenuOpen, setPaneMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
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
      <GraphTitle title={title} branch={branch} compact={compact} />
      {/* 検索の口 (step2 Phase 7)。仕様「検索ボタンで検索窓がポップアップ」 */}
      <IconButton
        icon={Search}
        label="この Sheet を検索"
        onClick={onToggleSearch}
        aria-pressed={searchOpen}
      />
      {/* property editor 表示の on/off。**選んだ要素に対して出す** (step2 Phase 4 Q2) */}
      <IconButton
        icon={PanelRight}
        label="property"
        onClick={onToggleProperty}
        aria-pressed={propertyOpen}
        style={{ marginRight: GROUP_GAP }}
      />
      <IconButton
        icon={Undo2}
        label="元に戻す"
        onClick={() => controls?.undo()}
        disabled={!ready}
      />
      <IconButton
        icon={Redo2}
        label="やり直す"
        onClick={() => controls?.redo()}
        disabled={!ready}
        style={{ marginRight: GROUP_GAP }}
      />
      {/* **使えないときは無効にして見せる** (#269)。隠すと置き場所が変わる */}
      <LabeledButton
        compact={compact}
        icon={Group}
        label="group にまとめる"
        onClick={() => controls?.groupSelected()}
        disabled={!ready || !groupAbility.canGroup}
      />
      <LabeledButton
        compact={compact}
        icon={Ungroup}
        label="group を解く"
        onClick={() => controls?.ungroupSelected()}
        disabled={!ready || !groupAbility.canUngroup}
        style={{ marginRight: GROUP_GAP }}
      />
      {compact ? (
        // 溢れたものを入れるメニュー (§9.2)。たまにしか使わないものだけを入れる
        <div style={{ position: 'relative' }}>
          <IconButton
            icon={Ellipsis}
            label="その他の操作"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((open) => !open)}
          />
          {moreOpen && (
            <HeaderMenu label="その他の操作">
              <button
                type="button"
                role="menuitem"
                disabled={!ready}
                onClick={() => {
                  controls?.exportPng();
                  setMoreOpen(false);
                }}
                style={MENU_ITEM}
              >
                <ImageDown size={ICON_SIZE} aria-hidden />
                PNG で書き出す
              </button>
            </HeaderMenu>
          )}
        </div>
      ) : (
        <IconButton
          icon={ImageDown}
          label="PNG で書き出す"
          onClick={() => controls?.exportPng()}
          disabled={!ready}
        />
      )}
      {paneCandidates && !compact && (
        <div style={{ position: 'relative', marginLeft: 8 }}>
          <IconButton
            icon={Columns2}
            label="並べる (開発用)"
            aria-expanded={paneMenuOpen}
            onClick={() => setPaneMenuOpen((open) => !open)}
          />
          {paneMenuOpen && (
            <HeaderMenu label="並べるグラフ">
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
                    style={MENU_ITEM}
                  >
                    {c.label}
                  </button>
                ))
              )}
            </HeaderMenu>
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
          <LabeledButton
            compact={compact}
            variant="secondary"
            icon={GitCommitHorizontal}
            label="commit"
            onClick={branch.onCommit}
            disabled={branch.pendingCount === 0}
          />
          <LabeledButton
            compact={compact}
            variant="secondary"
            icon={GitMerge}
            label="merge"
            onClick={branch.onMerge}
            // merge できるのは「commit 済み」= 未コミットの編集が無く commit が
            // 1 件以上ある状態だけ。画面に出ている差分がそのまま merge の対象になる
            disabled={!branch.canMerge}
          />
        </div>
      )}
    </div>
  );
}
