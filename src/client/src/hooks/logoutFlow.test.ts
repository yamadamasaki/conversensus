import { describe, expect, it, mock } from 'bun:test';
import {
  type LogoutFlowDeps,
  logoutFlow,
  logoutQuestion,
  OTHER_TABS_MESSAGE,
} from './logoutFlow';

function depsOf(answer: boolean, otherTabs = false) {
  const calls: string[] = [];
  const deps: LogoutFlowDeps = {
    unsent: null,
    askErase: mock(async () => answer),
    otherTabsOpen: async () => otherTabs,
    alert: mock(async (message: string) => void calls.push(`alert:${message}`)),
    logout: async () => void calls.push('logout'),
    requestErase: () => void calls.push('requestErase'),
    reload: () => void calls.push('reload'),
  };
  return { deps, calls };
}

describe('logoutFlow (#288)', () => {
  it('残すと答えたら、ログアウトだけして消さない', async () => {
    const { deps, calls } = depsOf(false);
    expect(await logoutFlow(deps)).toBe('kept');
    expect(calls).toEqual(['logout']);
  });

  it('消すと答えたら、ログアウトしてから印を付けて再読み込みする (この順で)', async () => {
    const { deps, calls } = depsOf(true);
    expect(await logoutFlow(deps)).toBe('erasing');
    expect(calls).toEqual(['logout', 'requestErase', 'reload']);
  });

  it('消すと答えても別のタブが開いていれば、知らせてログアウトもしない', async () => {
    const { deps, calls } = depsOf(true, true);
    expect(await logoutFlow(deps)).toBe('blockedByOtherTabs');
    expect(calls).toEqual([`alert:${OTHER_TABS_MESSAGE}`]);
  });

  it('残すなら別のタブは数えない', async () => {
    const { deps, calls } = depsOf(false, true);
    expect(await logoutFlow(deps)).toBe('kept');
    expect(calls).toEqual(['logout']);
  });
});

describe('logoutQuestion', () => {
  it('送っていない編集があれば、消すと失われることを件数つきで言う', () => {
    expect(logoutQuestion({ count: 3, overflowed: false })).toContain(
      'まだ送っていない編集が 3 件あります。消すと失われます。',
    );
    expect(logoutQuestion({ count: 100, overflowed: true })).toContain(
      '100 件以上',
    );
  });

  it('送っていない編集が無ければ (ログインしていない間も) 警告を出さない', () => {
    expect(logoutQuestion({ count: 0, overflowed: false })).not.toContain(
      '失われます',
    );
    expect(logoutQuestion(null)).not.toContain('失われます');
  });
});
