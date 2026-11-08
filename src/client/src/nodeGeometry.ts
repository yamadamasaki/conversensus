/**
 * node の大きさと group の枠の寸法。
 *
 * `graphTransform.ts` から分けてある — あちらは React Flow を読み込むので、画面の無いプロセス
 * (headless の agent、`src/headless`) が node を置く計算だけのために React を読まずに済むように。
 * 値は `graphTransform.ts` が再エクスポートする (画面側の import は変わらない)
 */
export const DEFAULT_NODE_STYLE = { width: 160, height: 80 };
export const GROUP_PADDING = 20;
export const GROUP_TITLE_HEIGHT = 30;
