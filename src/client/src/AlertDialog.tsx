import { useEffect, useRef } from 'react';
import { useMessages } from './i18n/messages';
import { Button } from './ui/Button';
import { Dialog, DialogActions } from './ui/Dialog';

type Props = {
  message: string;
  onClose: () => void;
  closeLabel?: string;
};

/** 知らせの型 (visual language §6.1)。Esc・Enter・「OK」・外側のクリックで閉じる */
export function AlertDialog({ message, onClose, closeLabel }: Props) {
  const t = useMessages();
  const closeRef = useRef<HTMLButtonElement>(null);

  // 「OK」にフォーカスを置くので、Enter で閉じる
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  return (
    <Dialog kind="alert" label={t.common.notice} onDismiss={onClose}>
      <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{message}</p>
      <DialogActions>
        <Button ref={closeRef} variant="primary" onClick={onClose}>
          {closeLabel ?? t.common.ok}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
