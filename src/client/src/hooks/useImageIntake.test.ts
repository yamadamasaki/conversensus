import { afterEach, describe, expect, it } from 'bun:test';
import type { BlobCid, MimeType } from '@conversensus/shared';
import { renderHook, waitFor } from '@testing-library/react';
import type { DragEvent } from 'react';
import type { ImageBlobRef } from '../images/imageBlob';
import { imagePropertiesOf } from '../images/imageBlob';
import { type ImageIntakeDeps, useImageIntake } from './useImageIntake';

// 画面座標 → canvas 座標。ずれを入れて「変換を通している」ことを見えるようにする
const SCREEN_TO_FLOW_OFFSET = 1000;
const screenToFlowPosition = (p: { x: number; y: number }) => ({
  x: p.x + SCREEN_TO_FLOW_OFFSET,
  y: p.y + SCREEN_TO_FLOW_OFFSET,
});

const PNG = 'image/png';
const REF: ImageBlobRef = {
  $type: 'blob',
  ref: { $link: 'bafkreitest' as BlobCid },
  mimeType: PNG as MimeType,
  size: 3,
};

function imageFile(name = 'a.png'): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: PNG });
}

type AddedNode = { position: { x: number; y: number }; type: string };

function setup(overrides: Partial<ImageIntakeDeps> = {}) {
  const added: AddedNode[] = [];
  const saved: Blob[] = [];
  const errors: string[] = [];
  const deps: ImageIntakeDeps = {
    addNode: (position, type) => added.push({ position, type }),
    // 何も選択していない = 貼り付けは常に新しいノードになる
    getNodes: () => [],
    screenToFlowPosition,
    dispatch: () => {},
    reportError: (m) => errors.push(m),
    saveImage: async (source) => {
      saved.push(source);
      return REF;
    },
    ...overrides,
  };
  const { result } = renderHook(() => useImageIntake(deps));
  return { handlers: result.current, added, saved, errors };
}

/** window に paste を送る。`clipboardData` は happy-dom が組めないので形だけ与える */
function firePaste(
  items: { type: string; file: File | null }[],
  target: EventTarget = window,
) {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: {
      items: items.map((i) => ({ type: i.type, getAsFile: () => i.file })),
    },
  });
  target.dispatchEvent(event);
}

function stubClipboardRead(read: () => Promise<ClipboardItems>) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { read },
  });
}

function pressCmdV() {
  window.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'v', metaKey: true }),
  );
}

function clipboardImage(types: string[] = [PNG]): ClipboardItem {
  return {
    types,
    getType: async () => imageFile(),
  } as unknown as ClipboardItem;
}

function dropEvent(files: File[], at = { x: 10, y: 20 }): DragEvent {
  return {
    dataTransfer: { files, types: ['Files'] },
    clientX: at.x,
    clientY: at.y,
    preventDefault: () => {},
  } as unknown as DragEvent;
}

/** 非同期の後始末が走り切るのを待つ (「何も起きない」を見る前) */
const settle = () => new Promise((r) => setTimeout(r, 10));

afterEach(() => {
  document.body.innerHTML = '';
});

describe('useImageIntake: paste イベント', () => {
  it('画像を保存して、画像ノードを作る', async () => {
    const { added, saved } = setup();

    firePaste([{ type: PNG, file: imageFile() }]);

    await waitFor(() => expect(added).toHaveLength(1));
    expect(saved).toHaveLength(1);
    expect(added[0].type).toBe('image');
  });

  it('入力欄への貼り付けは画像として扱わない (テキストの貼り付けを奪わない)', async () => {
    const { saved } = setup();
    const input = document.createElement('input');
    document.body.appendChild(input);

    firePaste([{ type: PNG, file: imageFile() }], input);

    await settle();
    expect(saved).toEqual([]);
  });

  it('画像でないものは無視する', async () => {
    const { saved } = setup();

    firePaste([{ type: 'text/plain', file: null }]);

    await settle();
    expect(saved).toEqual([]);
  });

  it('保存に失敗したら、ノードを作らずに理由を知らせる (握り潰さない)', async () => {
    const { added, errors } = setup({
      saveImage: async () => {
        throw new Error('上限を超えています');
      },
    });

    firePaste([{ type: PNG, file: imageFile() }]);

    await waitFor(() => expect(errors).toEqual(['上限を超えています']));
    expect(added).toEqual([]);
  });
});

describe('useImageIntake: Cmd+V の代替パス', () => {
  it('paste イベントが来ないブラウザでは、clipboard.read() から画像を取る', async () => {
    stubClipboardRead(async () => [clipboardImage()]);
    const { added } = setup();

    pressCmdV();

    await waitFor(() => expect(added).toHaveLength(1));
  });

  it('同じ Cmd+V で paste イベントが画像を受け取っていたら、二重に作らない', async () => {
    let releaseRead: (items: ClipboardItems) => void = () => {};
    stubClipboardRead(
      () =>
        new Promise((resolve) => {
          releaseRead = resolve;
        }),
    );
    const { added, saved } = setup();

    // 実機の順序: keydown が read() を待っている間に paste が配送される
    pressCmdV();
    firePaste([{ type: PNG, file: imageFile() }]);
    releaseRead([clipboardImage()]);

    await waitFor(() => expect(added).toHaveLength(1));
    await settle();
    expect(saved).toHaveLength(1);
  });

  it('1 つの項目が複数の画像表現を持っていても、1 枚しか作らない', async () => {
    stubClipboardRead(async () => [clipboardImage([PNG, 'image/tiff'])]);
    const { added } = setup();

    pressCmdV();

    await waitFor(() => expect(added).toHaveLength(1));
    await settle();
    expect(added).toHaveLength(1);
  });
});

describe('useImageIntake: drop', () => {
  it('落とした位置 (canvas 座標) に画像ノードを作る', async () => {
    const { handlers, added } = setup();

    await handlers.handleDrop(dropEvent([imageFile()], { x: 10, y: 20 }));

    expect(added).toEqual([
      { position: screenToFlowPosition({ x: 10, y: 20 }), type: 'image' },
    ]);
  });

  it('画像でないファイルは無視し、最初の画像 1 枚だけを受け取る', async () => {
    const { handlers, added, saved } = setup();
    const text = new File(['x'], 'a.txt', { type: 'text/plain' });

    await handlers.handleDrop(
      dropEvent([text, imageFile('1.png'), imageFile('2.png')]),
    );

    expect(added).toHaveLength(1);
    expect((saved[0] as File).name).toBe('1.png');
  });

  it('保存した画像への参照を、ノードの properties として渡す', async () => {
    const received: Record<string, unknown>[] = [];
    const { handlers } = setup({
      addNode: (_p, _t, properties) => received.push(properties),
    });

    await handlers.handleDrop(dropEvent([imageFile()]));

    expect(received).toEqual([imagePropertiesOf(REF)]);
  });
});
