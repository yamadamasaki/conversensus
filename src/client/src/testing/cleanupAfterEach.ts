/**
 * 描いたものを毎回片付ける (#265)。bun の preload (`bunfig.toml`) から読む
 *
 * Testing Library の自動の後片付けは、テストの関数がグローバルにあるときだけ効くが、bun では
 * `afterEach` を import して使うので効かない。片付けを書き忘れたファイルが描いたダイアログが
 * `document.body` に残り、順序が変わると後のテストが「同じ名前のボタンが 2 つ」で落ちていた
 * (`bun test --randomize`)。
 *
 * client の側に置くのは、`@testing-library/react` が client のパッケージにしか無いから
 * (リポジトリの根の preload からは解決できない)
 */

import { afterEach } from 'bun:test';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
