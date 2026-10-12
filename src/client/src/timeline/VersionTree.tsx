/**
 * version tree (#73 timeline view, 計画 T3)
 *
 * 仕様の図は trunk と branch を横に並べた線だが、右サイドバーは狭い (既定 280px)。そこで **木として
 * 縦に並べる**: trunk の線を上から下へ出し、分岐の点の直下にその branch の線を字下げして出す。
 * merge は trunk の線の上に「merge b1」として出る。
 *
 * - いまの線 (見ている trunk / branch) を強調する (仕様)
 * - operation point は大きな丸、change point は小さな丸 (仕様)。change point の続きは
 *   「N 件の変更」に畳み、押すと広げる (Q2)
 * - 点を押すと選び、その直下に詳細 (inspector) を出す。出すのは選んだ 1 つだけ
 */

import type { BranchId } from '@conversensus/shared';
import { type ReactNode, useState } from 'react';
import { color, font, radius } from '../theme';
import type {
  ChangePoint,
  OperationPoint,
  TimelineEntry,
  TimelineLane,
} from './buildTimeline';

/** 選んだ点。どの線の上か (`lane`) も持つ — view graph でその線のアドレスを組む */
export type TimelineSelection =
  | { kind: 'operation'; point: OperationPoint; lane: BranchId | null }
  | { kind: 'change'; point: ChangePoint; lane: BranchId | null };

type Props = {
  lanes: readonly TimelineLane[];
  /** 見ている線。trunk は null */
  currentLane: BranchId | null;
  selected: TimelineSelection | null;
  /** 点を押した。選んでいる点をもう一度押したときも呼ぶ (閉じるかは呼んだ側が決める) */
  onSelect: (selection: TimelineSelection) => void;
  labelOfActor: (actor: string) => string;
  /**
   * 選んだ点の詳細 (inspector)。**その点の直下に出す** — 変更が多いと、木の下に出した inspector が
   * 押した点から遠くなって見えにくい (利用者の指摘 2026-10-12)。出すのは選んだ 1 つだけ
   */
  renderDetail: (selection: TimelineSelection) => ReactNode;
};

const TIME_FORMAT = new Intl.DateTimeFormat('ja-JP', {
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatTime(timestamp: number): string {
  return TIME_FORMAT.format(new Date(timestamp));
}

/** operation point の名前 */
export function operationLabel(point: OperationPoint): string {
  switch (point.kind) {
    case 'branch':
      return `branch ${point.branch.name}`;
    case 'commit':
      return point.commit.message || '(コメントなし)';
    case 'merge':
      return `merge ${point.source?.name ?? ''}`.trim();
  }
}

/** 選ばれているか。点の同一性は operation なら id、change なら batch の id */
function isSelected(
  selected: TimelineSelection | null,
  candidate: TimelineSelection,
): boolean {
  if (!selected || selected.kind !== candidate.kind) return false;
  if (selected.kind === 'change' && candidate.kind === 'change')
    return selected.point.batch.id === candidate.point.batch.id;
  if (selected.kind === 'operation' && candidate.kind === 'operation') {
    const id = (p: OperationPoint) =>
      p.kind === 'branch' ? `branch:${p.branch.id}` : `commit:${p.commit.id}`;
    return id(selected.point) === id(candidate.point);
  }
  return false;
}

const OPERATION_DOT = 12;
const CHANGE_DOT = 6;
const INDENT = 16;

function Dot({ size, filled }: { size: number; filled: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        flexShrink: 0,
        width: size,
        height: size,
        borderRadius: '50%',
        border: `2px solid ${color.text}`,
        background: filled ? color.text : color.bg,
        boxSizing: 'border-box',
      }}
    />
  );
}

/** 線の上の 1 行。左の縦線 (いまの線なら太く色を付ける) と丸と文字 */
function Row({
  emphasized,
  dot,
  children,
}: {
  emphasized: boolean;
  dot: ReactNode;
  children: ReactNode;
}) {
  return (
    <li
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        minHeight: 24,
        paddingLeft: 6,
        borderLeft: `${emphasized ? 3 : 1}px solid ${
          emphasized ? color.selection : color.border
        }`,
      }}
    >
      <span
        style={{
          width: OPERATION_DOT,
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        {dot}
      </span>
      {children}
    </li>
  );
}

const POINT_BUTTON = {
  flex: 1,
  minWidth: 0,
  textAlign: 'left',
  background: 'none',
  border: 'none',
  borderRadius: radius.sm,
  padding: '2px 4px',
  cursor: 'pointer',
  fontSize: font.body,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
} as const;

function PointButton({
  pressed,
  onClick,
  children,
  title,
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      title={title}
      onClick={onClick}
      style={{
        ...POINT_BUTTON,
        background: pressed ? color.selectionBg : 'none',
      }}
    >
      {children}
    </button>
  );
}

export function VersionTree({
  lanes,
  currentLane,
  selected,
  onSelect,
  labelOfActor,
  renderDetail,
}: Props) {
  /** 選んだ点なら、その直下に詳細を出す行 */
  const detailOf = (candidate: TimelineSelection, key: string) =>
    isSelected(selected, candidate) ? (
      <li
        key={`${key}-detail`}
        style={{ listStyle: 'none', margin: '2px 0 6px' }}
      >
        {renderDetail(candidate)}
      </li>
    ) : null;
  /** 広げた change point の続き。鍵は先頭の batch の id */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const toggle = (key: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const laneById = new Map(lanes.map((l) => [l.branchId, l]));
  const placed = new Set<BranchId | null>();

  const renderEntry = (
    entry: TimelineEntry,
    lane: TimelineLane,
    index: number,
  ): ReactNode => {
    const emphasized = lane.branchId === currentLane;
    if (entry.kind === 'changes') {
      const key = entry.points[0]?.batch.id ?? `${lane.branchId}-${index}`;
      const open = expanded.has(key);
      return (
        <li key={key} style={{ listStyle: 'none' }}>
          <ul style={{ margin: 0, padding: 0 }}>
            <Row
              emphasized={emphasized}
              dot={<Dot size={CHANGE_DOT} filled={false} />}
            >
              <button
                type="button"
                aria-expanded={open}
                onClick={() => toggle(key)}
                style={{
                  ...POINT_BUTTON,
                  color: color.textMuted,
                  fontSize: font.caption,
                }}
              >
                {entry.points.length} 件の変更
              </button>
            </Row>
            {open &&
              entry.points.map((point) => {
                const candidate: TimelineSelection = {
                  kind: 'change',
                  point,
                  lane: lane.branchId,
                };
                return [
                  <Row
                    key={point.batch.id}
                    emphasized={emphasized}
                    dot={<Dot size={CHANGE_DOT} filled={false} />}
                  >
                    <PointButton
                      pressed={isSelected(selected, candidate)}
                      onClick={() => onSelect(candidate)}
                    >
                      <span style={{ fontSize: font.caption }}>
                        {formatTime(point.batch.timestamp)}{' '}
                        {labelOfActor(point.batch.actor)}
                      </span>
                    </PointButton>
                  </Row>,
                  detailOf(candidate, point.batch.id),
                ];
              })}
          </ul>
        </li>
      );
    }
    const candidate: TimelineSelection = {
      kind: 'operation',
      point: entry.point,
      lane: lane.branchId,
    };
    const label = operationLabel(entry.point);
    const rowKey = `op-${index}`;
    const row = (
      <Row
        key={rowKey}
        emphasized={emphasized}
        dot={<Dot size={OPERATION_DOT} filled={false} />}
      >
        <PointButton
          pressed={isSelected(selected, candidate)}
          onClick={() => onSelect(candidate)}
          title={label}
        >
          {label}
        </PointButton>
      </Row>
    );
    const detail = detailOf(candidate, rowKey);
    // 分岐の点の直下に、その branch の線を字下げして出す
    if (entry.point.kind === 'branch') {
      const branchLane = laneById.get(entry.point.branch.id);
      if (branchLane) {
        placed.add(branchLane.branchId);
        return (
          <li key={`branch-${index}`} style={{ listStyle: 'none' }}>
            <ul style={{ margin: 0, padding: 0 }}>
              {row}
              {detail}
              <li style={{ listStyle: 'none', paddingLeft: INDENT }}>
                {renderLane(branchLane)}
              </li>
            </ul>
          </li>
        );
      }
    }
    return [row, detail];
  };

  const renderLane = (lane: TimelineLane): ReactNode => (
    <section aria-label={`${lane.name} の線`}>
      <div
        style={{
          fontSize: font.caption,
          fontWeight: lane.branchId === currentLane ? 'bold' : 'normal',
          color: lane.branchId === currentLane ? color.text : color.textMuted,
          padding: '2px 0',
        }}
      >
        {lane.name}
        {lane.status === 'merged' && ' (merged)'}
      </div>
      <ul style={{ margin: 0, padding: 0 }}>
        {lane.entries.map((entry, i) => renderEntry(entry, lane, i))}
      </ul>
    </section>
  );

  const trunk = laneById.get(null);
  placed.add(null);
  const body = trunk ? renderLane(trunk) : null;
  // 分岐の点が見えなかった branch (分岐が別のシートなど) は最後に並べる
  const rest = lanes.filter((l) => !placed.has(l.branchId));
  return (
    <section aria-label="version tree">
      {body}
      {rest.map((lane) => (
        <div key={lane.branchId ?? 'trunk'} style={{ paddingLeft: INDENT }}>
          {renderLane(lane)}
        </div>
      ))}
    </section>
  );
}
