import { afterEach, describe, expect, it } from 'bun:test';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ReadOnlyProvider } from '../readOnlyContext';
import { useInlineEdit } from './useInlineEdit';

afterEach(cleanup);

const wrapperOf = (readOnly: boolean) => {
  return ({ children }: { children: ReactNode }) => (
    <ReadOnlyProvider value={readOnly}>{children}</ReadOnlyProvider>
  );
};

describe('useInlineEdit の読み取り専用ゲート (step2 Phase 2 S6)', () => {
  it('通常は編集に入れる', () => {
    const { result } = renderHook(() => useInlineEdit('もと', () => {}), {
      wrapper: wrapperOf(false),
    });
    act(() => result.current.startEdit());
    expect(result.current.editing).toBe(true);
    expect(result.current.inputValue).toBe('もと');
  });

  it('⚠️ 読み取り専用なら編集に入らない', () => {
    // **入ってから confirm を捨てる形にしない。**画面には編集後の文字が出たまま
    // op-log には入らない状態が生まれ, 次の再 projection で黙って戻る
    const { result } = renderHook(() => useInlineEdit('もと', () => {}), {
      wrapper: wrapperOf(true),
    });
    act(() => result.current.startEdit());
    expect(result.current.editing).toBe(false);
  });

  it('Provider が無ければ編集できる — 置き忘れで操作を奪わない', () => {
    const { result } = renderHook(() => useInlineEdit('もと', () => {}));
    act(() => result.current.startEdit());
    expect(result.current.editing).toBe(true);
  });
});
