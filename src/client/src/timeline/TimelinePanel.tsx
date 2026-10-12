/**
 * timeline view の pane (#73, 計画 T3〜T5)。右サイドバーの「timeline」で出す (Q1)
 *
 * version tree の、押した点の直下に inspector を出す (出すのは 1 つ)。inspector は選んだ点の種類で
 * 2 つに分かれる (仕様)。
 *
 * - **operation inspector** (branch・commit・merge): 種類・コメント・actor・時刻・関係する node/edge
 * - **change inspector** (batch): op の一覧 (種類と内容)・actor・時刻・関係する node/edge
 *
 * どちらも「その時点のグラフ」を新しいタブで見るだけで開ける (Q3)。開いている間はボタンが
 * 「元のグラフに戻る」になり、押すとその時点のタブを閉じて開く前のタブへ戻る。change inspector から要素を
 * 押すと、その要素を強調して開く。要素の名前は**その時点の姿**から引く (消えた要素も名前が出る)
 */

import {
  addressKey,
  type BranchId,
  type Did,
  didFromActor,
  type FileId,
  type GraphViewAddress,
  HEAD_CUT,
  type Sheet,
  type SheetId,
  type VersionVector,
} from '@conversensus/shared';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { handleLabels } from '../atproto/identity';
import type { LabelResolver } from '../display/labelCache';
import type { PropertyTarget } from '../graph/editorControls';
import { usePaneSheet } from '../hooks/usePaneSheet';
import { messages, useMessages } from '../i18n/messages';
import { color, font, radius } from '../theme';
import { Button } from '../ui/Button';
import {
  type ElementIds,
  type TimelineFocus,
  type TimelineLane,
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
  /** アドレスを新しいタブで開く (その時点のグラフ, Q3) */
  onOpen: (address: GraphViewAddress) => void;
  /** いま見ている過去の時点のタブのアドレス。最新を見ていれば null */
  viewing: GraphViewAddress | null;
  /** 開いた時点のタブを閉じて、開く前のタブへ戻る */
  onReturn: () => void;
  /** DID を handle にする。既定は `handleLabels` (テストで差し替える) */
  resolveHandles?: (dids: readonly Did[]) => Promise<LabelResolver<Did>>;
};

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
    if (!node) return messages().timeline.missingElement;
    return node.content.trim() || messages().timeline.unnamedElement;
  }
  const edge = sheet.edges.find((e) => e.id === id);
  if (!edge) return messages().timeline.missingElement;
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
  const t = useMessages();
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
                title={t.timeline.openWithHighlight}
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

/**
 * 「その時点のグラフを開く」と「元のグラフに戻る」を 1 つのボタンで切り替える (利用者の指摘 2026-10-12:
 * 開いた後でどのタブに戻ればよいか分からなくなる)。この点の時点を見ている間は「戻る」になる
 */
function ViewButton({
  address,
  viewing,
  onOpen,
  onReturn,
  disabled = false,
}: {
  address: GraphViewAddress;
  viewing: GraphViewAddress | null;
  onOpen: (address: GraphViewAddress) => void;
  onReturn: () => void;
  disabled?: boolean;
}) {
  const t = useMessages();
  const showing =
    viewing !== null && addressKey(viewing) === addressKey(address);
  return (
    <div style={{ marginTop: 8 }}>
      {showing ? (
        <Button variant="primary" onClick={onReturn}>
          {t.timeline.returnToOrigin}
        </Button>
      ) : (
        <Button
          variant="secondary"
          disabled={disabled}
          onClick={() => onOpen(address)}
        >
          {t.timeline.openPast}
        </Button>
      )}
    </div>
  );
}

function Inspector({
  selection,
  place,
  labelOfActor,
  onOpen,
  viewing,
  onReturn,
}: {
  selection: TimelineSelection;
  place: Place;
  labelOfActor: (actor: string) => string;
  onOpen: (address: GraphViewAddress) => void;
  viewing: GraphViewAddress | null;
  onReturn: () => void;
}) {
  const t = useMessages();
  // 押した点の直下に出すので、木の行と見分けられるよう囲む
  const box = {
    border: `1px solid ${color.border}`,
    borderRadius: radius.sm,
    background: color.bgSubtle,
    padding: 8,
  } as const;
  if (selection.kind === 'operation') {
    const { point, lane } = selection;
    const commit = point.kind === 'branch' ? point.branch.base : point.commit;
    const address = addressAt(place, lane, point.cut);
    return (
      <section aria-label={t.timeline.operationInspector} style={box}>
        <h4 style={{ margin: '0 0 6px', fontSize: font.body }}>
          {t.timeline.operationInspector}
        </h4>
        <dl style={FIELD_LIST}>
          <Field name={t.timeline.fields.kind}>
            {t.timeline.operationKinds[point.kind]}
          </Field>
          <Field name={t.timeline.fields.comment}>
            {point.kind === 'branch'
              ? operationLabel(point)
              : commit.message || '—'}
          </Field>
          <Field name={t.timeline.fields.actor}>
            {labelOfActor(commit.authorActor)}
          </Field>
          <Field name={t.timeline.fields.time}>
            {point.timestamp !== null ? formatTime(point.timestamp) : '—'}
          </Field>
        </dl>
        <h5 style={SECTION_HEADING}>{t.timeline.related}</h5>
        <ElementList elements={point.touched} address={address} />
        <ViewButton
          address={address}
          viewing={viewing}
          onOpen={onOpen}
          onReturn={onReturn}
          disabled={point.cut === null}
        />
      </section>
    );
  }
  const { point, lane } = selection;
  const { batch } = point;
  const address = addressAt(place, lane, point.cut);
  return (
    <section aria-label={t.timeline.changeInspector} style={box}>
      <h4 style={{ margin: '0 0 6px', fontSize: font.body }}>
        {t.timeline.changeInspector}
      </h4>
      <dl style={FIELD_LIST}>
        <Field name={t.timeline.fields.actor}>
          {labelOfActor(batch.actor)}
        </Field>
        <Field name={t.timeline.fields.time}>
          {formatTime(batch.timestamp)}
        </Field>
      </dl>
      <h5 style={SECTION_HEADING}>{t.timeline.ops}</h5>
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
      <h5 style={SECTION_HEADING}>{t.timeline.related}</h5>
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
      <ViewButton
        address={address}
        viewing={viewing}
        onOpen={onOpen}
        onReturn={onReturn}
      />
    </section>
  );
}

/** 選んだ点の同一性 */
function selectionKey(selection: TimelineSelection): string {
  if (selection.kind === 'change') return `change:${selection.point.batch.id}`;
  const { point } = selection;
  return point.kind === 'branch'
    ? `branch:${point.branch.id}`
    : `commit:${point.commit.id}`;
}

const DID_PREFIX = 'did:';

function isDid(value: string): value is Did {
  return value.startsWith(DID_PREFIX);
}

/** 木に出る actor の DID (重ねず、順を揃える) */
function actorDids(lanes: readonly TimelineLane[]): string[] {
  const dids = new Set<string>();
  const add = (actor: string) => {
    const did = didFromActor(actor);
    if (isDid(did)) dids.add(did);
  };
  for (const lane of lanes) {
    for (const entry of lane.entries) {
      if (entry.kind === 'changes') {
        for (const p of entry.points) add(p.batch.actor);
      } else {
        const p = entry.point;
        add(
          p.kind === 'branch'
            ? p.branch.base.authorActor
            : p.commit.authorActor,
        );
      }
    }
  }
  return [...dids].sort();
}

export function TimelinePanel({
  place,
  currentLane,
  focus,
  onOpen,
  viewing,
  onReturn,
  resolveHandles = (dids) => handleLabels.resolve(dids),
}: Props) {
  const t = useMessages();
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
  /** 同じ点をもう一度押したら閉じる (出す inspector は 1 つ) */
  const select = (next: TimelineSelection) =>
    setSelected((current) =>
      current && selectionKey(current) === selectionKey(next) ? null : next,
    );

  // actor の DID を handle にする (利用者の指摘 2026-10-12)。名簿は共有の File にしか無いので、
  // 名簿ではなく handle の解決 (`handleLabels`) で引く。未ログインの actor (`local`) は引かない
  const [handleOf, setHandleOf] = useState<LabelResolver<Did>>(
    () => handleLabels.peek,
  );
  const lanes = state.kind === 'ready' ? state.lanes : null;
  const didsKey = lanes ? actorDids(lanes).join(',') : '';
  // biome-ignore lint/correctness/useExhaustiveDependencies: 出ている DID の集まり (didsKey) が変わったときだけ引く
  useEffect(() => {
    if (!didsKey) return;
    let cancelled = false;
    resolveHandles(didsKey.split(',') as Did[])
      .then((resolver) => {
        if (!cancelled) setHandleOf(() => resolver);
      })
      .catch((error) =>
        console.warn('[timeline] handle を引けなかった:', error),
      );
    return () => {
      cancelled = true;
    };
  }, [didsKey]);
  const labelOfActor = (actor: string) => {
    const did = didFromActor(actor);
    return isDid(did) ? handleOf(did) : did;
  };
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
        {t.timeline.noGraph}
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
          {t.timeline.focused(focus.title)}
        </p>
      )}
      <div style={{ padding: '0 12px 8px' }}>
        {state.kind === 'loading' ? (
          <p style={{ margin: 0, fontSize: font.body, color: color.textMuted }}>
            {t.timeline.loading}
          </p>
        ) : (
          <VersionTree
            lanes={state.lanes}
            currentLane={currentLane}
            selected={selected}
            onSelect={select}
            labelOfActor={labelOfActor}
            renderDetail={(selection) => (
              <Inspector
                selection={selection}
                place={place}
                labelOfActor={labelOfActor}
                onOpen={onOpen}
                viewing={viewing}
                onReturn={onReturn}
              />
            )}
          />
        )}
      </div>
    </div>
  );
}
