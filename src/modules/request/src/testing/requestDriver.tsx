/**
 * 依頼の App 結合の試験の道具 (計画 node-actions-request-module.md N3)
 *
 * `<App />` に依頼の module を登録して描き (アプリの入口 `main.tsx` と同じ)、依頼の操作を
 * node のそばの操作と dialog から行う。
 */

import { expect } from 'bun:test';
import App from '@conversensus/client/src/App';
import { createNodeActionRegistry } from '@conversensus/client/src/nodeActions/registry';
import { NodeActionsProvider } from '@conversensus/client/src/nodeActions/registryContext';
import {
  renderedNodeCount,
  WIRING_TIMEOUT,
} from '@conversensus/client/src/testing/appDriver';
import { render, screen, waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { REQUEST_MODULE } from '../requestModule';

const REGISTRY = createNodeActionRegistry([REQUEST_MODULE]);

/** 依頼の module を登録して App を描く */
export function renderAppWithRequests() {
  return render(
    <NodeActionsProvider registry={REGISTRY}>
      <App />
    </NodeActionsProvider>,
  );
}

/** 選んでいる node のそばの操作 */
export const nodeBar = () =>
  screen.getByRole('toolbar', { name: 'node の操作' });

/** 選んでいる node のそばの操作を押す (出るまで待つ) */
export async function clickNodeAction(user: UserEvent, name: string) {
  const bar = await screen.findByRole(
    'toolbar',
    { name: 'node の操作' },
    WIRING_TIMEOUT,
  );
  await user.click(
    await within(bar).findByRole('button', { name }, WIRING_TIMEOUT),
  );
}

/** 操作の dialog で「実行」し、閉じるまで待つ */
async function runDialog(user: UserEvent, dialog: HTMLElement, name: string) {
  await user.click(within(dialog).getByRole('button', { name: '実行' }));
  await waitFor(
    () => expect(screen.queryByRole('dialog', { name })).toBeNull(),
    WIRING_TIMEOUT,
  );
}

/**
 * 選んでいる依頼を送る (送り直す)。dialog で宛先の checkbox を `addressees` の人だけにする
 * (名前は参加者の一覧の表示。空なら誰も選ばない = 参加者全員)
 */
export async function sendSelected(
  user: UserEvent,
  addressees: readonly string[] = [],
  action: '送る' | '送り直す' = '送る',
) {
  await clickNodeAction(user, action);
  const dialog = await screen.findByRole('dialog', { name: action });
  for (const box of within(dialog).queryAllByRole('checkbox')) {
    const name = box.parentElement?.textContent?.trim() ?? '';
    if ((box as HTMLInputElement).checked !== addressees.includes(name)) {
      await user.click(box);
    }
  }
  await runDialog(user, dialog, action);
}

/** 選んでいる依頼に答える */
export async function answerSelected(user: UserEvent, content: string) {
  await clickNodeAction(user, '答える');
  const dialog = await screen.findByRole('dialog', { name: '答える' });
  await user.type(within(dialog).getByLabelText('答え'), content);
  await runDialog(user, dialog, '答える');
}

/** node の上の依頼の印の値 (状態)。`content` を含む node の印、無ければ最初の印 */
export function requestBadge(content?: string): string | null | undefined {
  const nodes = [...document.querySelectorAll('.react-flow__node')];
  const node = content
    ? nodes.find((n) => n.textContent?.includes(content))
    : nodes.find((n) => n.querySelector('[data-node-badge="request"]'));
  return node
    ?.querySelector('[data-node-badge="request"]')
    ?.getAttribute('data-badge-value');
}

/**
 * 「依頼・相談」の種を File に入れ、それを当てた Sheet を足して開く (agent 段 4)。
 * 開いた Sheet は空 (node 0)
 */
export async function addRequestSheet(user: UserEvent) {
  await user.click(
    screen.getByRole('button', { name: 'template 付きで Sheet を追加' }),
  );
  await user.click(screen.getByRole('button', { name: '+ 依頼・相談 を追加' }));
  await screen.findByTitle('template graph', {}, WIRING_TIMEOUT);
  await user.click(screen.getByText('+ Sheet を追加'));
  const dialog = await screen.findByRole('dialog', { name: 'Sheet を追加' });
  await user.click(
    within(dialog).getByRole('checkbox', { name: '依頼・相談' }),
  );
  await user.click(
    within(dialog).getByRole('button', { name: 'Sheet を追加' }),
  );
  await waitFor(() => expect(renderedNodeCount()).toBe(0), WIRING_TIMEOUT);
}
