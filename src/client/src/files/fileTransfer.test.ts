import { describe, expect, it, mock } from 'bun:test';
import {
  CONVERSENSUS_FILE_VERSION,
  type ConversensusFile,
  type FileId,
  type GraphFile,
  type NodeId,
  parseConversensusFile,
  type SheetId,
} from '@conversensus/shared';
import {
  type ExportFileDeps,
  exportFile,
  type ImportFileDeps,
  importFile,
} from './fileTransfer';

const FILE = '22222222-2222-4222-8222-222222222222' as FileId;
const SHEET = '33333333-3333-4333-8333-333333333333' as SheetId;
// 書き出した JSON を実際の import と同じスキーマで読み直すので、id は UUID である必要がある
const NODE_1 = '44444444-4444-4444-8444-444444444444';
const NODE_2 = '55555555-5555-4555-8555-555555555555';
const CID = 'bafkreibm6jg3ux5qumhcn2b3flc3tyu6dmlb4xa7u5bf44yegnrjhc4yeq';
const OTHER_CID =
  'bafkreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const PNG = 'image/png';
/** 0x00 を含めるのは、base64 の往復で NUL が落ちないことを見るため */
const BYTES = [1, 0, 2, 255];
const BYTES_BASE64 = btoa(String.fromCharCode(...BYTES));
/** 長さで書き戻しの呼び出しを見分けるための別サイズ */
const THREE_BYTES_BASE64 = btoa(String.fromCharCode(1, 2, 3));

const imageProperties = (cid: string) => ({
  image: { $type: 'blob', ref: { $link: cid }, mimeType: PNG, size: 4 },
});

const fileWith = (
  nodes: { id: string; properties?: Record<string, unknown> }[],
): GraphFile => ({
  id: FILE,
  name: 'テスト',
  description: '',
  sheets: [
    {
      id: SHEET,
      name: 'Sheet 1',
      nodes: nodes.map((n) => ({
        id: n.id as NodeId,
        content: '',
        ...(n.properties ? { properties: n.properties } : {}),
      })),
      edges: [],
    },
  ],
});

/** download を記録する export deps。実体は常に BYTES を返す */
function exportDeps(overrides: Partial<ExportFileDeps> = {}) {
  const downloaded: { name: string; json: string }[] = [];
  const local = mock(
    async (_cid: string) =>
      new Blob([new Uint8Array(BYTES)], { type: PNG }) as Blob | undefined,
  );
  const deps: ExportFileDeps = {
    local,
    download: (name, json) => downloaded.push({ name, json }),
    ...overrides,
  };
  return { deps, downloaded, local };
}

/** 書き出された JSON を最新形式として読み直す (実際の import 経路と同じ解釈) */
function exported(json: string): ConversensusFile {
  const parsed = parseConversensusFile(JSON.parse(json));
  if (!parsed.success) throw new Error('exported file did not parse');
  return parsed.data;
}

function importDeps(overrides: Partial<ImportFileDeps> = {}) {
  const calls: string[] = [];
  const stored: { bytes: Uint8Array; mimeType: string }[] = [];
  const deps: ImportFileDeps = {
    put: async (bytes, mimeType) => {
      calls.push(`put:${bytes.length}`);
      stored.push({ bytes, mimeType });
      return { cid: CID, mimeType, size: bytes.length };
    },
    post: async (data) => {
      calls.push('post');
      return { ...data, description: data.description ?? '' } as GraphFile;
    },
    ...overrides,
  };
  return { deps, calls, stored };
}

describe('exportFile', () => {
  it('参照されている画像の実体を base64 で同梱する', async () => {
    // 参照だけを書き出すと別端末で開いた瞬間に全画像が失われる (レビュー D1)
    const { deps, downloaded } = exportDeps();
    const summary = await exportFile(
      fileWith([{ id: NODE_1, properties: imageProperties(CID) }]),
      deps,
    );

    const file = exported(downloaded[0].json);
    expect(file.version).toBe(CONVERSENSUS_FILE_VERSION);
    expect(file.blobs).toEqual([
      { cid: CID, mimeType: PNG, data: BYTES_BASE64 },
    ]);
    expect(summary.missingBlobs).toEqual([]);
  });

  it('同じ画像を参照するノードが複数あっても 1 回だけ入れる', async () => {
    // 同じ実体を何度も base64 化するとファイルが無駄に膨らむ
    const { deps, downloaded, local } = exportDeps();
    await exportFile(
      fileWith([
        { id: NODE_1, properties: imageProperties(CID) },
        { id: NODE_2, properties: imageProperties(CID) },
      ]),
      deps,
    );

    expect(exported(downloaded[0].json).blobs).toHaveLength(1);
    expect(local).toHaveBeenCalledTimes(1);
  });

  it('実体がこの端末に無い画像は missingBlobs で返す (書き出しは成功させる)', async () => {
    // 他端末が作って一度も表示していない画像はローカルに無いのが普通。書き出し
    // そのものを失敗させる理由は無いが、黙って落とすと D1 の再発なので返す
    const { deps, downloaded } = exportDeps({ local: async () => undefined });
    const summary = await exportFile(
      fileWith([{ id: NODE_1, properties: imageProperties(CID) }]),
      deps,
    );

    expect(summary.missingBlobs).toEqual([CID]);
    expect(exported(downloaded[0].json).blobs).toBeUndefined();
  });

  it('画像を含まないファイルには blobs 欄を付けない', async () => {
    const { deps, downloaded, local } = exportDeps();
    await exportFile(fileWith([{ id: NODE_1 }]), deps);

    expect(exported(downloaded[0].json).blobs).toBeUndefined();
    expect(local).not.toHaveBeenCalled();
  });

  it('ファイル名の使えない文字を置き換える', async () => {
    const { deps, downloaded } = exportDeps();
    await exportFile({ ...fileWith([]), name: 'a/b:c*d' }, deps);

    expect(downloaded[0].name).toBe('a_b_c_d.conversensus');
  });
});

describe('importFile', () => {
  it('実体をローカルへ戻してからグラフを送る', async () => {
    // 逆順だと import 直後の描画で画像が解決できず「読み込めません」が出る
    const { deps, calls } = importDeps();
    await importFile(
      {
        ...fileWith([{ id: NODE_1, properties: imageProperties(CID) }]),
        version: CONVERSENSUS_FILE_VERSION,
        blobs: [{ cid: CID, mimeType: PNG, data: THREE_BYTES_BASE64 }],
      },
      deps,
    );

    expect(calls).toEqual(['put:3', 'post']);
  });

  it('base64 を 0x00 込みでバイト列に戻す', async () => {
    // TEXT 経路に落ちると NUL で切れ、壊れた画像が静かにできる (S2 の教訓)
    const { deps, stored } = importDeps();
    await importFile(
      {
        ...fileWith([]),
        version: CONVERSENSUS_FILE_VERSION,
        blobs: [
          {
            cid: CID,
            mimeType: PNG,
            data: BYTES_BASE64,
          },
        ],
      },
      deps,
    );

    expect(Array.from(stored[0].bytes)).toEqual(BYTES);
    expect(stored[0].mimeType).toBe(PNG);
  });

  it('blobs は server へ送らない (op-log に base64 を持ち込まない)', async () => {
    // これが ANA-116 でレコード上限に当たった原因そのもの
    let posted: unknown;
    const { deps } = importDeps({
      post: async (data) => {
        posted = data;
        return data as GraphFile;
      },
    });
    await importFile(
      {
        ...fileWith([]),
        version: CONVERSENSUS_FILE_VERSION,
        blobs: [{ cid: CID, mimeType: PNG, data: BYTES_BASE64 }],
      },
      deps,
    );

    expect(posted).not.toHaveProperty('blobs');
  });

  it('実体の書き戻しが失敗しても import は続ける', async () => {
    // その画像が表示できないだけで、グラフは読める方がよい
    const { deps, calls } = importDeps({
      put: async () => {
        throw new Error('daemon down');
      },
    });
    const file = await importFile(
      {
        ...fileWith([]),
        version: CONVERSENSUS_FILE_VERSION,
        blobs: [{ cid: CID, mimeType: PNG, data: BYTES_BASE64 }],
      },
      deps,
    );

    expect(calls).toEqual(['post']);
    expect(file.id).toBe(FILE);
  });

  it('cid が食い違っても投げない (警告して続ける)', async () => {
    // ファイルの cid と実体が合わない = そのノードの参照では引けない。content-addressed
    // なので入れた実体は別 cid で残るだけであり、import 全体を落とす理由にはならない
    const { deps } = importDeps({
      put: async (bytes, mimeType) => ({
        cid: OTHER_CID,
        mimeType,
        size: bytes.length,
      }),
    });

    await expect(
      importFile(
        {
          ...fileWith([]),
          version: CONVERSENSUS_FILE_VERSION,
          blobs: [{ cid: CID, mimeType: PNG, data: BYTES_BASE64 }],
        },
        deps,
      ),
    ).resolves.toBeDefined();
  });
});

describe('書き出し → 読み込みの往復', () => {
  it('別端末を模したストアでも画像の実体が戻る', async () => {
    // D1 の受入基準そのもの: 端末 A で export → 端末 B で import → 画像が出る
    const { deps: eDeps, downloaded } = exportDeps();
    await exportFile(
      fileWith([{ id: NODE_1, properties: imageProperties(CID) }]),
      eDeps,
    );

    // 端末 B: ローカル blob ストアは空
    const storeB = new Map<string, Uint8Array>();
    const file = exported(downloaded[0].json);
    await importFile(file, {
      put: async (bytes, mimeType) => {
        storeB.set(CID, bytes);
        return { cid: CID, mimeType, size: bytes.length };
      },
      post: async (data) => data as GraphFile,
    });

    expect(Array.from(storeB.get(CID) ?? [])).toEqual(BYTES);
  });
});
