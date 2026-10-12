import { useMessages } from './i18n/messages';
import { color, font } from './theme';

/**
 * 保存領域が開けなかったときの画面 (step3 Phase 2 D5)
 *
 * **黙ってメモリ上の DB に落とさない。**落とすと、編集はできるのに窓を閉じた瞬間に消える。
 * 編集を始めさせず、理由と取れる手を出す。
 */

export function StorageUnavailable({ reason }: { reason: string }) {
  const t = useMessages();
  return (
    <main
      role="alert"
      style={{
        maxWidth: 560,
        margin: '80px auto',
        padding: 16,
        lineHeight: 1.7,
      }}
    >
      <h1 style={{ fontSize: font.title }}>{t.storage.unavailableTitle}</h1>
      <p>{t.storage.unavailableBody}</p>
      <p style={{ color: color.textMuted, fontSize: font.body }}>
        {t.storage.reason(reason)}
      </p>
    </main>
  );
}

/** 保存領域を開いている間の表示。白い画面のまま待たせない */
export function Starting() {
  const t = useMessages();
  return (
    <main
      role="status"
      style={{
        maxWidth: 560,
        margin: '80px auto',
        padding: 16,
        color: color.textMuted,
      }}
    >
      {t.storage.starting}
    </main>
  );
}

/**
 * ログアウトで「この端末のデータも消す」を選び、消し終えたときの画面 (#288)。
 * 窓はスクリプトからは閉じられない (スクリプトが開いた窓でないため) ので、閉じてもらう
 */
export function Erased() {
  const t = useMessages();
  return (
    <main
      role="status"
      style={{
        maxWidth: 560,
        margin: '80px auto',
        padding: 16,
        lineHeight: 1.7,
      }}
    >
      <h1 style={{ fontSize: font.title }}>{t.storage.erasedTitle}</h1>
      <p>{t.storage.erasedBody}</p>
    </main>
  );
}
