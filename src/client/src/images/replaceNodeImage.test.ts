import { describe, expect, it, mock } from 'bun:test';
import type { NodeId } from '@conversensus/shared';
import type { GraphEvent } from '../events/GraphEvent';
import type { ImageBlobRef } from './imageBlob';
import { replaceNodeImage } from './replaceNodeImage';

const CID = 'bafkreibm6jg3ux5qumhcn2b3flc3tyu6dmlb4xa7u5bf44yegnrjhc4yeq';
const PNG = 'image/png';
const NODE_ID = '11111111-1111-4111-8111-111111111111' as NodeId;

const NEW_REF: ImageBlobRef = {
  $type: 'blob',
  ref: { $link: CID },
  mimeType: PNG,
  size: 7,
};

/** 中身は使わない — `save` を差し込むので実体は読まれない */
const SOURCE = { type: PNG, size: 7 } as unknown as Blob;

function deps(save: () => Promise<ImageBlobRef>) {
  const dispatch = mock((_event: GraphEvent) => undefined);
  const reportError = mock((_message: string) => undefined);
  return { deps: { dispatch, reportError, save }, dispatch, reportError };
}

/** 成功する `save` */
const savesOk = () => async () => NEW_REF;

function propertiesChangedEvent(dispatch: ReturnType<typeof mock>) {
  expect(dispatch).toHaveBeenCalledTimes(1);
  const event = dispatch.mock.calls[0][0] as Extract<
    GraphEvent,
    { type: 'NODE_PROPERTIES_CHANGED' }
  >;
  expect(event.type).toBe('NODE_PROPERTIES_CHANGED');
  return event;
}

describe('replaceNodeImage', () => {
  it('保存した画像で properties を差し替える op を投げる', async () => {
    const { deps: d, dispatch, reportError } = deps(savesOk());

    await replaceNodeImage(NODE_ID, { caption: 'a' }, SOURCE, d);

    const event = propertiesChangedEvent(dispatch);
    expect(event.nodeId).toBe(NODE_ID);
    expect(reportError).not.toHaveBeenCalled();
  });

  it('to は置き換え後の全体 (画像以外の properties が残る)', async () => {
    // 差分を載せると projection (置換意味論) で他の properties が消える
    const { deps: d, dispatch } = deps(savesOk());

    await replaceNodeImage(
      NODE_ID,
      { caption: 'a', imageUrl: 'https://example.com/x.png' },
      SOURCE,
      d,
    );

    const { to } = propertiesChangedEvent(dispatch);
    expect(to).toEqual({
      caption: 'a',
      imageUrl: 'https://example.com/x.png',
      image: NEW_REF,
    });
  });

  it('from は差し替え前の全体 (undo で欠けない)', async () => {
    const before = { caption: 'a', image: { old: true } };
    const { deps: d, dispatch } = deps(savesOk());

    await replaceNodeImage(NODE_ID, before, SOURCE, d);

    const { from } = propertiesChangedEvent(dispatch);
    expect(from).toEqual(before);
  });

  it('properties を持たないノードでも投げられる', async () => {
    const { deps: d, dispatch } = deps(savesOk());

    await replaceNodeImage(NODE_ID, undefined, SOURCE, d);

    const { from, to } = propertiesChangedEvent(dispatch);
    expect(from).toEqual({});
    expect(to).toEqual({ image: NEW_REF });
  });

  it('保存が失敗したら op を投げずに理由を伝える', async () => {
    const {
      deps: d,
      dispatch,
      reportError,
    } = deps(async () => {
      throw new Error('画像が大きすぎます (8.4 MiB / 8,808,967 バイト)');
    });

    await replaceNodeImage(NODE_ID, {}, SOURCE, d);

    expect(dispatch).not.toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError.mock.calls[0][0]).toBe(
      '画像が大きすぎます (8.4 MiB / 8,808,967 バイト)',
    );
  });

  it('Error 以外が投げられても文字列にして伝える', async () => {
    const { deps: d, reportError } = deps(async () => {
      throw 'まさかの文字列';
    });

    await replaceNodeImage(NODE_ID, {}, SOURCE, d);

    expect(reportError.mock.calls[0][0]).toBe('まさかの文字列');
  });

  it('失敗しても reject しない (呼び出し元は catch を持たない)', async () => {
    const { deps: d } = deps(async () => {
      throw new Error('boom');
    });

    // reject すると drop / paste のハンドラで unhandled rejection になる
    await expect(
      replaceNodeImage(NODE_ID, {}, SOURCE, d),
    ).resolves.toBeUndefined();
  });
});
