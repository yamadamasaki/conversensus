import { afterEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RightSidebar, type RightSidebarPane } from './RightSidebar';

afterEach(cleanup);

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
