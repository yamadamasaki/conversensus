import { useEffect, useRef } from 'react';
import { Button } from './ui/Button';
import { Dialog, DialogActions } from './ui/Dialog';

type Props = {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** 主のボタンの言葉。**動詞で、何が起きるかを書く** (§6.2) */
  confirmLabel?: string;
  cancelLabel?: string;
  /** 取り消せない破壊的な操作。主のボタンを赤にする */
  danger?: boolean;
};

/** 確認の型 (visual language §6.1)。外側のクリックでは閉じない */
export function ConfirmDialog({
  message,
  onConfirm,
  onCancel,
  confirmLabel = 'OK',
  cancelLabel = 'キャンセル',
  danger = false,
}: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  // 既定のフォーカスは「キャンセル」に置く。Enter の打ち癖で重い操作を通さない
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <Dialog kind="confirm" label="確認" onDismiss={onCancel}>
      <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{message}</p>
      <DialogActions>
        <Button ref={cancelRef} onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button
          variant={danger ? 'danger-solid' : 'primary'}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
