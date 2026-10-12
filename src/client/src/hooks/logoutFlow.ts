/**
 * ログアウトの手順 — この端末のデータも消すかを訊く (#288)
 *
 * 1. 「この端末のデータも消すか」を訊く。**既定は残す** (閉じる・Esc も残す)
 * 2. 消すなら、別の conversensus のタブが開いていないことを確かめる。開いていれば知らせて、
 *    ログアウトもしない (閉じてからやり直してもらう)
 * 3. ログアウトする
 * 4. 消すなら、印を付けて再読み込みする。消すのは次の起動の最初 (`local/eraseDevice.ts`)
 */

import { messages } from '../i18n/messages';

/** 消すと失われるもの。PDS へまだ送っていない編集 */
export type UnsentEdits = { count: number; overflowed: boolean };

export type LogoutFlowDeps = {
  unsent: UnsentEdits | null;
  /** 消すかを訊く。`true` なら消す */
  askErase: (message: string) => Promise<boolean>;
  otherTabsOpen: () => Promise<boolean>;
  alert: (message: string) => Promise<void>;
  logout: () => Promise<void>;
  requestErase: () => void;
  reload: () => void;
};

export function logoutQuestion(unsent: UnsentEdits | null): string {
  const t = messages().logout;
  const warning =
    unsent && unsent.count > 0 ? t.unsent(unsent.count, unsent.overflowed) : '';
  return t.question + warning;
}

export type LogoutOutcome = 'kept' | 'erasing' | 'blockedByOtherTabs';

export async function logoutFlow(deps: LogoutFlowDeps): Promise<LogoutOutcome> {
  const erase = await deps.askErase(logoutQuestion(deps.unsent));
  if (erase && (await deps.otherTabsOpen())) {
    await deps.alert(messages().logout.otherTabs);
    return 'blockedByOtherTabs';
  }
  await deps.logout();
  if (!erase) return 'kept';
  deps.requestErase();
  deps.reload();
  return 'erasing';
}
