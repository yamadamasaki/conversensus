import { useCallback, useRef, useState } from 'react';

/**
 * インラインテキスト編集の共通ロジック
 * EditableNode / GroupNode / EditableLabelEdge で共有する
 */
export function useInlineEdit(
  initialValue: string,
  onConfirm: (value: string) => void,
) {
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
    cancelledRef.current = false;
    setInputValue(initialValue);
    setEditing(true);
  }, [initialValue]);

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
