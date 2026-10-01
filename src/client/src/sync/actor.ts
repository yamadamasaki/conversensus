/**
 * actor: Lamport の操作主体を端末まで一意に識別する (step1 Phase 4d-2)
 *
 * 受信 (Phase 4d) では、**因果順序の単位と重複排除の単位を識別できる**ことが要る。
 * W3d5-7 の実機検証では device A・B とも `actor = 'local'` で、両端末の batch が
 * ともに `clock=3` を名乗った (設計 `step1-phase4d-receive.md` §1.1)。
 *
 * 形式は **`<did>#<deviceId>`** の複合:
 * - **DID だけでは足りない** — 想定アクターモデルが「単一ユーザー・複数端末」なので、
 *   同じアカウントの別端末を区別できない。
 * - **deviceId だけでも足りない** — 出自 (誰の編集か) が失われ、権限・帰属・PDS リポジトリ
 *   所有者との照合ができなくなる。step2 の共同編集で必要になる。
 *
 * 未ログイン時は DID の代わりに `local` を使う (`local#<deviceId>`)。
 *
 * `Actor` は `string` のエイリアスなので型変更は不要で、`BatchRecord.actor: string` も
 * そのまま使える。
 */

import {
  ACTOR_SEPARATOR,
  composeActor,
  didFromActor,
  LOCAL_DID,
} from '@conversensus/shared';
import { safeLocalStorage } from './safeStorage';

/**
 * **actor の書式は shared が持つ** (step2 Phase 1)。判断ログの畳み込みが actor から
 * DID を取り出す必要があり、それは shared 側の純粋な計算だからである。
 * ここは deviceId の採番 (端末依存) と、従来どおりの窓口を担う。
 */
export { ACTOR_SEPARATOR, composeActor, didFromActor, LOCAL_DID };

/** deviceId の保存キー (localStorage) */
export const DEVICE_ID_STORAGE_KEY = 'conversensus_device_id';

/** localStorage が使えない環境 (プライベートモード等) のための退避先 */
let fallbackDeviceId: string | undefined;

/**
 * このタブが借りた deviceId (step3 Phase 2 D4, `local/deviceClaim.ts`)。起動時に
 * `main.tsx` が決める。決まっていれば `getDeviceId` はこれを返す
 */
let claimedDeviceId: string | undefined;

/** このタブの deviceId を決める (起動時に 1 回、描画の前に呼ぶ)。undefined で戻す (テスト用) */
export function setClaimedDeviceId(deviceId: string | undefined): void {
  claimedDeviceId = deviceId;
}

/**
 * この端末の一意 id を返す。無ければ生成して保存する。
 *
 * **人間可読な値 (端末名など) は混ぜない** — actor は PDS 上のレコードに載って公開される。
 *
 * localStorage がクリアされたら新しい id になり、その端末は「別の端末」として振る舞う。
 * **正しさは失われない** (actor が 1 つ増えるだけで、因果順序も重複排除も壊れない) ので、
 * 再生成を防ぐ仕組みは持たない。
 */
export function getDeviceId(storage?: Storage): string {
  // タブごとの id が決まっていればそれ (同じ端末のタブが同じ点を発番しないため, D4)
  if (storage === undefined && claimedDeviceId !== undefined) {
    return claimedDeviceId;
  }
  const store = storage ?? safeLocalStorage();
  if (!store) {
    // localStorage が無い環境ではセッション内だけ一貫した id を使う
    fallbackDeviceId ??= crypto.randomUUID();
    return fallbackDeviceId;
  }
  const existing = store.getItem(DEVICE_ID_STORAGE_KEY);
  if (existing) return existing;
  const generated = crypto.randomUUID();
  store.setItem(DEVICE_ID_STORAGE_KEY, generated);
  return generated;
}
