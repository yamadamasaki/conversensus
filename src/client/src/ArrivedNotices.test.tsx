import { describe, expect, mock, test } from 'bun:test';
import type { Did, FileId, NodeId, SheetId } from '@conversensus/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ArrivedNotices } from './ArrivedNotices';
import type { NodeModule } from './nodeActions/nodeAction';
import {
  type ArrivedNotice,
  createNodeActionRegistry,
} from './nodeActions/registry';
import { NodeActionsProvider } from './nodeActions/registryContext';

/** 試験の module: 知らせの欄の名前と見出しだけを持つ (見つけるのは使わない) */
const TEST_MODULE: NodeModule = {
  id: 'ask',
  actions: [],
  notices: {
    region: { ja: '届いた問い', en: 'Questions' },
    heading: (from) => ({ ja: `${from} から問い`, en: `${from} asks` }),
    detect: () => [],
  },
};
const registry = createNodeActionRegistry([TEST_MODULE]);

const notice = (content: string, moduleId = 'ask'): ArrivedNotice => ({
  moduleId,
  key: 'n1',
  fileId: '11111111-1111-4111-8111-111111111111' as FileId,
  sheetId: '22222222-2222-4222-8222-222222222222' as SheetId,
  nodeId: '33333333-3333-4333-8333-333333333333' as NodeId,
  content,
  from: 'did:plc:alice' as Did,
});
const labelOf = (did: Did) => (did === 'did:plc:alice' ? 'alice.test' : did);

function renderNotices(
  notices: readonly ArrivedNotice[],
  handlers: {
    onOpen?: (n: ArrivedNotice) => void;
    onDismiss?: (n: ArrivedNotice) => void;
  } = {},
) {
  return render(
    <NodeActionsProvider registry={registry}>
      <ArrivedNotices
        notices={notices}
        labelOf={labelOf}
        onOpen={handlers.onOpen ?? (() => {})}
        onDismiss={handlers.onDismiss ?? (() => {})}
      />
    </NodeActionsProvider>,
  );
}

describe('ArrivedNotices', () => {
  test('届いていなければ何も描かない', () => {
    const { container } = renderNotices([]);
    expect(container.innerHTML).toBe('');
  });

  test('module の欄の名前と見出し (送り手のハンドル名) と本文の抜粋を出し、長い本文は切る', () => {
    renderNotices([notice(`この章を\n${'あ'.repeat(100)}`)]);
    const region = screen.getByRole('status', { name: '届いた問い' });
    expect(region.textContent).toContain('alice.test から問い');
    expect(region.textContent).toContain('…');
  });

  test('登録されていない module の知らせは出さない', () => {
    const { container } = renderNotices([notice('x', 'gone')]);
    expect(container.innerHTML).toBe('');
  });

  test('開く・閉じるは、その知らせを渡す', async () => {
    const onOpen = mock((_: ArrivedNotice) => {});
    const onDismiss = mock((_: ArrivedNotice) => {});
    const n = notice('要約して');
    renderNotices([n], { onOpen, onDismiss });
    await userEvent.click(screen.getByRole('button', { name: '開く' }));
    expect(onOpen).toHaveBeenLastCalledWith(n);
    await userEvent.click(
      screen.getByRole('button', { name: 'alice.test からの知らせを閉じる' }),
    );
    expect(onDismiss).toHaveBeenLastCalledWith(n);
  });
});
