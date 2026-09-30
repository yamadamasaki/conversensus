/**
 * App 結合テストの操作手順 (step3 Phase 0 S0-1)。
 *
 * **人が画面でする操作をそのまま書く。**ボタンの文言・aria-label で要素を探すので、
 * 画面の言葉を変えるとここが落ちる。直すのはここ 1 箇所である。
 */

import { expect } from 'bun:test';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import type { FakeAccount } from './fakePds';

/** 非同期の配線 (op-log の書き込み → 読み直し → 再描画) を待つ上限 */
export const WIRING_TIMEOUT = { timeout: 5_000 };

/** pane をダブルクリックする位置。値に意味は無いが、2 回の click で揃っている必要がある */
const PANE_CLICK = { clientX: 100, clientY: 100 };

export async function login(user: UserEvent, account: FakeAccount) {
  await user.click(await screen.findByText('ATProto ログイン'));
  await user.type(screen.getByLabelText('ハンドル'), account.handle);
  await user.type(screen.getByLabelText('パスワード'), account.password);
  await user.click(screen.getByRole('button', { name: 'ログイン' }));
  await waitFor(
    () => expect(screen.queryByText('ATProto ログイン')).toBeNull(),
    WIRING_TIMEOUT,
  );
}

/**
 * 前回この端末でログインしていれば、セッションは localStorage から復元される。
 * 復元は非同期なので、サイドバーにハンドルが出るまで待つ
 */
export async function waitForResumedSession(account: FakeAccount) {
  await screen.findByText(`@${account.handle}`, {}, WIRING_TIMEOUT);
}

export async function createFile(user: UserEvent, name: string) {
  await user.type(screen.getByPlaceholderText('ファイル名'), name);
  await user.keyboard('{Enter}');
  await waitFor(
    () => expect(document.querySelector('.react-flow')).not.toBeNull(),
    WIRING_TIMEOUT,
  );
}

/**
 * 開いている File に `invitee` を招待し、参加コードを返す。
 *
 * コードは「コードをコピー」で clipboard に入る。`userEvent.setup()` が clipboard を
 * 自前の stub に差し替えるので、その stub から読む。
 */
export async function invite(
  user: UserEvent,
  invitee: FakeAccount,
): Promise<string> {
  await user.click(screen.getByTitle('参加者一覧'));
  await user.type(await screen.findByLabelText('ハンドル名'), invitee.handle);
  await user.click(screen.getByRole('button', { name: '参加依頼する' }));
  await user.click(
    await screen.findByRole(
      'button',
      { name: 'コードをコピー' },
      WIRING_TIMEOUT,
    ),
  );
  const code = await navigator.clipboard.readText();
  await user.click(screen.getByRole('button', { name: '閉じる' }));
  return code;
}

/** 参加コードで File に加わり、その File を開く */
export async function participate(
  user: UserEvent,
  code: string,
  fileName: string,
) {
  await user.click(screen.getByTitle('参加コードで参加する'));
  await user.type(screen.getByLabelText('参加コード'), code);
  await user.click(screen.getByRole('button', { name: 'OK' }));
  await user.click(
    await screen.findByRole('button', { name: '参加する' }, WIRING_TIMEOUT),
  );
  await user.click(await screen.findByText(fileName, {}, WIRING_TIMEOUT));
  await waitFor(
    () => expect(document.querySelector('.react-flow')).not.toBeNull(),
    WIRING_TIMEOUT,
  );
}

/** 開いているシートに branch を切る (開きはしない) */
export async function createBranch(user: UserEvent, name: string) {
  await user.click(screen.getByRole('button', { name: '+ branch' }));
  const dialog = await screen.findByLabelText('入力');
  await user.type(within(dialog).getByRole('textbox'), name);
  await user.click(within(dialog).getByRole('button', { name: 'OK' }));
  await screen.findByText(branchLabel(name), {}, WIRING_TIMEOUT);
}

/** サイドバーの branch 行の文言 (記号 + 名前 + 状態)。merge / close 後は `(merged)` 等が付く */
export function branchLabel(name: string): RegExp {
  return new RegExp(`${name}( \\((merged|closed)\\))?$`);
}

/** branch を開く。一覧は非同期に読み直されるので、行が出るまで待つ */
export async function openBranch(user: UserEvent, name: string) {
  await user.click(
    await screen.findByText(branchLabel(name), {}, WIRING_TIMEOUT),
  );
}

/**
 * pane をダブルクリックしてノードを足す。
 *
 * pane の dblclick は React Flow が握るので、App は click 2 回の間隔で判定している
 * (`useNodeTypeMenu`)。**同じ座標で click を 2 回送る**。
 */
export async function addNode(user: UserEvent, appearance = 'Markdown') {
  const pane = document.querySelector('.react-flow__pane');
  if (!pane) throw new Error('appDriver: pane が無い');
  fireEvent.click(pane, PANE_CLICK);
  fireEvent.click(pane, PANE_CLICK);
  await user.click(await screen.findByRole('button', { name: appearance }));
}

/** **画面に描かれている**ノードの数。op-log や state ではなく DOM を数える */
export function renderedNodeCount(): number {
  return document.querySelectorAll('.react-flow__node').length;
}

/** 「今すぐ同期」を押し、同期が終わる (ボタンの文言が戻る) まで待つ */
export async function syncNow(user: UserEvent) {
  await user.click(screen.getByRole('button', { name: '今すぐ同期' }));
  await screen.findByRole('button', { name: '今すぐ同期' }, WIRING_TIMEOUT);
}

/** 開いている branch の変更をコミットする (下部バーの「コミット」→ ダイアログ) */
export async function commitBranch(user: UserEvent, message: string) {
  await user.click(screen.getByRole('button', { name: 'コミット' }));
  const dialog = await screen.findByLabelText('コミットを作成');
  await user.type(within(dialog).getByRole('textbox'), message);
  await user.click(within(dialog).getByRole('button', { name: 'コミット' }));
  await waitFor(
    () => expect(screen.queryByLabelText('コミットを作成')).toBeNull(),
    WIRING_TIMEOUT,
  );
}

/**
 * 開いている branch を trunk へ merge する (下部バーの「merge ↑」→ 理由の入力)。
 * 対立があれば確認が挟まるので、出たら進める
 */
export async function mergeOpenBranch(user: UserEvent, reason: string) {
  const mergeButton = screen.getByRole('button', { name: 'merge ↑' });
  await waitFor(
    () => expect(mergeButton).toHaveProperty('disabled', false),
    WIRING_TIMEOUT,
  );
  await user.click(mergeButton);
  const confirm = screen.queryByRole('button', { name: 'merge する' });
  if (confirm) await user.click(confirm);
  const dialog = await screen.findByLabelText('入力', {}, WIRING_TIMEOUT);
  await user.type(within(dialog).getByRole('textbox'), reason);
  await user.click(within(dialog).getByRole('button', { name: 'OK' }));
  await waitFor(
    () => expect(screen.queryByLabelText('入力')).toBeNull(),
    WIRING_TIMEOUT,
  );
}
