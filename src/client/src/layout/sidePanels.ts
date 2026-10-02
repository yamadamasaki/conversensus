/**
 * 左右のサイドバーの幅と開閉 (step3 Phase 3 S3-4b, 仕様 design-language「表示幅 (横) を増減可能
 * であること」「折り畳め, 広げられること」)
 *
 * **端末ごとの好みなので `localStorage` に置く** (§2.4)。共有しない — 画面の広さは端末で違う。
 * ここは純関数だけを置く。読み戻す値は検め、壊れていれば既定に戻す (タブの復元と同じ)
 */

import { z } from 'zod';

export type SidePanelState = {
  width: number;
  collapsed: boolean;
};

export type SidePanelsState = {
  left: SidePanelState;
  right: SidePanelState;
};

export type PanelSide = keyof SidePanelsState;

/** 狭すぎるとファイル名もボタンも読めない。広すぎるとボディが無くなる */
export const MIN_PANEL_WIDTH = 160;
export const MAX_PANEL_WIDTH = 560;
/** 左は以前の固定幅 (240) を既定にする。右は property editor の表が収まる幅 */
const DEFAULT_LEFT_WIDTH = 240;
const DEFAULT_RIGHT_WIDTH = 280;

export const DEFAULT_SIDE_PANELS: SidePanelsState = {
  left: { width: DEFAULT_LEFT_WIDTH, collapsed: false },
  // 右サイドバーは使う機会が限られる (仕様 property editor) ので、既定は畳んでおく
  right: { width: DEFAULT_RIGHT_WIDTH, collapsed: true },
};

export const SIDE_PANELS_STORAGE_KEY = 'conversensus.sidePanels';

/** 幅を許す範囲に収める。整数にする (ドラッグは小数の座標を出す) */
export function clampWidth(width: number): number {
  if (!Number.isFinite(width)) return MIN_PANEL_WIDTH;
  return Math.round(
    Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, width)),
  );
}

/**
 * ドラッグで幅を変える。左のサイドバーは右端を右へ引くと広がり、右のサイドバーは左端を
 * 左へ引くと広がる。`dx` はドラッグを始めてからのポインタの横の移動量
 */
export function resizedWidth(
  side: PanelSide,
  startWidth: number,
  dx: number,
): number {
  return clampWidth(side === 'left' ? startWidth + dx : startWidth - dx);
}

const PanelSchema = z.object({
  width: z.number(),
  collapsed: z.boolean(),
});

/** 読み戻す。読めない側は既定に戻す (片側が壊れていても、もう片側は残す) */
export function parseSidePanels(raw: string | null): SidePanelsState {
  if (raw === null) return DEFAULT_SIDE_PANELS;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return DEFAULT_SIDE_PANELS;
  }
  const record =
    typeof json === 'object' && json !== null
      ? (json as Record<string, unknown>)
      : {};
  const side = (key: PanelSide): SidePanelState => {
    const parsed = PanelSchema.safeParse(record[key]);
    return parsed.success
      ? { ...parsed.data, width: clampWidth(parsed.data.width) }
      : DEFAULT_SIDE_PANELS[key];
  };
  return { left: side('left'), right: side('right') };
}

export function serializeSidePanels(state: SidePanelsState): string {
  return JSON.stringify(state);
}
