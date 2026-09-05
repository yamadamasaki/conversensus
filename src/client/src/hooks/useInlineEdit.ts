import { useCallback, useRef, useState } from 'react';
import { useReadOnly } from '../readOnlyContext';

/**
 * インラインテキスト編集の共通ロジック
 * EditableNode / GroupNode / EditableLabelEdge / ImageNode で共有する
 *
 * **読み取り専用のときは編集に入らない** (step2 Phase 2 S6)。4 つの入口それぞれで
 * 判定すると, 足し忘れた 1 つから編集できてしまう。**入口が 1 つに畳まれているのが
 * ここに置く理由**である。
 */
export function useInlineEdit(
  initialValue: string,
  onConfirm: (value: string) => void,
) {
  const readOnly = useReadOnly();
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState('');
  // composing はイベントハンドラ内でのみ参照するため ref で管理する
  // (state だと compositionEnd 後の再レンダリング前に keyDown が来た場合に古い値を参照する)
  const composingRef = useRef(false);
  const setComposing = useCallback((value: boolean) => {
    composingRef.current = value;
  }, []);
  // Escape 後の onBlur で confirm が呼ばれないようにするフラグ
  const cancelledRef = useRef(false);

  const startEdit = useCallback(() => {
    // **読み取り専用なら編集に入らない。**入ってから confirm を捨てると、
    // 画面には編集後の文字が出たまま op-log には入らない状態が生まれる
    if (readOnly) return;
    cancelledRef.current = false;
    setInputValue(initialValue);
    setEditing(true);
  }, [initialValue, readOnly]);

  const confirm = useCallback(() => {
    if (cancelledRef.current) {
      cancelledRef.current = false;
      return;
    }
    onConfirm(inputValue);
    setEditing(false);
  }, [inputValue, onConfirm]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    setInputValue(initialValue);
    setEditing(false);
  }, [initialValue]);

  return {
    editing,
    inputValue,
    setInputValue,
    composingRef,
    setComposing,
    startEdit,
    confirm,
    cancel,
  };
}
