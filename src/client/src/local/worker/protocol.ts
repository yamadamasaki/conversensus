/**
 * main ↔ ローカル正典の Worker のやりとり (step3 Phase 2 D3)
 *
 * RPC は自前で書く (設計 U3)。運ぶのは `LocalBackend` の 9 関数の呼び出しと、起動の結果と、
 * 開発時の契約の検査だけで、小さなライブラリを足すほどの量ではない。
 */

import type { LocalBackend } from '../backend';

export type BackendMethod = keyof LocalBackend;

/** main → Worker の本文 (id は送る側が付ける) */
export type RequestBody =
  | { kind: 'call'; method: BackendMethod; args: unknown[] }
  | { kind: 'driverContract' };

export type WorkerRequest = RequestBody & { id: number };

/** Worker → main */
export type WorkerResponse =
  | { kind: 'ready' }
  /** 保存領域が開けなかった (プライベートブラウズ・cross-origin isolation が無いなど) */
  | { kind: 'unavailable'; reason: string }
  | { id: number; kind: 'result'; value: unknown }
  | { id: number; kind: 'error'; message: string };
