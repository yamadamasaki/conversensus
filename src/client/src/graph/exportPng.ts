/**
 * いま見えているシートを PNG に書き出す (step3 Phase 0 S0-2 で `GraphEditor` から切り出した)。
 *
 * 全ノードが収まる viewport を求め、`.react-flow__viewport` をその変換で描き直して
 * 画像にする。画面のパン・ズームには依らない。
 */

import { getNodesBounds, getViewportForBounds, type Node } from '@xyflow/react';
import { toPng } from 'html-to-image';
import {
  PNG_EXPORT_HEIGHT,
  PNG_EXPORT_MAX_ZOOM,
  PNG_EXPORT_MIN_ZOOM,
  PNG_EXPORT_PADDING,
  PNG_EXPORT_WIDTH,
} from '../graphTransform';

const PNG_BACKGROUND = '#ffffff';
/** ファイル名に使えない文字 (主要 OS の和集合) */
const UNSAFE_FILE_NAME_CHARS = /[/\\:*?"<>|]/g;
const SAFE_REPLACEMENT = '_';

/** 書き出すファイル名。`<File 名> - <Sheet 名>.png` で、使えない文字は `_` にする */
export function pngFileName(fileName: string, sheetName: string): string {
  const base = `${fileName} - ${sheetName}`.replace(
    UNSAFE_FILE_NAME_CHARS,
    SAFE_REPLACEMENT,
  );
  return `${base}.png`;
}

export async function exportPng(
  nodes: Node[],
  fileName: string,
  sheetName: string,
): Promise<void> {
  const viewportEl = document.querySelector<HTMLElement>(
    '.react-flow__viewport',
  );
  if (!viewportEl) return;

  const width = PNG_EXPORT_WIDTH;
  const height = PNG_EXPORT_HEIGHT;
  const viewport = getViewportForBounds(
    getNodesBounds(nodes),
    width,
    height,
    PNG_EXPORT_MIN_ZOOM,
    PNG_EXPORT_MAX_ZOOM,
    PNG_EXPORT_PADDING,
  );
  const dataUrl = await toPng(viewportEl, {
    backgroundColor: PNG_BACKGROUND,
    width,
    height,
    style: {
      width: String(width),
      height: String(height),
      transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
    },
  });
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = pngFileName(fileName, sheetName);
  a.click();
}
