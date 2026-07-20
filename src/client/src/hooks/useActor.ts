/**
 * useActor: ATProto セッションからこの端末の操作主体を組み立てる (step1 Phase 4d-2)
 *
 * `<did>#<deviceId>` (未ログインは `local#<deviceId>`)。deviceId は初回に生成して
 * localStorage に保存され、以降の起動でも同じ値になる (`sync/actor.ts`)。
 *
 * ログイン状態が変わると actor も変わる。**同じ端末の同じユーザーである限り actor は
 * 安定している**ことが要件で、これが受信時に因果順序と重複排除の単位を識別する根拠になる
 * (設計 `step1-phase4d-receive.md` §3.1)。
 */

import type { Actor } from '@conversensus/shared';
import { useMemo } from 'react';
import type { AtprotoSession } from '../atproto';
import { composeActor, getDeviceId } from '../sync/actor';

export function useActor(session: AtprotoSession | null): Actor {
  return useMemo(
    () => composeActor(session?.did ?? null, getDeviceId()),
    [session],
  );
}
