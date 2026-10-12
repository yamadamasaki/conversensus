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
  Check,
  Columns2,
  Ellipsis,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  Group,
  History,
  ImageDown,
  Link,
  Map as MapIcon,
  PanelRight,
  Redo2,
  Search,
  Undo2,
  Ungroup,
} from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import type { GraphEditorControls } from './graph/editorControls';
import type { GroupAbility } from './hooks/useGroupNodes';
import {
  type FoldableControl,
  foldedAt,
  HEADER_FOLD_ORDER,
  ICONS_ONLY_LEVEL,
  iconsOnlyAt,
} from './layout/headerFold';
import { useFoldLevel } from './layout/useFoldLevel';
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
  /**
   * 過去の時点を見ている (#73 その時点のタブ)。読み取り専用。branch の時点なら branch の名前
   * (このときは `branch` を渡さない — commit・merge は最新の branch に対する操作なので出さない)
   */
  past?: { branchName: string | null };
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
  /** map の on/off (#182)。渡さなければ出さない */
  mapOpen?: boolean;
  onToggleMap?: () => void;
  branch: HeaderBranch | null;
  /**
   * 並べられるもの (multiple モードの開発用の入口, S3-5 / Q6)。開いている他のタブのアドレスで、
   * 選ぶとこのタブの pane として並ぶ。渡さなければ「⧉」は出さない (本番の既定)
   */
  paneCandidates?: readonly { label: string; onAdd: () => void }[];
  /**
   * この view のリンク (#251) を写す。写せたら resolve する。アドレスバーの無い PWA の窓でも
   * 渡せるように置く。渡さなければ出さない
   */
  onCopyLink?: () => Promise<void>;
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

/** 「写しました」を出しておく長さ */
export const LINK_COPIED_MS = 1500;

/** リンクを写すボタン。写せたら少しの間、印を替えて知らせる */
function CopyLinkButton({ onCopy }: { onCopy: () => Promise<void> }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), LINK_COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <IconButton
      icon={copied ? Check : Link}
      label={copied ? 'リンクを写しました' : 'この view のリンクを写す'}
      onClick={() => {
        // 写せなかったときの知らせは渡した側が出す
        onCopy().then(
          () => setCopied(true),
          () => {},
        );
      }}
    />
  );
}

/** 操作のまとまりの間を空ける (visual language §3 の余白の段) */
const GROUP_GAP = 12;
/**
 * 名前の欄の最小の幅。名前は残りの幅を使って省略で縮むが、これより狭くなる前に操作の方を
 * 「…」へ畳む (`headerFold.ts`)。0 まで縮めると、どのグラフを見ているかが分からなくなる
 */
const TITLE_MIN_WIDTH = 120;
const COMPACT_TITLE_MIN_WIDTH = 64;
/** branch の名前の幅の上限。長い名前でチップが名前の欄を占めないように (全体は tooltip) */
const BRANCH_NAME_MAX_WIDTH = 160;

/** 省略で縮む名前。全体は tooltip に出す */
function ClippedName({ name, maxWidth }: { name: string; maxWidth?: number }) {
  return (
    <span
      title={name}
      style={{
        minWidth: 0,
        maxWidth,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      {name}
    </span>
  );
}

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
        // 残りの幅を全部使い、足りなければ省略で縮む (最小の幅まで)
        flex: '1 1 auto',
        minWidth: compact ? COMPACT_TITLE_MIN_WIDTH : TITLE_MIN_WIDTH,
        overflow: 'hidden',
        marginRight: GROUP_GAP,
        fontSize: font.body,
      }}
    >
      <span
        title={full}
        style={{
          flex: '0 1 auto',
          minWidth: 0,
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
      {title.past ? (
        <>
          {title.past.branchName !== null ? (
            <Chip
              tone="branch"
              title={compact ? title.past.branchName : undefined}
            >
              <GitBranch size={ICON_SIZE_SM} aria-hidden />
              {!compact && (
                <ClippedName
                  name={title.past.branchName}
                  maxWidth={BRANCH_NAME_MAX_WIDTH}
                />
              )}
            </Chip>
          ) : (
            <Chip tone="neutral">trunk</Chip>
          )}
          <Chip tone="pending" title="過去の時点の姿です。編集できません">
            <History size={ICON_SIZE_SM} aria-hidden />
            {compact ? '時点' : '過去の時点 · 読み取り専用'}
          </Chip>
        </>
      ) : title.merger ? (
        <Chip tone="branch">
          <GitMerge size={ICON_SIZE_SM} aria-hidden />
          merge
        </Chip>
      ) : branch ? (
        <Chip tone="branch" title={compact ? branch.name : undefined}>
          <GitBranch size={ICON_SIZE_SM} aria-hidden />
          {!compact && (
            <ClippedName name={branch.name} maxWidth={BRANCH_NAME_MAX_WIDTH} />
          )}
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
  mapOpen,
  onToggleMap,
  branch,
  paneCandidates,
  onCopyLink,
  compact = false,
}: Props) {
  const ready = controls !== null;
  const [paneMenuOpen, setPaneMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);
  // 中身 (名前・出す操作) が変わったら、畳み方を下限から測り直す
  const contentKey = [
    title.fileName,
    title.sheetName,
    title.merger,
    title.past?.branchName,
    branch?.name,
    branch?.merged,
    branch?.pendingCount,
    Boolean(onToggleMap),
    Boolean(onCopyLink),
  ].join('|');
  const level = useFoldLevel(
    toolbarRef,
    compact ? ICONS_ONLY_LEVEL : 0,
    contentKey,
  );
  const folded = foldedAt(level);
  const iconsOnly = iconsOnlyAt(level);
  const shows = (control: FoldableControl) => !folded.has(control);
  /** 「…」に入れるもの。出す操作だけ (渡されていない操作は入れない) */
  const inMenu = HEADER_FOLD_ORDER.filter(
    (c) =>
      folded.has(c) &&
      (c !== 'map' || onToggleMap) &&
      (c !== 'link' || onCopyLink),
  );
  const closeMenu = () => setMoreOpen(false);
  return (
    <div
      ref={toolbarRef}
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
        // 畳み切っても入らない幅では切る (はみ出して下の canvas に重ならない)
        overflow: 'hidden',
      }}
    >
      <GraphTitle title={title} branch={branch} compact={compact} />
      {/* 検索の口 (step2 Phase 7)。仕様「検索ボタンで検索窓がポップアップ」 */}
      {shows('search') && (
        <IconButton
          icon={Search}
          label="この Sheet を検索"
          onClick={onToggleSearch}
          aria-pressed={searchOpen}
        />
      )}
      {/* property editor 表示の on/off。**選んだ要素に対して出す** (step2 Phase 4 Q2) */}
      <IconButton
        icon={PanelRight}
        label="property"
        onClick={onToggleProperty}
        aria-pressed={propertyOpen}
        style={
          onToggleMap && shows('map') ? undefined : { marginRight: GROUP_GAP }
        }
      />
      {onToggleMap && shows('map') && (
        <IconButton
          icon={MapIcon}
          label="map"
          onClick={onToggleMap}
          aria-pressed={mapOpen ?? false}
          style={{ marginRight: GROUP_GAP }}
        />
      )}
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
      {shows('group') && (
        <>
          <LabeledButton
            compact={iconsOnly}
            icon={Group}
            label="group にまとめる"
            onClick={() => controls?.groupSelected()}
            disabled={!ready || !groupAbility.canGroup}
          />
          <LabeledButton
            compact={iconsOnly}
            icon={Ungroup}
            label="group を解く"
            onClick={() => controls?.ungroupSelected()}
            disabled={!ready || !groupAbility.canUngroup}
            style={{ marginRight: GROUP_GAP }}
          />
        </>
      )}
      {shows('png') && (
        <IconButton
          icon={ImageDown}
          label="PNG で書き出す"
          onClick={() => controls?.exportPng()}
          disabled={!ready}
        />
      )}
      {onCopyLink && shows('link') && <CopyLinkButton onCopy={onCopyLink} />}
      {inMenu.length > 0 && (
        // 幅が足りずに畳んだ操作 (`headerFold.ts`)。使う頻度の低いものから入る
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <IconButton
            icon={Ellipsis}
            label="その他の操作"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((open) => !open)}
          />
          {moreOpen && (
            <HeaderMenu label="その他の操作">
              {inMenu.map((control) => (
                <FoldedItem
                  key={control}
                  control={control}
                  ready={ready}
                  controls={controls}
                  groupAbility={groupAbility}
                  searchOpen={searchOpen}
                  onToggleSearch={onToggleSearch}
                  mapOpen={mapOpen ?? false}
                  onToggleMap={onToggleMap}
                  onCopyLink={onCopyLink}
                  onDone={closeMenu}
                />
              ))}
            </HeaderMenu>
          )}
        </div>
      )}
      {paneCandidates && level === 0 && (
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
            flexShrink: 0,
          }}
        >
          <LabeledButton
            compact={iconsOnly}
            variant="secondary"
            icon={GitCommitHorizontal}
            label="commit"
            onClick={branch.onCommit}
            disabled={branch.pendingCount === 0}
          />
          <LabeledButton
            compact={iconsOnly}
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

/** 「…」の中の 1 項目。畳んだ操作と同じ働きをし、押したらメニューを閉じる */
function FoldedItem({
  control,
  ready,
  controls,
  groupAbility,
  searchOpen,
  onToggleSearch,
  mapOpen,
  onToggleMap,
  onCopyLink,
  onDone,
}: {
  control: FoldableControl;
  ready: boolean;
  controls: GraphEditorControls | null;
  groupAbility: GroupAbility;
  searchOpen: boolean;
  onToggleSearch: () => void;
  mapOpen: boolean;
  onToggleMap?: () => void;
  onCopyLink?: () => Promise<void>;
  onDone: () => void;
}) {
  const item = (
    icon: LucideIcon,
    label: string,
    run: () => void,
    options: { disabled?: boolean; checked?: boolean } = {},
  ) => {
    const Icon = icon;
    const onClick = () => {
      run();
      onDone();
    };
    const body = (
      <>
        <Icon size={ICON_SIZE} aria-hidden />
        {label}
      </>
    );
    // on/off の操作は押されているかを読み上げる (`menuitemcheckbox`)
    return options.checked === undefined ? (
      <button
        key={label}
        type="button"
        role="menuitem"
        disabled={options.disabled}
        onClick={onClick}
        style={MENU_ITEM}
      >
        {body}
      </button>
    ) : (
      <button
        key={label}
        type="button"
        role="menuitemcheckbox"
        aria-checked={options.checked}
        disabled={options.disabled}
        onClick={onClick}
        style={MENU_ITEM}
      >
        {body}
      </button>
    );
  };
  switch (control) {
    case 'png':
      return item(ImageDown, 'PNG で書き出す', () => controls?.exportPng(), {
        disabled: !ready,
      });
    case 'map':
      return onToggleMap
        ? item(MapIcon, 'map', onToggleMap, { checked: mapOpen })
        : null;
    case 'link':
      return onCopyLink
        ? item(Link, 'この view のリンクを写す', () => {
            // 写せなかったときの知らせは渡した側が出す
            onCopyLink().catch(() => {});
          })
        : null;
    case 'group':
      return (
        <>
          {item(Group, 'group にまとめる', () => controls?.groupSelected(), {
            disabled: !ready || !groupAbility.canGroup,
          })}
          {item(Ungroup, 'group を解く', () => controls?.ungroupSelected(), {
            disabled: !ready || !groupAbility.canUngroup,
          })}
        </>
      );
    case 'search':
      return item(Search, 'この Sheet を検索', onToggleSearch, {
        checked: searchOpen,
      });
  }
}
