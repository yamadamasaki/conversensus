/**
 * useChangeCounter: 値が変わった回数を数える (step3 Phase 4 S4-2b)。`GraphEditor` の再 seed の
 * 合図 (`receiveEpoch`) に足すのに使う — 合図は数なので、値の変化を数に直す
 */

import { useRef } from 'react';

export function useChangeCounter(value: string): number {
  const ref = useRef({ value, count: 0 });
  if (ref.current.value !== value) {
    ref.current = { value, count: ref.current.count + 1 };
  }
  return ref.current.count;
}
