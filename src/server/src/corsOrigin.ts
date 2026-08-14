/**
 * どの origin からの要求を通すか (step1 Phase 8 S3)
 *
 * **判断をここに出したのは検査できるようにするため**である。`app.use(cors(...))` の
 * 中に書いたままだと, テストから `Origin` を付けられず検査できない —
 * **`Origin` は Fetch 仕様の禁止ヘッダ**で, スクリプトからは設定できない
 * (テスト環境の happy-dom も仕様どおり落とすので, コールバックには `""` が届く)。
 *
 * 通す先は 3 つある。
 *
 * 1. **`http://localhost:*`** — 開発中のクライアント (:5173) と E2E (:5174)。
 *    ポートが可変なので前綴りで見る
 * 2. **`tauri://localhost`** — 同梱アプリ (Phase 8)。通さないと配布物は全リクエストが
 *    落ち, **画面は出るのに一覧が空**という誤診しやすい形になる。リモートの出自ではなく
 *    同じ端末で動く同梱アプリの名前なので, 常に通してよい
 * 3. **`ALLOWED_ORIGIN`** — VPS のクライアント (`https://app.conversensus.site`)。
 *    環境変数で与えたものだけ
 */

/** 開発用クライアントの origin。ポートが可変なので前綴りで判定する */
const LOCALHOST_ORIGIN_PREFIX = 'http://localhost:';

/**
 * Tauri アプリ (WKWebView) が名乗る origin。
 *
 * **完全一致で見る。** 前方一致にすると `tauri://localhost.example.com` のような
 * 別物まで通る。
 */
const TAURI_ORIGIN = 'tauri://localhost';

/**
 * 通してよければその origin を, 駄目なら `null` を返す。
 *
 * @param origin 要求の `Origin` ヘッダ (無ければ undefined)
 * @param allowedOriginFromEnv `ALLOWED_ORIGIN` 環境変数の値 (無ければ null)
 */
export function allowedOrigin(
  origin: string | undefined,
  allowedOriginFromEnv: string | null,
): string | null {
  if (!origin) return null;
  if (origin.startsWith(LOCALHOST_ORIGIN_PREFIX)) return origin;
  if (origin === TAURI_ORIGIN) return TAURI_ORIGIN;
  if (allowedOriginFromEnv && origin === allowedOriginFromEnv) return origin;
  return null;
}
