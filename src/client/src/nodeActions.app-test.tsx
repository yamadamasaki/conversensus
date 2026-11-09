import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { type FileId, projectFile } from '@conversensus/shared';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { makeEventBase } from './events/GraphEvent';
import type {
  LocalizedText,
  NodeActionContext,
  NodeModule,
} from './nodeActions/nodeAction';
import { createNodeActionRegistry } from './nodeActions/registry';
import { NodeActionsProvider } from './nodeActions/registryContext';
import {
  addNode,
  createFile,
  renderedNodeCount,
  selectFirstNode,
  WIRING_TIMEOUT,
} from './testing/appDriver';
import { type AppWorld, createAppWorld } from './testing/appWorld';

/** 試験の module の property (`.` を含む = extension。property の欄で変えられる名前ではない) */
const MARK = 'test.nodeActions.mark';
const TAG = 'test.nodeActions.tag';
const text = (ja: string): LocalizedText => ({ ja, en: ja });

/** property を 1 つ書く GraphEvent (試験の module の run) */
function withProperty(ctx: NodeActionContext, name: string, value: unknown) {
  const from = ctx.node.properties ?? {};
  return {
    ...makeEventBase('content'),
    type: 'NODE_PROPERTIES_CHANGED' as const,
    nodeId: ctx.node.id,
    from,
    to: { ...from, [name]: value },
  };
}

/**
 * 試験の module: 引数の無い操作 (印を付ける。付いていれば出ない) と、引数の要る操作 (札を書く。
 * 前の札が dialog に入っている)
 */
const TEST_MODULE: NodeModule = {
  id: 'test',
  actions: [
    {
      id: 'mark',
      label: text('印を付ける'),
      available: (ctx) => ctx.node.properties?.[MARK] !== true,
      run: (ctx) => withProperty(ctx, MARK, true),
    },
    {
      id: 'tag',
      label: text('札を書く'),
      available: () => true,
      params: [
        { name: 'tag', kind: 'text', label: text('札'), required: true },
      ],
      initial: (ctx) => ({ tag: String(ctx.node.properties?.[TAG] ?? '') }),
      run: (ctx, args) => withProperty(ctx, TAG, args.tag),
    },
  ],
};

let world: AppWorld;
beforeEach(async () => {
  world = await createAppWorld();
});
afterEach(async () => {
  cleanup();
  expect(world.unhandled).toEqual([]);
  await world.dispose();
});

/** 試験の module を登録して App を描き、node を 1 つ置く */
async function fileWithOneNode(modules: readonly NodeModule[] = [TEST_MODULE]) {
  await world.activate('solo');
  render(
    <NodeActionsProvider registry={createNodeActionRegistry(modules)}>
      <App />
    </NodeActionsProvider>,
  );
  const user = userEvent.setup();
  await createFile(user, 'node の操作');
  await addNode(user);
  await waitFor(() => expect(renderedNodeCount()).toBe(1), WIRING_TIMEOUT);
  return user;
}

/** node のそばの操作 */
const nodeBar = () => screen.queryByRole('toolbar', { name: 'node の操作' });

/** 正典の、最初の node の property */
function storedProperties() {
  const store = world.localStore();
  const fileId = store.listFiles()[0]?.id as FileId;
  const file = projectFile(store.getBatches(fileId), fileId);
  return file.sheets[0]?.nodes[0]?.properties ?? {};
}

describe('App 結合: node の操作 (計画 node-actions-request-module.md N2)', () => {
  test('選ぶと node のそばに使える操作が出て、押すと op-log に載り、使えなくなった操作は消える。undo で戻る', async () => {
    const user = await fileWithOneNode();
    expect(nodeBar()).toBeNull();
    selectFirstNode();
    const bar = await waitFor(() => {
      const found = nodeBar();
      if (!found) throw new Error('node のそばに操作が無い');
      return found;
    }, WIRING_TIMEOUT);
    expect(
      within(bar)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['印を付ける', '札を書く']);

    await user.click(within(bar).getByRole('button', { name: '印を付ける' }));
    await waitFor(
      () => expect(storedProperties()[MARK]).toBe(true),
      WIRING_TIMEOUT,
    );
    await waitFor(() =>
      expect(
        within(nodeBar() as HTMLElement).queryByRole('button', {
          name: '印を付ける',
        }),
      ).toBeNull(),
    );

    await user.click(
      within(screen.getByRole('toolbar', { name: 'グラフの操作' })).getByRole(
        'button',
        { name: '元に戻す' },
      ),
    );
    await waitFor(
      () => expect(storedProperties()[MARK]).toBeUndefined(),
      WIRING_TIMEOUT,
    );
  });

  test('引数の要る操作は dialog で決めて実行し、次に開くと前の値が入っている', async () => {
    const user = await fileWithOneNode();
    selectFirstNode();
    await user.click(
      await screen.findByRole('button', { name: '札を書く' }, WIRING_TIMEOUT),
    );
    const dialog = await screen.findByRole('dialog', { name: '札を書く' });
    await user.type(within(dialog).getByLabelText('札'), '急ぎ');
    await user.click(within(dialog).getByRole('button', { name: '実行' }));
    await waitFor(
      () => expect(storedProperties()[TAG]).toBe('急ぎ'),
      WIRING_TIMEOUT,
    );
    expect(screen.queryByRole('dialog', { name: '札を書く' })).toBeNull();

    await user.click(screen.getByRole('button', { name: '札を書く' }));
    const again = await screen.findByRole('dialog', { name: '札を書く' });
    expect((within(again).getByLabelText('札') as HTMLInputElement).value).toBe(
      '急ぎ',
    );
  });

  test('右クリックのメニューに同じ操作が出て、そこからも実行できる', async () => {
    const user = await fileWithOneNode();
    const node = document.querySelector('.react-flow__node') as Element;
    fireEvent.contextMenu(node);
    const menu = await screen.findByRole('menu', { name: 'node の操作' });
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((b) => b.textContent),
    ).toEqual(['印を付ける', '札を書く']);
    await user.click(
      within(menu).getByRole('menuitem', { name: '印を付ける' }),
    );
    await waitFor(
      () => expect(storedProperties()[MARK]).toBe(true),
      WIRING_TIMEOUT,
    );
    expect(screen.queryByRole('menu', { name: 'node の操作' })).toBeNull();
  });

  test('module が登録されていなければ、選んでも右クリックしても何も出ない', async () => {
    await fileWithOneNode([]);
    selectFirstNode();
    fireEvent.contextMenu(
      document.querySelector('.react-flow__node') as Element,
    );
    // 選択が画面に届くのを待ってから、出ていないことを見る
    await waitFor(() =>
      expect(
        document.querySelector('.react-flow__node.selected'),
      ).not.toBeNull(),
    );
    expect(nodeBar()).toBeNull();
    expect(screen.queryByRole('menu', { name: 'node の操作' })).toBeNull();
  });
});
