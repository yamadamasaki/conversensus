/**
 * 保存領域が開けなかったときの画面 (step3 Phase 2 D5)
 *
 * **黙ってメモリ上の DB に落とさない。**落とすと、編集はできるのに窓を閉じた瞬間に消える。
 * 編集を始めさせず、理由と取れる手を出す。
 */

const STORAGE_UNAVAILABLE_TITLE = 'この窓では保存できません';
export const ERASED_TITLE = 'この端末の conversensus のデータを消しました';

export function StorageUnavailable({ reason }: { reason: string }) {
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
      <h1 style={{ fontSize: 20 }}>{STORAGE_UNAVAILABLE_TITLE}</h1>
      <p>
        編集を保存する場所 (ブラウザの保存領域) を開けませんでした。
        プライベートブラウズの窓では保存できないことがあります。通常の窓で開き直してください。
      </p>
      <p style={{ color: '#666', fontSize: 13 }}>理由: {reason}</p>
    </main>
  );
}

/** 保存領域を開いている間の表示。白い画面のまま待たせない */
export function Starting() {
  return (
    <main
      role="status"
      style={{ maxWidth: 560, margin: '80px auto', padding: 16, color: '#999' }}
    >
      起動中…
    </main>
  );
}

/**
 * ログアウトで「この端末のデータも消す」を選び、消し終えたときの画面 (#288)。
 * 窓はスクリプトからは閉じられない (スクリプトが開いた窓でないため) ので、閉じてもらう
 */
export function Erased() {
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
      <h1 style={{ fontSize: 20 }}>{ERASED_TITLE}</h1>
      <p>このタブを閉じてください。</p>
    </main>
  );
}
