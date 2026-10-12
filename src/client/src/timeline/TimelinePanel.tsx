/**
 * timeline view の pane (#73, 計画 T3〜T5)。右サイドバーの「timeline」で出す (Q1)
 *
 * 上に version tree、下に inspector。inspector は選んだ点の種類で 2 つに分かれる (仕様)。
 *
 * - **operation inspector** (branch・commit・merge): 種類・コメント・actor・時刻・関係する node/edge
 * - **change inspector** (batch): op の一覧 (種類と内容)・actor・時刻・関係する node/edge
 *
 * どちらも「その時点のグラフ」を新しいタブで見るだけで開ける (Q3)。change inspector から要素を
 * 押すと、その要素を強調して開く。要素の名前は**その時点の姿**から引く (消えた要素も名前が出る)
 */

import {
  type BranchId,
  type FileId,
  type GraphViewAddress,
  HEAD_CUT,
  type Sheet,
  type SheetId,
  type VersionVector,
} from '@conversensus/shared';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import type { PropertyTarget } from '../graph/editorControls';
import { usePaneSheet } from '../hooks/usePaneSheet';
import { color, font, radius } from '../theme';
import { Button } from '../ui/Button';
import {
  type ElementIds,
  type TimelineFocus,
  touchedElements as touchedOf,
} from './buildTimeline';
import { opDetail, opKindLabel } from './describeOp';
import { useTimeline } from './useTimeline';
import {
  formatTime,
  operationLabel,
  type TimelineSelection,
  VersionTree,
} from './VersionTree';

type Place = { fileId: FileId; sheetId: SheetId };

type Props = {
  /** いま見ているシート。何も開いていなければ null */
  place: Place | null;
  /** 見ている線。trunk は null */
  currentLane: BranchId | null;
  /** 選んでいる要素。あれば、それに触れた change point だけを出す (仕様) */
  focus: PropertyTarget | undefined;
  labelOfActor: (actor: string) => string;
  /** アドレスを新しいタブで開く (その時点のグラフ, Q3) */
  onOpen: (address: GraphViewAddress) => void;
};

const OPERATION_KIND_LABELS = {
  branch: 'branch の作成',
  commit: 'commit',
  merge: 'merge',
} as const;

const NO_ELEMENT_NAME = '(名前の無い要素)';
const MISSING_ELEMENT_NAME = '(その時点には無い要素)';

const SECTION_HEADING = {
  margin: '8px 0 4px',
  fontSize: font.caption,
  color: color.textMuted,
  fontWeight: 'normal',
} as const;

const FIELD_LIST = {
  margin: 0,
  display: 'grid',
  gridTemplateColumns: 'auto 1fr',
  gap: '2px 8px',
  fontSize: font.body,
} as const;

function Field({ name, children }: { name: string; children: ReactNode }) {
  return (
    <>
      <dt style={{ color: color.textMuted }}>{name}</dt>
      <dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{children}</dd>
    </>
  );
}

/** 要素の名前。node は本文、edge は名前か「元 → 先」 */
function elementName(sheet: Sheet | null, kind: 'node' | 'edge', id: string) {
  if (!sheet) return '';
  if (kind === 'node') {
    const node = sheet.nodes.find((n) => n.id === id);
    if (!node) return MISSING_ELEMENT_NAME;
    return node.content.trim() || NO_ELEMENT_NAME;
  }
  const edge = sheet.edges.find((e) => e.id === id);
  if (!edge) return MISSING_ELEMENT_NAME;
  if (edge.label?.trim()) return edge.label;
  const end = (nodeId: string) =>
    sheet.nodes.find((n) => n.id === nodeId)?.content.trim() || '?';
  return `${end(edge.source)} → ${end(edge.target)}`;
}

/** その時点の姿から名前を引いて並べる。押せば、その要素を強調してその時点を開く */
function ElementList({
  elements,
  address,
  onPick,
}: {
  elements: ElementIds;
  address: GraphViewAddress;
  onPick?: (kind: 'node' | 'edge', id: string) => void;
}) {
  const state = usePaneSheet(address);
  const sheet = state.kind === 'sheet' ? state.sheet : null;
  const items = [
    ...[...elements.nodeIds].map((id) => ({ kind: 'node' as const, id })),
    ...[...elements.edgeIds].map((id) => ({ kind: 'edge' as const, id })),
  ];
  if (items.length === 0)
    return <p style={{ margin: 0, fontSize: font.body }}>—</p>;
  return (
    <ul style={{ margin: 0, paddingLeft: 16, fontSize: font.body }}>
      {items.map(({ kind, id }) => {
        const name = `${kind} ${elementName(sheet, kind, id)}`;
        return (
          <li key={`${kind}:${id}`}>
            {onPick ? (
              <button
                type="button"
                onClick={() => onPick(kind, id)}
                title="この要素を強調して、その時点のグラフを開く"
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  color: color.primary,
                  textAlign: 'left',
                  fontSize: font.body,
                }}
              >
                {name}
              </button>
            ) : (
              name
            )}
          </li>
        );
      })}
    </ul>
  );
}

function addressAt(
  place: Place,
  lane: BranchId | null,
  cut: VersionVector | null,
  highlight?: GraphViewAddress['highlight'],
): GraphViewAddress {
  return {
    fileId: place.fileId,
    sheetId: place.sheetId,
    branchId: lane,
    cut: cut ?? HEAD_CUT,
    ...(highlight && { highlight }),
  };
}

function Inspector({
  selection,
  place,
  labelOfActor,
  onOpen,
}: {
  selection: TimelineSelection;
  place: Place;
  labelOfActor: (actor: string) => string;
  onOpen: (address: GraphViewAddress) => void;
}) {
  const box = {
    borderTop: `1px solid ${color.border}`,
    padding: '8px 12px',
  } as const;
  if (selection.kind === 'operation') {
    const { point, lane } = selection;
    const commit = point.kind === 'branch' ? point.branch.base : point.commit;
    const address = addressAt(place, lane, point.cut);
    return (
      <section aria-label="operation inspector" style={box}>
        <h4 style={{ margin: '0 0 6px', fontSize: font.body }}>
          operation inspector
        </h4>
        <dl style={FIELD_LIST}>
          <Field name="種類">{OPERATION_KIND_LABELS[point.kind]}</Field>
          <Field name="コメント">
            {point.kind === 'branch'
              ? operationLabel(point)
              : commit.message || '—'}
          </Field>
          <Field name="actor">{labelOfActor(commit.authorActor)}</Field>
          <Field name="時刻">
            {point.timestamp !== null ? formatTime(point.timestamp) : '—'}
          </Field>
        </dl>
        <h5 style={SECTION_HEADING}>関係する node/edge</h5>
        <ElementList elements={point.touched} address={address} />
        <div style={{ marginTop: 8 }}>
          <Button
            variant="secondary"
            disabled={point.cut === null}
            onClick={() => onOpen(address)}
          >
            その時点のグラフを開く
          </Button>
        </div>
      </section>
    );
  }
  const { point, lane } = selection;
  const { batch } = point;
  const address = addressAt(place, lane, point.cut);
  return (
    <section aria-label="change inspector" style={box}>
      <h4 style={{ margin: '0 0 6px', fontSize: font.body }}>
        change inspector
      </h4>
      <dl style={FIELD_LIST}>
        <Field name="actor">{labelOfActor(batch.actor)}</Field>
        <Field name="時刻">{formatTime(batch.timestamp)}</Field>
      </dl>
      <h5 style={SECTION_HEADING}>op</h5>
      <ul
        style={{
          margin: 0,
          paddingLeft: 16,
          fontSize: font.body,
          maxHeight: 160,
          overflowY: 'auto',
        }}
      >
        {batch.ops.map((op, i) => {
          const detail = opDetail(op);
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: batch の中の op は位置が識別子
            <li key={i}>
              {opKindLabel(op)}
              {detail && (
                <span style={{ color: color.textMuted }}> 「{detail}」</span>
              )}
            </li>
          );
        })}
      </ul>
      <h5 style={SECTION_HEADING}>関係する node/edge</h5>
      <ElementList
        elements={touchedOf(batch)}
        address={address}
        onPick={(kind, id) =>
          onOpen(
            addressAt(place, lane, point.cut, {
              nodeIds: kind === 'node' ? [id as never] : [],
              edgeIds: kind === 'edge' ? [id as never] : [],
            }),
          )
        }
      />
      <div style={{ marginTop: 8 }}>
        <Button variant="secondary" onClick={() => onOpen(address)}>
          その時点のグラフを開く
        </Button>
      </div>
    </section>
  );
}

export function TimelinePanel({
  place,
  currentLane,
  focus,
  labelOfActor,
  onOpen,
}: Props) {
  const focusKey = focus ? `${focus.kind}:${focus.id}` : '';
  // biome-ignore lint/correctness/useExhaustiveDependencies: 選んだ要素の同一性 (focusKey) が変わったときだけ組み直す
  const timelineFocus = useMemo<TimelineFocus | undefined>(
    () =>
      focus
        ? {
            nodeIds: new Set(focus.kind === 'node' ? [focus.id] : []),
            edgeIds: new Set(focus.kind === 'edge' ? [focus.id] : []),
          }
        : undefined,
    [focusKey],
  );
  const state = useTimeline(place, timelineFocus);
  const [selected, setSelected] = useState<TimelineSelection | null>(null);
  const placeKey = place ? `${place.fileId}/${place.sheetId}` : '';
  // biome-ignore lint/correctness/useExhaustiveDependencies: 別のシートへ移ったら選んだ点を捨てる
  useEffect(() => setSelected(null), [placeKey]);

  if (!place)
    return (
      <p
        style={{
          margin: 0,
          padding: '0 12px',
          fontSize: font.body,
          color: color.textMuted,
        }}
      >
        グラフを開くと、その履歴が出ます
      </p>
    );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {focus && (
        <p
          style={{
            margin: '0 12px 6px',
            padding: '2px 6px',
            fontSize: font.caption,
            color: color.textMuted,
            background: color.bgSubtle,
            borderRadius: radius.sm,
          }}
        >
          「{focus.title}」に関わる変更だけを出しています
        </p>
      )}
      <div style={{ padding: '0 12px 8px' }}>
        {state.kind === 'loading' ? (
          <p style={{ margin: 0, fontSize: font.body, color: color.textMuted }}>
            読み込み中…
          </p>
        ) : (
          <VersionTree
            lanes={state.lanes}
            currentLane={currentLane}
            selected={selected}
            onSelect={setSelected}
            labelOfActor={labelOfActor}
          />
        )}
      </div>
      {selected && (
        <Inspector
          selection={selected}
          place={place}
          labelOfActor={labelOfActor}
          onOpen={onOpen}
        />
      )}
    </div>
  );
}
