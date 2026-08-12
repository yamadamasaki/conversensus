import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

// bun では mock.module() はホイストされないため, await import() の前に呼ぶことで
// ImageNode が依存モジュールを読み込む前にモックを登録できる
const mockGetNode = mock((_id: string) => undefined);

// Handle は描画せず, 受け取った props だけを記録する。ghost の接続可否 (ANA-121) は
// DOM ではなく Handle へ渡した isConnectable で判定する
// biome-ignore lint/suspicious/noExplicitAny: テスト用スタブ
const mockHandle = mock((_props: any) => null);

mock.module('@xyflow/react', () => ({
  Handle: mockHandle,
  // biome-ignore lint/suspicious/noExplicitAny: テスト用スタブ
  NodeResizer: (_props: any) => null,
  Position: { Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' },
  useReactFlow: () => ({ getNode: mockGetNode }),
  // ImageNode は使わないが**スタブから欠かすと他のテストが落ちる** — mock.module は
  // ファイルをまたいでグローバルに効くので、同じ実行の中で `graphTransform` を読む
  // テスト (images/pasteTarget) が MarkerType を解決できなくなる
  MarkerType: { Arrow: 'arrow', ArrowClosed: 'arrowclosed' },
}));

const mockDispatch = mock((_event: unknown) => {});

mock.module('./EventDispatchContext', () => ({
  useEventDispatch: () => ({
    dispatch: mockDispatch,
    setDragging: mock((_dragging: boolean) => {}),
  }),
}));

// atproto/blob と atproto/client はモックしない。bun の mock.module はテストファイルを
// またいでグローバルに効くため, 部分的な差し替えが他のテストを壊す。blob 解決の経路は
// `imageBlobCid && imageBlobMimeType` で閉じているので, それを与えなければ呼ばれない
const { render, screen, fireEvent, cleanup, waitFor } = await import(
  '@testing-library/react'
);
const { ImageNode } = await import('./ImageNode');
const { ImageErrorProvider } = await import('./images/imageErrorContext');

// 実在の CID ベクタ ( `[1,2,3]` の CID)。daemon の応答として返す
const STORED_CID =
  'bafkreiadsbmmn4waznesyuz3bjgrj33xzqhxrk6mz3ksq7meugrachh3qe';

/**
 * `POST /blobs` の応答だけを差し替える。**モジュールモックは使わない** —
 * bun の `mock.module` はテストファイルをまたいで効くため、`images/imageBlob` を
 * 差し替えると他のテストが巻き添えになる。fetch はこのファイル内で戻せる。
 */
function stubBlobStore(): { calls: number } {
  const state = { calls: 0 };
  globalThis.fetch = (async () => {
    state.calls += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({ cid: STORED_CID, mimeType: 'image/png', size: 3 }),
    };
  }) as unknown as typeof fetch;
  URL.createObjectURL = () => 'blob:stub/1';
  return state;
}

function imageFile(type = 'image/png'): File {
  return new File([new Uint8Array([1, 2, 3])], 'a.png', { type });
}

/** drop の DataTransfer スタブ (happy-dom の DataTransfer は files を作れない) */
function dropWith(files: File[]) {
  return { dataTransfer: { files, types: ['Files'] } };
}

// NodeProps の最小スタブ
// biome-ignore lint/suspicious/noExplicitAny: テスト用 NodeProps スタブ
type TestNodeProps = any;
const makeProps = (label = '画像ノード'): TestNodeProps => ({
  id: 'node-1',
  data: { label, properties: { imageUrl: 'https://example.com/a.png' } },
  type: 'imageNode',
  isConnectable: true,
  selected: false,
  dragging: false,
  positionAbsoluteX: 0,
  positionAbsoluteY: 0,
  zIndex: 0,
});

const makeGhostProps = (label = '削除予定の画像'): TestNodeProps => ({
  ...makeProps(label),
  data: {
    label,
    ghost: true,
    properties: { imageUrl: 'https://example.com/a.png' },
  },
});

describe('ImageNode', () => {
  beforeEach(() => {
    cleanup();
    mockGetNode.mockClear();
    mockDispatch.mockClear();
    mockHandle.mockClear();
  });

  describe('ghost (削除予定表示)', () => {
    it('ハンドルをすべて接続不可にする', () => {
      render(<ImageNode {...makeGhostProps()} />);
      // ghost からエッジを引けてしまうと, 存在しないノードを指すエッジが
      // trunk へ載りうる (孤児エッジ)
      expect(mockHandle).toHaveBeenCalled();
      for (const [props] of mockHandle.mock.calls) {
        expect(props.isConnectable).toBe(false);
      }
    });

    it('ハンドル自体は消さない (ghost エッジの端点として座標が要る)', () => {
      render(<ImageNode {...makeGhostProps()} />);
      const ids = mockHandle.mock.calls.map(([props]) => props.id);
      expect(ids).toEqual([
        'source-top',
        'source-bottom',
        'source-left',
        'source-right',
      ]);
    });

    it('ラベルを取り消し線付きで表示し, 画像は描画しない', () => {
      render(<ImageNode {...makeGhostProps()} />);
      expect(screen.getByText('削除予定の画像')).toBeDefined();
      expect(screen.queryByRole('img')).toBeNull();
    });

    it('ダブルクリックしても編集モードにならない', () => {
      render(<ImageNode {...makeGhostProps()} />);
      fireEvent.dblClick(screen.getByText('削除予定の画像'));
      expect(screen.queryByRole('textbox')).toBeNull();
      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });

  describe('通常のノード', () => {
    it('ハンドルは接続可能なまま', () => {
      render(<ImageNode {...makeProps()} />);
      expect(mockHandle).toHaveBeenCalled();
      for (const [props] of mockHandle.mock.calls) {
        expect(props.isConnectable).toBeUndefined();
      }
    });
  });

  describe('画像を落として差し替える (ANA-117 S6)', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    /** ノードの本体 (drop を受ける要素) */
    const nodeBody = (container: HTMLElement) =>
      container.firstElementChild as HTMLElement;

    it('落とした画像で properties を差し替える op を dispatch する', async () => {
      stubBlobStore();
      const { container } = render(<ImageNode {...makeProps()} />);

      fireEvent.drop(nodeBody(container), dropWith([imageFile()]));

      await waitFor(() => expect(mockDispatch).toHaveBeenCalled());
      const event = mockDispatch.mock.calls[0][0] as {
        type: string;
        nodeId: string;
        from: Record<string, unknown>;
        to: Record<string, unknown>;
      };
      expect(event.type).toBe('NODE_PROPERTIES_CHANGED');
      expect(event.nodeId).toBe('node-1');
      // 差し替えなので新規ノードは作らない (NODE_ADDED を出さない)
      expect(mockDispatch).toHaveBeenCalledTimes(1);
      expect(event.to.image).toEqual({
        $type: 'blob',
        ref: { $link: STORED_CID },
        mimeType: 'image/png',
        size: 3,
      });
      // 画像以外の properties は残る (setProperties は置換意味論)
      expect(event.to.imageUrl).toBe('https://example.com/a.png');
      expect(event.from).toEqual({ imageUrl: 'https://example.com/a.png' });
    });

    it('canvas 側の drop へ伝播させない (新規ノードとの二重作成を防ぐ)', async () => {
      stubBlobStore();
      const onParentDrop = mock((_e: unknown) => {});
      const { container } = render(
        // biome-ignore lint/a11y/noStaticElementInteractions: canvas 側の drop を模す
        <div onDrop={onParentDrop}>
          <ImageNode {...makeProps()} />
        </div>,
      );

      fireEvent.drop(
        nodeBody(container.firstElementChild as HTMLElement),
        dropWith([imageFile()]),
      );

      await waitFor(() => expect(mockDispatch).toHaveBeenCalled());
      expect(onParentDrop).not.toHaveBeenCalled();
    });

    it('保存に失敗したら op を出さずに理由を伝える', async () => {
      // 設計 D7「握り潰さない」。旧実装は console.error だけで、上限超過は
      // 「落としたのに何も起きない」ようにしか見えなかった
      globalThis.fetch = (async () => ({
        ok: false,
        status: 413,
        text: async () => 'Blob too large (max 5242880 bytes)',
      })) as unknown as typeof fetch;
      const reportError = mock((_message: string) => {});
      const { container } = render(
        <ImageErrorProvider value={reportError}>
          <ImageNode {...makeProps()} />
        </ImageErrorProvider>,
      );

      fireEvent.drop(
        nodeBody(container.firstElementChild as HTMLElement),
        dropWith([imageFile()]),
      );

      await waitFor(() => expect(reportError).toHaveBeenCalled());
      expect(mockDispatch).not.toHaveBeenCalled();
      expect(reportError.mock.calls[0][0]).toContain('413');
    });

    it('画像でないファイルは受け取らず canvas へ通す', async () => {
      const store = stubBlobStore();
      const onParentDrop = mock((_e: unknown) => {});
      const { container } = render(
        // biome-ignore lint/a11y/noStaticElementInteractions: canvas 側の drop を模す
        <div onDrop={onParentDrop}>
          <ImageNode {...makeProps()} />
        </div>,
      );

      fireEvent.drop(
        nodeBody(container.firstElementChild as HTMLElement),
        dropWith([new File(['x'], 'a.txt', { type: 'text/plain' })]),
      );

      expect(mockDispatch).not.toHaveBeenCalled();
      expect(store.calls).toBe(0); // ローカル blob ストアも触らない
      expect(onParentDrop).toHaveBeenCalled(); // 伝播は止めない
    });
  });

  describe('解決できない画像 (レビュー R2)', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    /** `properties.image` だけを持つノード (旧データの imageUrl は持たせない) */
    const withBlob = (cid: string): TestNodeProps => ({
      ...makeProps(),
      data: {
        label: '画像ノード',
        properties: {
          image: {
            $type: 'blob',
            ref: { $link: cid },
            mimeType: 'image/png',
            size: 3,
          },
        },
      },
    });

    /** 指定した cid だけ実体を返し、他は 404 にする `GET /blobs/:cid` */
    function stubBlobFetch(availableCid: string) {
      globalThis.fetch = (async (url: string) => {
        if (String(url).endsWith(availableCid)) {
          return {
            ok: true,
            status: 200,
            blob: async () => new Blob([new Uint8Array([1, 2, 3])]),
          };
        }
        return { ok: false, status: 404 };
      }) as unknown as typeof fetch;
      URL.createObjectURL = () => 'blob:stub/resolved';
      URL.revokeObjectURL = () => undefined;
    }

    // **この describe だけで使う cid**。差し替えテストで `STORED_CID` を使うと、
    // 同じファイルの前のテストが `cacheBlobUrl` で温めた共有キャッシュに当たり、
    // daemon を見ずに解決してしまう (実在の CID ベクタ: [9,9,9] と [7,7,7,7])
    const AVAILABLE_CID =
      'bafkreihhictpv4w3mx2ykmki25ozum25prfzjkyqn7s7en54gt647r2fqq';
    const MISSING_CID =
      'bafkreifukhmkptdn57pjzmc2bpoawe7jyamgar45q36opw2nbe7ape5tje';

    it('差し替え先が解決できないとき前の画像を出し続けない', async () => {
      // 「読めない」ではなく「別のものが正しく見える」形の不具合になるので、
      // 参照が変わった時点で前の画像を捨てる
      stubBlobFetch(AVAILABLE_CID);
      const { rerender } = render(<ImageNode {...withBlob(AVAILABLE_CID)} />);
      await waitFor(() =>
        expect(screen.getByRole('img').getAttribute('src')).toBe(
          'blob:stub/resolved',
        ),
      );

      // 他端末が差し替えた直後など、実体がまだこの端末に無い参照へ変わる
      rerender(<ImageNode {...withBlob(MISSING_CID)} />);

      await waitFor(() => expect(screen.queryByRole('img')).toBeNull());
      expect(screen.getByText('画像を読み込み中...')).toBeDefined();
    });

    it('画像が消えたとき (参照が外れたとき) も残さない', async () => {
      stubBlobFetch(AVAILABLE_CID);
      const { rerender } = render(<ImageNode {...withBlob(AVAILABLE_CID)} />);
      await waitFor(() => expect(screen.getByRole('img')).toBeDefined());

      // 画像キーごと落ちた properties へ差し替わる (remote の setProperties など)
      rerender(
        <ImageNode
          {...makeProps()}
          data={{ label: '画像ノード', properties: {} }}
        />,
      );

      await waitFor(() => expect(screen.queryByRole('img')).toBeNull());
    });
  });
});
