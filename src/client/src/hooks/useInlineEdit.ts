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
  const [composing, setComposing] = useState(false);
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
    composing,
    setComposing,
    startEdit,
    confirm,
    cancel,
  };
}
