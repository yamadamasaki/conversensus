/**
 * タブの並びの保存と復元 (step3 Phase 3 Q3)
 *
 * **`localStorage` に置く (端末で共通)。**再読み込みの後も同じタブが並ぶ。ブラウザのタブごとに
 * 分けないのは利用者の決定である (2026-10-02)。
 *
 * 置くのはアドレスの並びだけである。中身は op-log にあるので、復元はアドレスから開き直すことで
 * 済む。**読み戻す値は検める** — 壊れた値・形の古い値は、そのタブだけ捨てる (全部は捨てない)。
 * 指す File が手元から消えている場合は、ここでは分からないので開くときに捨てる (App)。
 */

import {
  BranchIdSchema,
  GraphViewAddressSchema,
  VersionVectorSchema,
} from '@conversensus/shared';
import { z } from 'zod';
import type { TabsState } from './tabs';

export const TABS_STORAGE_KEY = 'conversensus.tabs';

const StoredTabSchema = z.union([
  z
    .object({
      id: z.string().min(1),
      panes: z.array(GraphViewAddressSchema).min(1),
      active: z.number().int().nonnegative(),
      // merger のタブ (step3 Phase 5)。壊れていたらタブごと捨てる (merger の pane だけが残ると紛らわしい)
      merger: z
        .object({
          branchId: BranchIdSchema,
          startedAt: VersionVectorSchema,
          checked: z.array(z.string()),
        })
        .optional(),
    })
    // アクティブが並びの外を指していたら先頭にする
    .transform((t) => ({
      ...t,
      active: t.active < t.panes.length ? t.active : 0,
    })),
  // S3-3 の形 (pane 1 つ = アドレス 1 つ)。開発中の端末に保存されているので読む
  z
    .object({ id: z.string().min(1), address: GraphViewAddressSchema })
    .transform((t) => ({ id: t.id, panes: [t.address], active: 0 })),
]);

const StoredTabsSchema = z.object({
  tabs: z.array(z.unknown()),
  activeId: z.string().nullable(),
});

export function serializeTabs(state: TabsState): string {
  return JSON.stringify(state);
}

/**
 * 読み戻す。読めない値は空の並びにする。タブ 1 枚ごとに検め、壊れたものだけ落とす。
 * アクティブが落ちたら (または指す先が無ければ) 先頭をアクティブにする
 */
export function parseTabs(raw: string | null): TabsState {
  if (raw === null) return { tabs: [], activeId: null };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { tabs: [], activeId: null };
  }
  const stored = StoredTabsSchema.safeParse(json);
  if (!stored.success) return { tabs: [], activeId: null };
  const tabs = stored.data.tabs.flatMap((t) => {
    const tab = StoredTabSchema.safeParse(t);
    return tab.success ? [tab.data] : [];
  });
  const activeId = tabs.some((t) => t.id === stored.data.activeId)
    ? stored.data.activeId
    : (tabs[0]?.id ?? null);
  return { tabs, activeId };
}
