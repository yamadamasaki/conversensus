import { afterEach, describe, expect, test } from 'bun:test';
import type { AgentDeclaration, Did } from '@conversensus/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  AuthorAvatars,
  colorOfDid,
  initialOf,
  MAX_STACKED,
} from './AuthorAvatars';
import { AuthorsProvider, type AuthorsView } from './authorsContext';

afterEach(cleanup);

const NODE = 'node-1';
const ALICE = 'did:plc:alice' as Did;
const BOB = 'did:plc:bob' as Did;
const CAROL = 'did:plc:carol' as Did;
const DAVE = 'did:plc:dave' as Did;
const AGENT = 'did:plc:agent' as Did;
const HANDLE: Record<string, string> = {
  [ALICE]: 'alice.test',
  [BOB]: 'bob.test',
  [CAROL]: 'carol.test',
  [DAVE]: 'dave.test',
  [AGENT]: 'agent.test',
};

function view(
  authors: readonly Did[],
  agents: Record<string, AgentDeclaration> = {},
): AuthorsView {
  return {
    authorsOf: (id) => (id === NODE ? authors : []),
    labelOf: (did) => HANDLE[did] ?? did,
    agentOf: (did) => agents[did],
  };
}

function renderWith(value: AuthorsView | null) {
  return render(
    <AuthorsProvider value={value}>
      <AuthorAvatars elementId={NODE} />
    </AuthorsProvider>,
  );
}

const group = () => screen.getByRole('group');

describe('AuthorAvatars', () => {
  test('作者の頭文字を順に出し、読み上げには全員の名前を並べる', () => {
    renderWith(view([ALICE, BOB]));
    expect(group().getAttribute('aria-label')).toBe(
      '書いた人: alice.test, bob.test',
    );
    expect(group().textContent).toBe('AB');
  });

  test(`${MAX_STACKED} 人を超える分は「+n」にし、hover で広げてハンドル名を並べる。離れると重ねに戻す`, () => {
    renderWith(view([ALICE, BOB, CAROL, DAVE]));
    expect(group().textContent).toBe(`ABC+${4 - MAX_STACKED}`);
    fireEvent.pointerEnter(group());
    for (const name of ['alice.test', 'bob.test', 'carol.test', 'dave.test']) {
      expect(group().textContent).toContain(name);
    }
    fireEvent.pointerLeave(group());
    expect(group().textContent).toBe(`ABC+${4 - MAX_STACKED}`);
  });

  test('agent は頭文字の代わりに bot の印。裏付けありと名乗りのみを見分け、名前にも添える', () => {
    renderWith(
      view([ALICE, AGENT], {
        [AGENT]: { status: 'verified', operator: ALICE },
      }),
    );
    expect(
      document
        .querySelector('[data-avatar-agent]')
        ?.getAttribute('data-avatar-agent'),
    ).toBe('verified');
    expect(group().getAttribute('aria-label')).toContain(
      'agent.test (agent・裏付けあり)',
    );
    cleanup();
    renderWith(
      view([AGENT], { [AGENT]: { status: 'claimed', operator: ALICE } }),
    );
    expect(group().getAttribute('aria-label')).toContain('名乗りのみ');
  });

  test('作者がいない・表示が off (context が無い) なら何も描かない', () => {
    const { container } = renderWith(view([]));
    expect(container.innerHTML).toBe('');
    cleanup();
    const off = renderWith(null);
    expect(off.container.innerHTML).toBe('');
  });

  test('色は DID で決まり (同じ人は同じ色)、頭文字は DID のままでも読める字にする', () => {
    expect(colorOfDid(ALICE)).toBe(colorOfDid(ALICE));
    expect(colorOfDid(ALICE)).not.toBe(colorOfDid(BOB));
    expect(initialOf('alice.test')).toBe('A');
    expect(initialOf('did:plc:zed')).toBe('Z');
    expect(initialOf('')).toBe('?');
  });
});
