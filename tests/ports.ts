/**
 * E2E が自前に立てるサーバのポート。
 *
 * **手で動かす環境の 5173〜5176 (`deepse/requirements/user-test-environment.md`) と
 * 重ならない 5184〜 を使う。** 利用者が bob 用に :5174、手元の本番ビルドに :5175 を
 * 立てたまま E2E を走らせても、どちらも起動に失敗しない (以前は :5174 / :5175 で衝突した)
 */
export const E2E_CLIENT_PORT = 5184;
/**
 * 本番ビルドの配信 (`vite preview`)。**service worker は本番ビルドでだけ登録する**ので、
 * オフライン起動 (`offline.spec.ts`) や更新の知らせ (`appUpdate.spec.ts`) はこちらで見る
 */
export const E2E_PREVIEW_PORT = 5185;
export const E2E_PREVIEW_URL = `http://127.0.0.1:${E2E_PREVIEW_PORT}/`;
