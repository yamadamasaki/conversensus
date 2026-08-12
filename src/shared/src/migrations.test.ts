import { describe, expect, it } from 'bun:test';
import { parseConversensusFile } from './migrations';
import { CONVERSENSUS_FILE_VERSION } from './schemas';

const FILE = '22222222-2222-4222-8222-222222222222';
const SHEET = '33333333-3333-4333-8333-333333333333';
const NODE = '44444444-4444-4444-8444-444444444444';
const CID = 'bafkreibm6jg3ux5qumhcn2b3flc3tyu6dmlb4xa7u5bf44yegnrjhc4yeq';

/** 版に依らない最小のグラフ (どの版のスキーマにも合う形にしてある) */
const graph = () => ({
  id: FILE,
  name: 'テスト',
  sheets: [
    {
      id: SHEET,
      name: 'Sheet 1',
      nodes: [{ id: NODE, content: 'ノード' }],
      edges: [],
    },
  ],
});

describe('parseConversensusFile', () => {
  it('最新版 (v5) はそのまま通し、同梱 blob を保つ', () => {
    const blobs = [{ cid: CID, mimeType: 'image/png', data: 'AQID' }];
    const parsed = parseConversensusFile({
      ...graph(),
      version: CONVERSENSUS_FILE_VERSION,
      blobs,
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.blobs).toEqual(blobs);
  });

  it('v4 を v5 に上げる (blobs は付けない)', () => {
    // v4 のファイルには実体が無い。空配列を付けると「同梱したが空」と区別できない
    const parsed = parseConversensusFile({ ...graph(), version: '4' });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.version).toBe(CONVERSENSUS_FILE_VERSION);
    expect(parsed.data.blobs).toBeUndefined();
  });

  it('v3 を辿って v5 にする', () => {
    // 階段を 1 段だけ足したときに、その先が繋がっていないと旧ファイルが開けなくなる
    const parsed = parseConversensusFile({
      ...graph(),
      version: '3',
      sheets: [
        {
          ...graph().sheets[0],
          layouts: [{ nodeId: NODE, x: 1, y: 2, nodeType: 'group' }],
        },
      ],
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.version).toBe(CONVERSENSUS_FILE_VERSION);
    // v3→v4 の要点: nodeType がレイアウトからノードへ移る
    expect(parsed.data.sheets[0]?.nodes[0]?.nodeType).toBe('group');
    expect(parsed.data.sheets[0]?.layouts?.[0]).not.toHaveProperty('nodeType');
  });

  it('v1 を最後まで辿って v5 にする', () => {
    const parsed = parseConversensusFile({
      ...graph(),
      version: '1',
      sheets: [
        {
          ...graph().sheets[0],
          nodes: [{ id: NODE, content: 'ノード', style: { x: 1, y: 2 } }],
        },
      ],
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.version).toBe(CONVERSENSUS_FILE_VERSION);
    // v1→v2 の要点: style がレイアウトへ分離される
    expect(parsed.data.sheets[0]?.layouts?.[0]).toMatchObject({
      nodeId: NODE,
      x: 1,
      y: 2,
    });
  });

  it('どの版でもないものは失敗させ、最新スキーマのエラーを返す', () => {
    // 旧版として読めなかった理由を並べても助けにならない (ほとんどは単に壊れている)
    const parsed = parseConversensusFile({ ...graph(), version: '99' });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(JSON.stringify(parsed.error.errors)).toContain('version');
  });
});
