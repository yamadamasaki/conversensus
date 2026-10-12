import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import { AtprotoLoginDialog } from '../AtprotoLoginDialog';
import { CommitDialog } from '../CommitDialog';
import { ConfirmDialog } from '../ConfirmDialog';
import { ConflictNotice } from '../ConflictNotice';
import { GraphHeader } from '../GraphHeader';
import { NO_GROUP_ABILITY } from '../hooks/useGroupNodes';
import { LocalOnlyBanner } from '../LocalOnlyBanner';
import { NodeTypeMenu } from '../NodeTypeMenu';
import { OverwriteNotice } from '../OverwriteNotice';
import { ParticipateDialog } from '../ParticipateDialog';
import { PropertyEditor } from '../PropertyEditor';
import { RightSidebar } from '../RightSidebar';
import { SearchPanel } from '../SearchPanel';
import { SettingsPopup } from '../SettingsPopup';
import { StorageAtRiskBanner } from '../StorageAtRiskBanner';
import { Erased, StorageUnavailable } from '../StorageUnavailable';
import { SyncStatusIndicator } from '../SyncStatusIndicator';
import { TabBar } from '../TabBar';
import { formatTime, VersionTree } from '../timeline/VersionTree';
import { UpdateNotice } from '../update/UpdateNotice';
import { setLocale } from './locale';

/**
 * en で描くと英語の文言が出る (#50 i18n)。テストは ja に固定しているので、ここだけ en に替える。
 * 各部品の振舞いは部品ごとのテストが ja で見る。ここで見るのは「辞書から引いていること」である
 */
beforeEach(() => setLocale('en'));
afterEach(() => {
  cleanup();
  setLocale('ja');
});

const noop = () => {};

/**
 * 日本語の文字が描かれていないこと (言語の名前「日本語」は除く)。ダイアログなど `document.body` へ描く
 * 部品もあるので、渡された箱ではなくページ全体を見る
 */
function expectNoJapanese(_container?: HTMLElement) {
  const container = document.body;
  const text = (container.textContent ?? '').replace('日本語', '');
  const labels = [...container.querySelectorAll('[aria-label],[title]')]
    .map(
      (el) =>
        `${el.getAttribute('aria-label') ?? ''}${el.getAttribute('title') ?? ''}`,
    )
    .join(' ');
  expect(`${text} ${labels}`).not.toMatch(/[぀-ヿ一-鿿]/);
}

describe('en で描く (#50)', () => {
  test('ヘッダ', () => {
    const { container } = render(
      <GraphHeader
        controls={null}
        title={{ fileName: 'Research', sheetName: 'Sheet 1', merger: false }}
        groupAbility={NO_GROUP_ABILITY}
        searchOpen={false}
        onToggleSearch={noop}
        propertyOpen={false}
        onToggleProperty={noop}
        mapOpen
        onToggleMap={noop}
        branch={{
          name: 'b1',
          merged: false,
          pendingCount: 2,
          canMerge: false,
          onCommit: noop,
          onMerge: noop,
        }}
        onCopyLink={() => Promise.resolve()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy();
    expect(screen.getByText('2 changes')).toBeTruthy();
    expectNoJapanese(container);
  });

  test('右サイドバー', () => {
    const { container } = render(
      <RightSidebar
        selection={undefined}
        onSetProperty={noop}
        readOnly={false}
        pane="property"
        onPaneChange={noop}
        timeline={null}
      />,
    );
    expect(
      screen.getByText('Select an element to see its properties'),
    ).toBeTruthy();
    expectNoJapanese(container);
  });

  test('タブ', () => {
    const tab = {
      id: 't1',
      panes: [
        {
          fileId: 'f' as never,
          sheetId: 's' as never,
          branchId: null,
          cut: 'head' as const,
        },
      ],
      active: 0,
    };
    const { container } = render(
      <TabBar
        tabs={[tab]}
        activeId="t1"
        labelOf={() => 'Research / Sheet 1'}
        onActivate={noop}
        onClose={noop}
        hasNotice={() => true}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Close Research / Sheet 1' }),
    ).toBeTruthy();
    expectNoJapanese(container);
  });

  test('version tree', () => {
    const { container } = render(
      <VersionTree
        lanes={[{ branchId: null, name: 'trunk', status: null, entries: [] }]}
        currentLane={null}
        selected={null}
        onSelect={noop}
        labelOfActor={(a) => a}
        renderDetail={() => null}
      />,
    );
    expect(screen.getByRole('region', { name: 'trunk line' })).toBeTruthy();
    expectNoJapanese(container);
  });

  test('File の詳細', () => {
    const { container } = render(
      <SettingsPopup
        name="Research"
        description=""
        onSave={noop}
        onDelete={noop}
        onClose={noop}
        deleteLabel="Delete File"
        onExport={noop}
        onSaveToAccount={noop}
      />,
    );
    expect(screen.getByText('Save to account')).toBeTruthy();
    expectNoJapanese(container);
  });

  test('Sheet の検索', () => {
    const { container } = render(
      <SearchPanel
        onSearch={noop}
        hits={[]}
        searched={false}
        onReveal={noop}
        onClose={noop}
      />,
    );
    expect(screen.getByRole('button', { name: 'Close search' })).toBeTruthy();
    expectNoJapanese(container);
  });

  test('知らせの帯と同期の状態', () => {
    const { container } = render(
      <>
        <LocalOnlyBanner count={2} onLogin={noop} />
        <StorageAtRiskBanner count={1} signedIn={false} />
        <SyncStatusIndicator
          remoteQueue={null}
          onSyncNow={() => Promise.resolve()}
        />
      </>,
    );
    expect(screen.getByText(/2 edits exist only on this device/)).toBeTruthy();
    expectNoJapanese(container);
  });

  test('ダイアログ (ログイン・commit・確認・参加)', () => {
    const { container } = render(
      <>
        <AtprotoLoginDialog
          onLogin={() => Promise.resolve()}
          onCancel={noop}
          needsPassword
        />
        <CommitDialog changes={[]} onCommit={noop} onCancel={noop} />
        <ConfirmDialog message="Delete?" onConfirm={noop} onCancel={noop} />
        <ParticipateDialog onSubmit={noop} onCancel={noop} />
      </>,
    );
    expect(
      screen.getAllByRole('button', { name: 'Cancel' }).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText('No changes')).toBeTruthy();
    expectNoJapanese(container);
  });

  test('競合・上書き・新しい版の知らせ', () => {
    const target = 'n1';
    render(
      <>
        <ConflictNotice
          conflicts={[
            {
              target,
              category: 'content',
              ours: {
                batchId: 'b1',
                op: { kind: 'node.setContent', target, content: 'A' },
              },
              theirs: {
                batchId: 'b2',
                op: { kind: 'node.setContent', target, content: 'B' },
              },
            } as never,
          ]}
          labelOf={() => 'Claim'}
          forkCount={1}
          onClose={noop}
        />
        <OverwriteNotice
          reports={[
            { target, category: 'structure', by: 'did:plc:bob' } as never,
          ]}
          labelOf={() => 'Claim'}
          actorLabelOf={() => 'bob.test'}
          onDismiss={noop}
        />
        <UpdateNotice available onReload={noop} onDismiss={noop} />
      </>,
    );
    expect(screen.getByText('merge found 1 conflict')).toBeTruthy();
    expectNoJapanese();
  });

  test('node の作成メニューと property editor', () => {
    render(
      <>
        <NodeTypeMenu
          position={{ x: 0, y: 0 }}
          nodeKinds={[]}
          onSelect={noop}
          graphNodeOption
        />
        <PropertyEditor
          title="Claim"
          rows={[]}
          addable={[]}
          onSet={noop}
          onRemove={noop}
          onClose={noop}
        />
      </>,
    );
    expect(screen.getByText('No properties')).toBeTruthy();
    expectNoJapanese();
  });

  test('保存領域が開けない・データを消した', () => {
    render(
      <>
        <StorageUnavailable reason="SecurityError" />
        <Erased />
      </>,
    );
    expectNoJapanese();
  });

  test('timeline の時刻は en の書き方', () => {
    // 年をまたがない日時。en では「10/12, 01:45 AM」のように月/日で、日本語の「時」などは付かない
    expect(formatTime(Date.UTC(2026, 9, 12, 12, 0))).not.toMatch(/[぀-ヿ一-鿿]/);
  });
});
