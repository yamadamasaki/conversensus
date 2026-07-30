/**
 * safeStorage: localStorage を「無い/触ると例外」環境でも安全に扱う (step1 Phase 7 p7-4)
 *
 * プライベートモードや iframe の制約下では `globalThis.localStorage` の**参照自体が
 * 例外になる**ことがある。端末 id (`actor.ts`) と rkey 移行 marker
 * (`migrateRemoteRkey.ts`) が同じ守りを必要としたので 1 箇所に括り出した。
 *
 * 「使えないなら null」を返すだけで、退避先 (セッション内メモリ等) の方針は
 * 呼び出し側が決める — 何を失って良いかは用途ごとに違うため。
 */

/** localStorage が使えれば返し、使えなければ null を返す (例外を投げない) */
export function safeLocalStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // アクセス自体が例外になる環境がある (ブラウザ設定・iframe の制約)
    return null;
  }
}
