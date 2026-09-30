/**
 * 画像の受け入れ (step3 Phase 0 S0-2 で `GraphEditor` から切り出した)。
 *
 * drop / paste イベント / Cmd+V の 3 経路が、同じ「画像を保存してノードにする (または
 * 選択中の画像ノードの画像を差し替える)」に合流する。
 *
 * **判断はここに無い。**保存と上限は `images/imageBlob.ts`、貼り付け先の選び方は
 * `images/pasteTarget.ts`、振り分けは `images/pasteImage.ts`、差し替えは
 * `images/replaceNodeImage.ts` にある。ここが持つのは**配線と位置決め**だけである。
 * 保存先はローカル blob ストアで、PDS は触らない (未ログインでも使えるため。ANA-116 設計 D5)。
 */

import type { Node } from '@xyflow/react';
import { useCallback, useEffect, useRef } from 'react';
import type { GraphEvent } from '../events/GraphEvent';
import {
  IMAGE_MIME_PREFIX,
  imagePropertiesOf,
  saveImageBlob,
} from '../images/imageBlob';
import { imageErrorMessage } from '../images/imageErrorContext';
import { pasteImage as routeImagePaste } from '../images/pasteImage';
import { pickImagePasteTarget } from '../images/pasteTarget';
import { replaceNodeImage } from '../images/replaceNodeImage';
import type { NodeTypeOption } from '../NodeTypeMenu';

type Position = { x: number; y: number };

/** canvas が見つからないときの落とし先の範囲 (旧実装と同じ) */
const FALLBACK_ORIGIN = 100;
const FALLBACK_SPREAD = 200;

export type ImageIntakeDeps = {
  addNode: (
    position: Position,
    nodeType: NodeTypeOption,
    properties: Record<string, unknown>,
  ) => void;
  getNodes: () => Node[];
  screenToFlowPosition: (p: Position) => Position;
  dispatch: (event: GraphEvent) => void;
  /** 失敗 (上限超過・保存失敗) を人に見せる。**握り潰さない** (ANA-116 設計 D7) */
  reportError: (message: string) => void;
  /** 画像の保存先。テストで差し替える (既定はローカル blob ストア) */
  saveImage?: typeof saveImageBlob;
};

function isTextInput(target: EventTarget | null): boolean {
  const tag = (target as HTMLElement | null)?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA';
}

export function useImageIntake({
  addNode,
  getNodes,
  screenToFlowPosition,
  dispatch,
  reportError,
  saveImage = saveImageBlob,
}: ImageIntakeDeps) {
  const addImageNode = useCallback(
    async (source: Blob, position: Position) => {
      try {
        const ref = await saveImage(source);
        addNode(position, 'image', imagePropertiesOf(ref));
      } catch (err) {
        // 旧実装は console.error だけだったので、上限超過は「落としたのに何も起きない」
        // ようにしか見えなかった
        reportError(imageErrorMessage(err));
      }
    },
    [addNode, saveImage, reportError],
  );

  /** 貼り付けの落とし先。canvas の中央に置く */
  const pasteTargetPosition = useCallback((): Position => {
    const containerEl = document.querySelector('.react-flow');
    if (!containerEl) {
      return {
        x: FALLBACK_ORIGIN + Math.random() * FALLBACK_SPREAD,
        y: FALLBACK_ORIGIN + Math.random() * FALLBACK_SPREAD,
      };
    }
    const rect = containerEl.getBoundingClientRect();
    return screenToFlowPosition({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    });
  }, [screenToFlowPosition]);

  const pasteImage = useCallback(
    (source: Blob) =>
      routeImagePaste(source, {
        pickTarget: () => pickImagePasteTarget(getNodes()),
        addImageNode: (s) => addImageNode(s, pasteTargetPosition()),
        replaceImage: (nodeId, properties, s) =>
          replaceNodeImage(nodeId, properties, s, { dispatch, reportError }),
      }),
    [getNodes, addImageNode, pasteTargetPosition, dispatch, reportError],
  );

  // paste イベントで画像を受け取った時刻。**keydown の代替パスとの二重処理を防ぐ**
  // ためだけに使う (下の `handlePasteKeydown` を参照)
  const pasteHandledAtRef = useRef(0);

  const handlePaste = useCallback(
    async (e: ClipboardEvent) => {
      if (isTextInput(e.target)) return;
      const items = e.clipboardData?.items;
      if (!items || items.length === 0) return;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item.type.startsWith(IMAGE_MIME_PREFIX)) continue;
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        // **await より先に記録する** — keydown 側は clipboard.read() の解決を待って
        // からここを見るので、印を付けるのが await の後だと間に合わないことがある
        pasteHandledAtRef.current = Date.now();
        await pasteImage(file);
        break;
      }
    },
    [pasteImage],
  );

  // Ctrl/Cmd+V で navigator.clipboard.read() を使う代替パス
  // (非編集可能要素では paste イベントが発火しないブラウザがあるため)
  //
  // **paste イベントが来た場合はこちらは何もしない。** ここは `clipboard.read()` を
  // await するので、`e.preventDefault()` を呼べる頃にはブラウザは既に paste を
  // 配送し終えている — 止められないので「後から見て譲る」形にする
  // (`deepse/reports/review_2026-08-11_ana116-image.md` の未検証項目)。
  const handlePasteKeydown = useCallback(
    async (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key !== 'v') return;
      if (isTextInput(e.target)) return;

      const startedAt = Date.now();
      let clipboardItems: ClipboardItems;
      try {
        clipboardItems = await navigator.clipboard.read();
      } catch {
        // clipboard read 失敗 (許可がない場合など) は paste イベントに任せる。
        // **保存の失敗をここで一緒に捨ててはならない** — 旧実装はこの catch が
        // 広すぎて、上限超過も権限エラーも同じく黙って消えていた
        return;
      }

      // この Cmd+V で paste イベントが既に画像を受け取っていたら譲る
      if (pasteHandledAtRef.current >= startedAt) return;

      for (const item of clipboardItems) {
        for (const type of item.types) {
          if (!type.startsWith(IMAGE_MIME_PREFIX)) continue;
          await pasteImage(await item.getType(type));
          // **最初の 1 枚で抜ける** — 1 つの項目が複数の画像表現 (image/png と
          // image/tiff など) を持つことがあり、回し続けると同じ画像で 2 回作られる
          return;
        }
      }
    },
    [pasteImage],
  );

  useEffect(() => {
    window.addEventListener('paste', handlePaste);
    window.addEventListener('keydown', handlePasteKeydown);
    return () => {
      window.removeEventListener('paste', handlePaste);
      window.removeEventListener('keydown', handlePasteKeydown);
    };
  }, [handlePaste, handlePasteKeydown]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      const files = e.dataTransfer.files;
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!file.type.startsWith(IMAGE_MIME_PREFIX)) continue;
        e.preventDefault();
        // 落とした位置は React の合成イベントが再利用される前に確定させる
        const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
        await addImageNode(file, position);
        break;
      }
    },
    [screenToFlowPosition, addImageNode],
  );

  return { handleDragOver, handleDrop };
}
