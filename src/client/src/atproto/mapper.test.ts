import { describe, expect, it } from 'bun:test';
import type {
  EdgeLayout,
  GraphEdge,
  GraphNode,
  NodeLayout,
} from '@conversensus/shared';
import {
  edgeLayoutToRecord,
  edgeToRecord,
  fileToRecord,
  nodeLayoutToRecord,
  nodeToRecord,
  recordToEdge,
  recordToEdgeLayout,
  recordToFileMeta,
  recordToNode,
  recordToNodeLayout,
  recordToSheetMeta,
  sheetToRecord,
} from './mapper';
import type { FileRecord, SheetRecord, StrongRef } from './types';

const DID = 'did:plc:test0000000000000000000';
const ref = (collection: string, rkey: string): StrongRef => ({
  uri: `at://${DID}/${collection}/${rkey}`,
  cid: `bafycid-${rkey}`,
});

const SHEET_REF = ref('app.conversensus.graph.sheet', 'sheet-uuid-0001');
const NOW = '2026-01-01T00:00:00.000Z';

// --- sheetToRecord / recordToSheetMeta ---

describe('sheetToRecord', () => {
  it('name と createdAt を含むレコードを返す', () => {
    const r = sheetToRecord({ name: 'テスト', description: 'desc' }, NOW);
    expect(r.name).toBe('テスト');
    expect(r.description).toBe('desc');
    expect(r.createdAt).toBe(NOW);
  });

  it('description が省略されたときフィールドが存在しない', () => {
    const r = sheetToRecord({ name: 'no-desc' }, NOW);
    expect('description' in r).toBe(false);
  });
});

describe('recordToSheetMeta', () => {
  it('rkey → SheetId に変換される', () => {
    const rkey = '11111111-1111-1111-1111-111111111111';
    const record: SheetRecord = {
      $type: 'app.conversensus.graph.sheet',
      name: 'S',
      createdAt: NOW,
    };
    const meta = recordToSheetMeta(rkey, record);
    expect(meta.id).toBe(rkey);
    expect(meta.name).toBe('S');
  });
});

// --- nodeToRecord / recordToNode ---

describe('nodeToRecord → recordToNode 往復', () => {
  const node: GraphNode = {
    id: '22222222-2222-2222-2222-222222222222' as GraphNode['id'],
    content: 'ノード内容',
    properties: { key: 'value' },
  };

  it('往復後に同じ内容になる', () => {
    const record = nodeToRecord(node, SHEET_REF, NOW);
    const restored = recordToNode(node.id, {
      $type: 'app.conversensus.graph.node',
      ...record,
    });
    expect(restored.id).toBe(node.id);
    expect(restored.content).toBe(node.content);
    expect(restored.properties).toEqual(node.properties);
  });

  it('properties が省略された場合 undefined になる', () => {
    const noProps: GraphNode = { id: node.id, content: 'no props' };
    const record = nodeToRecord(noProps, SHEET_REF, NOW);
    expect('properties' in record).toBe(false);
    const restored = recordToNode(noProps.id, {
      $type: 'app.conversensus.graph.node',
      ...record,
    });
    expect(restored.properties).toBeUndefined();
  });
});

// --- edgeToRecord / recordToEdge ---

describe('edgeToRecord → recordToEdge 往復', () => {
  const SOURCE_ID = '33333333-3333-3333-3333-333333333333';
  const TARGET_ID = '44444444-4444-4444-4444-444444444444';
  const SOURCE_REF = ref('app.conversensus.graph.node', SOURCE_ID);
  const TARGET_REF = ref('app.conversensus.graph.node', TARGET_ID);

  const edge: GraphEdge = {
    id: '55555555-5555-5555-5555-555555555555' as GraphEdge['id'],
    source: SOURCE_ID as GraphEdge['source'],
    target: TARGET_ID as GraphEdge['target'],
    label: '関係',
  };

  it('往復後に source/target UUID が復元される', () => {
    const record = edgeToRecord(edge, SHEET_REF, SOURCE_REF, TARGET_REF, NOW);
    const restored = recordToEdge(edge.id, {
      $type: 'app.conversensus.graph.edge',
      ...record,
    });
    expect(restored.id).toBe(edge.id);
    expect(restored.source).toBe(SOURCE_ID);
    expect(restored.target).toBe(TARGET_ID);
    expect(restored.label).toBe('関係');
  });
});

// --- nodeLayoutToRecord / recordToNodeLayout ---

describe('nodeLayoutToRecord → recordToNodeLayout 往復', () => {
  const NODE_ID = '66666666-6666-6666-6666-666666666666';
  const PARENT_ID = '77777777-7777-7777-7777-777777777777';
  const NODE_REF = ref('app.conversensus.graph.node', NODE_ID);
  const PARENT_REF = ref('app.conversensus.graph.node', PARENT_ID);

  it('座標・サイズが往復後に一致する', () => {
    const layout: NodeLayout = {
      nodeId: NODE_ID as NodeLayout['nodeId'],
      x: 100.4,
      y: 200.6,
      width: 300,
      height: 150,
    };
    const record = nodeLayoutToRecord(layout, NODE_REF, undefined, NOW);
    expect(record.x).toBe(100); // round
    expect(record.y).toBe(201); // round
    const restored = recordToNodeLayout(NODE_ID, {
      $type: 'app.conversensus.graph.nodeLayout',
      ...record,
    });
    expect(restored.nodeId).toBe(NODE_ID);
    expect(restored.x).toBe(100);
    expect(restored.y).toBe(201);
  });

  it('width が string のとき integer に変換される', () => {
    const layout: NodeLayout = {
      nodeId: NODE_ID as NodeLayout['nodeId'],
      width: '120',
    };
    const record = nodeLayoutToRecord(layout, NODE_REF, undefined, NOW);
    expect(record.width).toBe(120);
  });

  it('parentId ↔ parent.uri が正しく変換される', () => {
    const layout: NodeLayout = {
      nodeId: NODE_ID as NodeLayout['nodeId'],
      nodeType: 'group',
      parentId: PARENT_ID as NodeLayout['parentId'],
    };
    const record = nodeLayoutToRecord(layout, NODE_REF, PARENT_REF, NOW);
    expect(record.parent?.uri).toContain(PARENT_ID);
    const restored = recordToNodeLayout(NODE_ID, {
      $type: 'app.conversensus.graph.nodeLayout',
      ...record,
    });
    expect(restored.parentId).toBe(PARENT_ID);
    expect(restored.nodeType).toBe('group');
  });
});

// --- edgeLayoutToRecord / recordToEdgeLayout ---

describe('edgeLayoutToRecord → recordToEdgeLayout 往復', () => {
  const EDGE_ID = '88888888-8888-8888-8888-888888888888';
  const EDGE_REF = ref('app.conversensus.graph.edge', EDGE_ID);

  it('pathType と labelOffset が往復後に一致する', () => {
    const layout: EdgeLayout = {
      edgeId: EDGE_ID as EdgeLayout['edgeId'],
      pathType: 'bezier',
      labelOffsetX: 10.7,
      labelOffsetY: -5.3,
    };
    const record = edgeLayoutToRecord(layout, EDGE_REF, NOW);
    expect(record.labelOffsetX).toBe(11); // round
    expect(record.labelOffsetY).toBe(-5); // round
    const restored = recordToEdgeLayout(EDGE_ID, {
      $type: 'app.conversensus.graph.edgeLayout',
      ...record,
    });
    expect(restored.pathType).toBe('bezier');
    expect(restored.labelOffsetX).toBe(11);
    expect(restored.labelOffsetY).toBe(-5);
  });
});

// --- fileToRecord ---

describe('fileToRecord', () => {
  it('name と createdAt を含むレコードを返す', () => {
    const r = fileToRecord({ name: 'ファイル名' }, NOW);
    expect(r.name).toBe('ファイル名');
    expect(r.createdAt).toBe(NOW);
  });

  it('description が省略されたときフィールドが存在しない', () => {
    const r = fileToRecord({ name: 'no-desc' }, NOW);
    expect('description' in r).toBe(false);
  });

  it('description がある場合は含まれる', () => {
    const r = fileToRecord({ name: 'with-desc', description: '説明文' }, NOW);
    expect(r.description).toBe('説明文');
  });
});

// --- recordToFileMeta ---

describe('recordToFileMeta', () => {
  const FILE_RKEY = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

  it('rkey が FileId に変換される', () => {
    const record: FileRecord = {
      $type: 'app.conversensus.graph.file',
      name: 'F',
      createdAt: NOW,
    };
    const meta = recordToFileMeta(FILE_RKEY, record);
    expect(meta.id).toBe(FILE_RKEY);
  });

  it('name が正しくマッピングされる', () => {
    const record: FileRecord = {
      $type: 'app.conversensus.graph.file',
      name: 'ファイル',
      createdAt: NOW,
    };
    const meta = recordToFileMeta(FILE_RKEY, record);
    expect(meta.name).toBe('ファイル');
  });

  it('description がない場合は undefined になる', () => {
    const record: FileRecord = {
      $type: 'app.conversensus.graph.file',
      name: 'F',
      createdAt: NOW,
    };
    const meta = recordToFileMeta(FILE_RKEY, record);
    expect(meta.description).toBeUndefined();
  });

  it('description がある場合は正しくマッピングされる', () => {
    const record: FileRecord = {
      $type: 'app.conversensus.graph.file',
      name: 'F',
      description: 'ファイルの説明',
      createdAt: NOW,
    };
    const meta = recordToFileMeta(FILE_RKEY, record);
    expect(meta.description).toBe('ファイルの説明');
  });
});

// --- sheetToRecord (fileRef あり) ---

describe('sheetToRecord (fileRef パラメータ)', () => {
  const FILE_REF = ref(
    'app.conversensus.graph.file',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  );

  it('fileRef を渡すと file フィールドが含まれる', () => {
    const r = sheetToRecord({ name: 'シート' }, NOW, FILE_REF);
    expect(r.file).toEqual(FILE_REF);
  });

  it('fileRef を省略すると file フィールドが存在しない（後方互換）', () => {
    const r = sheetToRecord({ name: 'シート' }, NOW);
    expect('file' in r).toBe(false);
  });
});
