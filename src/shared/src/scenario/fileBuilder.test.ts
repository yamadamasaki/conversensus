import { describe, expect, test } from 'bun:test';
import { IMAGE_PROPERTY_KEY } from '../blob';
import {
  DERIVED_FROM_SHEET_PROPERTY,
  derivedNodeIdOf,
  GRAPH_NODE_LABEL,
} from '../events/derivedNode';
import { projectFile } from '../events/project';
import { METAGRAPH_SHEET_KIND, sheetKindOf } from '../events/sheetKind';
import { ConversensusFileSchema, type GraphFile } from '../schemas';
import { BunSqliteDriver, IN_MEMORY } from '../store/bunSqliteDriver';
import { EventStore } from '../store/eventStore';
import { LocalStore } from '../store/localStore';
import { FileBuilder } from './fileBuilder';

const COVER = {
  cid: 'bafkreibm6jg3ux5qumhcn2b3flc3tyu6dmlb4xa7u5bf44yegnrjhc4yeq',
  mimeType: 'image/png',
  data: 'AQID',
  size: 3,
};

/** 小さな場面: 2 枚の Sheet と index。index には graph node を置き、メモから edge を張る */
function scene() {
  const file = new FileBuilder('『自由論』を読む');
  const ch1 = file.sheet('第 1 章');
  const claim = ch1.note('他者への危害を防ぐ場合を除き, 干渉してはならない', {
    at: { x: 0, y: 0 },
    label: '主張',
    properties: { 頁: 22 },
  });
  const cover = ch1.image(COVER, { at: { x: 300, y: 0 } });
  ch1.connect(claim, cover, '出典');
  const ch2 = file.sheet('第 2 章');
  const index = file.metagraph('index');
  const g1 = index.placeGraphNode(ch1, { x: 0, y: 0 });
  const g2 = index.placeGraphNode(ch2, { x: 300, y: 0 });
  const memo = index.note('第 2 章は第 1 章の応用', { at: { x: 150, y: 150 } });
  index.connect(memo, g1);
  index.connect(memo, g2);
  return { file, ch1, ch2, index };
}

/** import して、op-log から畳み込んだ姿を返す (画面が見るのと同じもの) */
function importAndProject(built: unknown): GraphFile {
  const store = new LocalStore(new EventStore(new BunSqliteDriver(IN_MEMORY)));
  const result = store.importFile(built);
  if (!result.ok) throw new Error(`取り込めなかった: ${result.error}`);
  return projectFile(store.getBatches(result.file.id), result.file.id);
}

const sheetNamed = (file: GraphFile, name: string) => {
  const sheet = file.sheets.find((s) => s.name === name);
  if (!sheet) throw new Error(`Sheet が無い: ${name}`);
  return sheet;
};

describe('FileBuilder', () => {
  test('.conversensus の形をしている (import の入口と同じ schema を通る)', () => {
    expect(ConversensusFileSchema.safeParse(scene().file.build()).success).toBe(
      true,
    );
  });

  test('同じ場面からは同じものができる (撮り直しても差分が出ない)', () => {
    expect(JSON.stringify(scene().file.build())).toBe(
      JSON.stringify(scene().file.build()),
    );
  });

  test('同じ名前の Sheet は足せない (id が名前から決まるので、ぶつかる)', () => {
    const file = new FileBuilder('f');
    file.sheet('a');
    expect(() => file.sheet('a')).toThrow();
  });

  test('import すると、書いたとおりの node・label・property・edge・置き場所になる', () => {
    const ch1 = sheetNamed(importAndProject(scene().file.build()), '第 1 章');
    const claim = ch1.nodes.find((n) => n.label === '主張');
    const cover = ch1.nodes.find((n) => n.nodeType === 'image');

    expect(claim?.content).toBe(
      '他者への危害を防ぐ場合を除き, 干渉してはならない',
    );
    expect(claim?.properties).toEqual({ 頁: 22 });
    expect(ch1.edges).toEqual([
      expect.objectContaining({
        source: claim?.id,
        target: cover?.id,
        label: '出典',
      }),
    ]);
    expect(ch1.layouts?.find((l) => l.nodeId === cover?.id)).toMatchObject({
      x: 300,
      y: 0,
    });
  });

  test('画像は実体ごと同梱され、node は同じ cid を指す', () => {
    const built = scene().file.build();
    expect(built.blobs?.map((b) => b.cid)).toEqual([COVER.cid]);
    const cover = sheetNamed(importAndProject(built), '第 1 章').nodes.find(
      (n) => n.nodeType === 'image',
    );
    expect(cover?.properties?.[IMAGE_PROPERTY_KEY]).toMatchObject({
      ref: { $link: COVER.cid },
    });
  });

  test('🔴 metagraph に置いた graph node は、import した先の Sheet の graph node になる', () => {
    // graph node は保存せず導出する。置き場所と edge が新しい Sheet の graph node に付かなければ、
    // index の図が崩れる (import が id を振り直すため)
    const imported = importAndProject(scene().file.build());
    const index = sheetNamed(imported, 'index');
    const g1 = derivedNodeIdOf(sheetNamed(imported, '第 1 章').id);
    const g2 = derivedNodeIdOf(sheetNamed(imported, '第 2 章').id);

    expect(sheetKindOf(index)).toBe(METAGRAPH_SHEET_KIND);
    const graphNodes = index.nodes.filter(
      (n) => n.properties?.[DERIVED_FROM_SHEET_PROPERTY] !== undefined,
    );
    // 第 1 章・第 2 章・index 自身の 3 つ。どれも label は graph
    expect(graphNodes).toHaveLength(3);
    expect(graphNodes.every((n) => n.label === GRAPH_NODE_LABEL)).toBe(true);
    expect(index.edges.map((e) => e.target).sort()).toEqual([g1, g2].sort());
    expect(index.layouts?.find((l) => l.nodeId === g2)).toMatchObject({
      x: 300,
      y: 0,
    });
  });
});
