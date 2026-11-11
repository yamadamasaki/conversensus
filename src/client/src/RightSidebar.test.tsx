import { afterEach, describe, expect, mock, test } from 'bun:test';
import type { NodeId } from '@conversensus/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { setShowReadOnlyProperties } from './property/readOnlyToggle';
import { RightSidebar, type RightSidebarPane } from './RightSidebar';

afterEach(() => {
  cleanup();
  setShowReadOnlyProperties(false);
});

function renderSidebar(pane: RightSidebarPane) {
  const onPaneChange = mock((_: RightSidebarPane) => {});
  render(
    <RightSidebar
      selection={undefined}
      onSetProperty={() => {}}
      readOnly={false}
      pane={pane}
      onPaneChange={onPaneChange}
      timeline={<p>timeline の中身</p>}
    />,
  );
  return onPaneChange;
}

describe('RightSidebar の切り替え (#73 Q1)', () => {
  test('property を出しているときは timeline の中身を出さない', () => {
    renderSidebar('property');
    expect(
      screen
        .getByRole('tab', { name: 'property' })
        .getAttribute('aria-selected'),
    ).toBe('true');
    expect(screen.queryByText('timeline の中身')).toBeNull();
  });

  test('timeline を出しているときは渡された中身を出す', () => {
    renderSidebar('timeline');
    expect(screen.getByText('timeline の中身')).toBeTruthy();
  });

  test('押せば切り替えを頼む', () => {
    const onPaneChange = renderSidebar('property');
    fireEvent.click(screen.getByRole('tab', { name: 'timeline' }));
    expect(onPaneChange).toHaveBeenCalledWith('timeline');
  });
});

describe('読み取り専用の property (#357)', () => {
  test('欄のトグルで、system と種別の行が出入りする', () => {
    render(
      <RightSidebar
        selection={{
          kind: 'node',
          id: '00000000-0000-4000-8000-000000000001' as NodeId,
          title: 'node',
          properties: {
            'app.conversensus.request.sent': 3,
            'template.x.kind': 'k',
            期限: '2026-11-11',
          },
          addable: [],
        }}
        onSetProperty={() => {}}
        readOnly={false}
        pane="property"
        onPaneChange={() => {}}
        timeline={null}
      />,
    );
    expect(screen.getByText('期限')).toBeTruthy();
    expect(screen.queryByText('app.conversensus.request.sent')).toBeNull();
    expect(screen.queryByText('template.x.kind')).toBeNull();

    fireEvent.click(screen.getByLabelText('読み取り専用も表示'));
    expect(screen.getByText('app.conversensus.request.sent')).toBeTruthy();
    expect(screen.getByText('template.x.kind')).toBeTruthy();
  });
});
