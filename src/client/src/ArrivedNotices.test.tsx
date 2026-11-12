import { describe, expect, mock, test } from 'bun:test';
import type { Did, FileId, NodeId, SheetId } from '@conversensus/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import fc from 'fast-check';
import { ArrivedNotices, foldNotices, SHOWN_PER_FILE } from './ArrivedNotices';
import { capPerFile } from './hooks/useNoticeInbox';
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

describe('知らせの数の上限 (#393)', () => {
  const FILE_A = '11111111-1111-4111-8111-111111111111' as FileId;
  const FILE_B = '44444444-4444-4444-8444-444444444444' as FileId;
  const many = (count: number, fileId: FileId) =>
    Array.from({ length: count }, (_, i) => ({
      ...notice(`依頼 ${i}`),
      key: `${fileId}-${i}`,
      fileId,
    }));

  test('🔴 File ごとに上限まで出し、残りは「ほか n 件」に畳む', () => {
    renderNotices([...many(SHOWN_PER_FILE + 3, FILE_A), ...many(2, FILE_B)]);
    expect(screen.getAllByRole('listitem')).toHaveLength(SHOWN_PER_FILE + 2);
    expect(screen.getByText('ほか 3 件')).toBeTruthy();
  });

  test('上限に届かなければ畳まない', () => {
    renderNotices(many(SHOWN_PER_FILE, FILE_A));
    expect(screen.queryByText(/ほか/)).toBeNull();
  });

  test('(性質) 畳み: 出す数と畳む数の和は全体で、File ごとに出すのは上限まで・届いた順', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(FILE_A, FILE_B), { maxLength: 30 }),
        fc.integer({ min: 0, max: 6 }),
        (files, perFile) => {
          const notices = files.map((fileId, i) => ({
            ...notice(`n${i}`),
            key: `k${i}`,
            fileId,
          }));
          const { shown, hidden } = foldNotices(notices, perFile);
          expect(shown.length + hidden).toBe(notices.length);
          for (const f of [FILE_A, FILE_B]) {
            const ofFile = notices.filter((n) => n.fileId === f);
            expect(shown.filter((n) => n.fileId === f)).toEqual(
              ofFile.slice(0, perFile),
            );
          }
        },
      ),
    );
  });

  test('(性質) 溜める数: File ごとに新しい方から上限まで残す (届いた順のまま)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(FILE_A, FILE_B), { maxLength: 30 }),
        fc.integer({ min: 0, max: 6 }),
        (files, max) => {
          const notices = files.map((fileId, i) => ({
            ...notice(`n${i}`),
            key: `k${i}`,
            fileId,
          }));
          const kept = capPerFile(notices, max);
          for (const f of [FILE_A, FILE_B]) {
            const ofFile = notices.filter((n) => n.fileId === f);
            expect(kept.filter((n) => n.fileId === f)).toEqual(
              ofFile.slice(Math.max(0, ofFile.length - max)),
            );
          }
        },
      ),
    );
  });
});
