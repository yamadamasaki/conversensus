import { useEffect, useRef, useState } from 'react';
import { color, font, radius, space } from './theme';
import { Button } from './ui/Button';
import { Dialog, DialogActions } from './ui/Dialog';

type Props = {
  message: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
  initialValue?: string;
  submitLabel?: string;
  cancelLabel?: string;
};

/** 入力の型 (visual language §6.1)。Esc・外側のクリック・「キャンセル」で閉じる */
export function InputDialog({
  message,
  onSubmit,
  onCancel,
  initialValue = '',
  submitLabel = 'OK',
  cancelLabel = 'キャンセル',
}: Props) {
  const [value, setValue] = useState(initialValue);
  const composingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleSubmit = () => {
    if (!value.trim()) return;
    onSubmit(value.trim());
  };

  return (
    <Dialog kind="input" label="入力" onDismiss={onCancel}>
      <label
        htmlFor="input-dialog-field"
        style={{ display: 'block', margin: `0 0 ${space[3]}px` }}
      >
        {message}
      </label>
      <input
        id="input-dialog-field"
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
        }}
        onKeyDown={(e) => {
          if (composingRef.current) return;
          if (e.key !== 'Enter') return;
          // **既定の動作を止める。**送信の後に別のダイアログ (検査の断りなど) が出て
          // ボタンにフォーカスが移ると、同じ打鍵の keypress がそのボタンに届いて押してしまい、
          // 出たダイアログが一瞬で閉じる (step3 Phase 6 の実機確認で見つかった)
          e.preventDefault();
          handleSubmit();
        }}
        style={{
          width: '100%',
          padding: space[2],
          fontSize: font.body,
          borderRadius: radius.sm,
          border: `1px solid ${color.border}`,
          boxSizing: 'border-box',
        }}
      />
      <DialogActions>
        <Button onClick={onCancel}>{cancelLabel}</Button>
        <Button
          variant="primary"
          onClick={handleSubmit}
          disabled={!value.trim()}
        >
          {submitLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
