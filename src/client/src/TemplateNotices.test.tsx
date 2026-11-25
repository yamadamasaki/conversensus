import { describe, expect, mock, test } from 'bun:test';
import {
  type FileId,
  type SheetId,
  TEMPLATE_VERSION,
} from '@conversensus/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TemplateNotice } from './notices/templateNotices';
import { TemplateNotices } from './TemplateNotices';

const FILE = '11111111-1111-4111-8111-111111111111' as FileId;
const SHEET = '22222222-2222-4222-8222-222222222222' as SheetId;
const TEMPLATE = '33333333-3333-4333-8333-333333333333' as SheetId;

const newer: TemplateNotice = {
  key: 'k-newer',
  fileId: FILE,
  sheet: SHEET,
  template: TEMPLATE,
  version: TEMPLATE_VERSION.NEWER,
  templateName: '議論の型',
};
const deleted: TemplateNotice = {
  ...newer,
  key: 'k-deleted',
  version: TEMPLATE_VERSION.DELETED,
};

function renderNotices(
  notices: readonly TemplateNotice[],
  handlers: {
    onPull?: (n: TemplateNotice) => void;
    onDismiss?: (n: TemplateNotice) => void;
  } = {},
) {
  return render(
    <TemplateNotices
      notices={notices}
      sheetNameOf={() => 'Sheet 2'}
      onPull={handlers.onPull ?? (() => {})}
      onDismiss={handlers.onDismiss ?? (() => {})}
    />,
  );
}

describe('TemplateNotices (template-update D3)', () => {
  test('通知が無ければ何も描かない', () => {
    const { container } = renderNotices([]);
    expect(container.innerHTML).toBe('');
  });

  test('新しい版は「最新の版にする」で pull し、× で閉じる', async () => {
    const onPull = mock((_n: TemplateNotice) => {});
    const onDismiss = mock((_n: TemplateNotice) => {});
    renderNotices([newer], { onPull, onDismiss });
    const region = screen.getByRole('status', { name: 'template の版' });
    expect(region.textContent).toContain(
      '「Sheet 2」に当てた「議論の型」に新しい版があります',
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '最新の版にする' }));
    expect(onPull.mock.calls[0]?.[0]).toBe(newer);
    await user.click(
      screen.getByRole('button', {
        name: '「Sheet 2」の「議論の型」の知らせを閉じる',
      }),
    );
    expect(onDismiss.mock.calls[0]?.[0]).toBe(newer);
  });

  test('削除は閉じるだけで、pull の入口は無い。名前を読めなければ「template」と出す', () => {
    const { templateName: _, ...unnamed } = deleted;
    renderNotices([unnamed]);
    expect(screen.getByRole('status').textContent).toContain(
      '「Sheet 2」に当てた「template」は削除されました',
    );
    expect(
      screen.queryByRole('button', { name: '最新の版にする' }) === null,
    ).toBe(true);
  });
});
