import { describe, expect, it, mock } from 'bun:test';
import type { NodeId } from '@conversensus/shared';
import type { ImagePasteTarget } from './pasteImage';
import { pasteImage } from './pasteImage';

const NODE_ID = '11111111-1111-4111-8111-111111111111';
const PNG = 'image/png';

/** 中身は使わない — 保存も差し替えも差し込むので実体は読まれない */
const SOURCE = { type: PNG, size: 7 } as unknown as Blob;

function deps(target?: ImagePasteTarget) {
  const addImageNode = mock(async (_source: Blob) => undefined);
  const replaceImage = mock(
    async (
      _nodeId: NodeId,
      _properties: Record<string, unknown> | undefined,
      _source: Blob,
    ) => undefined,
  );
  const pickTarget = mock(() => target);
  return {
    deps: { pickTarget, addImageNode, replaceImage },
    pickTarget,
    addImageNode,
    replaceImage,
  };
}

/** React Flow のノードのうち, 振り分けに要る部分だけ */
function imageNode(properties?: Record<string, unknown>): ImagePasteTarget {
  return {
    id: NODE_ID,
    type: 'image',
    selected: true,
    data: properties ? { properties } : {},
  };
}

describe('pasteImage', () => {
  it('貼り付け先が無ければ新規ノードを作る', async () => {
    const { deps: d, addImageNode, replaceImage } = deps(undefined);

    await pasteImage(SOURCE, d);

    expect(addImageNode).toHaveBeenCalledTimes(1);
    expect(addImageNode.mock.calls[0][0]).toBe(SOURCE);
    expect(replaceImage).not.toHaveBeenCalled();
  });

  it('貼り付け先があればそのノードを差し替える', async () => {
    const { deps: d, addImageNode, replaceImage } = deps(imageNode());

    await pasteImage(SOURCE, d);

    // 差し替えられるはずの貼り付けで新規ノードが増えると, 利用者は
    // 「差し替わらなかった」ではなく「勝手にノードが増えた」形で困る
    expect(addImageNode).not.toHaveBeenCalled();
    expect(replaceImage).toHaveBeenCalledTimes(1);
    expect(replaceImage.mock.calls[0][0]).toBe(NODE_ID as NodeId);
    expect(replaceImage.mock.calls[0][2]).toBe(SOURCE);
  });

  it('差し替え先の properties をそのまま渡す', async () => {
    // 置換意味論なので, 渡し損ねると画像以外の properties が消える
    const properties = { caption: 'a', image: { old: true } };
    const { deps: d, replaceImage } = deps(imageNode(properties));

    await pasteImage(SOURCE, d);

    expect(replaceImage.mock.calls[0][1]).toEqual(properties);
  });

  it('properties を持たないノードへも差し替えられる', async () => {
    const { deps: d, replaceImage } = deps(imageNode());

    await pasteImage(SOURCE, d);

    expect(replaceImage.mock.calls[0][1]).toBeUndefined();
  });

  it('行き先は貼り付けた時点で決める', async () => {
    // clipboard.read() を待つ経路があるので, 選択の読みが早いと
    // 「選んだ直後の貼り付け」が古い選択で振り分けられる
    const { deps: d, pickTarget } = deps(undefined);

    expect(pickTarget).not.toHaveBeenCalled();
    await pasteImage(SOURCE, d);
    expect(pickTarget).toHaveBeenCalledTimes(1);
  });

  it('振り分けた先の完了を待つ', async () => {
    // 呼び出し元 (`handlePaste`) は await して二重処理の印を付ける。
    // 待たないと保存前に次の貼り付けが走る
    let finish: (() => void) | undefined;
    const { deps: d } = deps(undefined);
    d.addImageNode = mock(
      (_source: Blob) =>
        new Promise<undefined>((resolve) => {
          finish = () => resolve(undefined);
        }),
    );

    let settled = false;
    const running = pasteImage(SOURCE, d).then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);
    finish?.();
    await running;
    expect(settled).toBe(true);
  });
});
