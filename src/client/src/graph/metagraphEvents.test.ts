import { describe, expect, test } from 'bun:test';
import type { EdgeId, NodeId, SheetId } from '@conversensus/shared';
import { type GraphEvent, makeEventBase } from '../events/GraphEvent';
import { splitMetagraphEvent } from './metagraphEvents';

const GRAPH_NODE = 'g1' as NodeId;
const PLAIN = 'p1' as NodeId;
const SHEET = 's1' as SheetId;
const sheetOf = (id: NodeId) => (id === GRAPH_NODE ? SHEET : undefined);

const deleted = (nodeIds: NodeId[], edgeIds: EdgeId[] = []): GraphEvent => ({
  ...makeEventBase('structure'),
  type: 'NODES_DELETED',
  nodeIds,
  edgeIds,
  nodes: nodeIds.map((id) => ({ id, content: '' })),
  layouts: nodeIds.map((nodeId) => ({ nodeId, x: 0, y: 0 })),
  edges: [],
  edgeLayouts: [],
});

describe('splitMetagraphEvent', () => {
  test('graph node の削除はシートの削除になり、ふつうの node の削除は残る', () => {
    const { rest, intents } = splitMetagraphEvent(
      deleted([GRAPH_NODE, PLAIN]),
      sheetOf,
    );
    expect(intents).toEqual([{ kind: 'removeSheet', sheetId: SHEET }]);
    expect(rest?.type === 'NODES_DELETED' && rest.nodeIds).toEqual([PLAIN]);
    expect(
      rest?.type === 'NODES_DELETED' && rest.nodes.map((n) => n.id),
    ).toEqual([PLAIN]);
    expect(
      rest?.type === 'NODES_DELETED' && rest.layouts.map((l) => l.nodeId),
    ).toEqual([PLAIN]);
  });

  test('graph node だけの削除は、残りが無い (dispatch しない)。edge が一緒なら edge は残る', () => {
    expect(splitMetagraphEvent(deleted([GRAPH_NODE]), sheetOf).rest).toBeNull();
    const withEdge = splitMetagraphEvent(
      deleted([GRAPH_NODE], ['e1' as EdgeId]),
      sheetOf,
    ).rest;
    expect(withEdge?.type === 'NODES_DELETED' && withEdge.edgeIds).toEqual([
      'e1' as EdgeId,
    ]);
  });

  test('graph node の本文の書き換えはシートの名前の変更になる。空の名前にはしない', () => {
    const changed = (to: string): GraphEvent => ({
      ...makeEventBase('content'),
      type: 'NODE_CONTENT_CHANGED',
      nodeId: GRAPH_NODE,
      from: '一',
      to,
    });
    expect(splitMetagraphEvent(changed(' 改名 '), sheetOf)).toEqual({
      rest: null,
      intents: [{ kind: 'renameSheet', sheetId: SHEET, name: '改名' }],
    });
    expect(splitMetagraphEvent(changed('  '), sheetOf)).toEqual({
      rest: null,
      intents: [],
    });
  });

  test('graph node の label・プロパティの変更は捨てる。ふつうの node の操作はそのまま', () => {
    const relabel = (nodeId: NodeId): GraphEvent => ({
      ...makeEventBase('content'),
      type: 'NODE_LABEL_CHANGED',
      nodeId,
      from: '',
      to: 'x',
    });
    expect(splitMetagraphEvent(relabel(GRAPH_NODE), sheetOf)).toEqual({
      rest: null,
      intents: [],
    });
    const plain = relabel(PLAIN);
    expect(splitMetagraphEvent(plain, sheetOf)).toEqual({
      rest: plain,
      intents: [],
    });
  });
});
