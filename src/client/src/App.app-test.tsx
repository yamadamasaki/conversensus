import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  type Batch,
  type Did,
  type FileId,
  projectFile,
} from '@conversensus/shared';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { NSID } from './atproto/types';
import { LOCAL_CHANGES_CHANNEL } from './local/localChanges';
import {
  addNode,
  branchLabel,
  commitBranch,
  createBranch,
  createFile,
  invite,
  login,
  mergeOpenBranch,
  openBranch,
  openFileNamed,
  participate,
  renderedNodeCount,
  syncNow,
  WIRING_TIMEOUT,
  waitForResumedSession,
} from './testing/appDriver';
import { type AppWorld, createAppWorld } from './testing/appWorld';
import type { FakeAccount } from './testing/fakePds';

const ALICE: FakeAccount = {
  did: 'did:plc:alice000000000000000000' as Did,
  handle: 'alice.test',
  password: 'alice-pw',
};
const BOB: FakeAccount = {
  did: 'did:plc:bob00000000000000000000' as Did,
  handle: 'bob.test',
  password: 'bob-pw',
};
const FILE_NAME = '共有ファイル';
/** 「何も起きないこと」を見る前に、描画と計測が落ち着くのを待つ時間 */
const SETTLE_MS = 500;
const BRANCH_NAME = 'b1';

let world: AppWorld;
/** 一度ログインした端末。2 回目からはセッションが復元される */
let signedInDevices: Set<string>;

beforeEach(async () => {
  world = await createAppWorld();
  signedInDevices = new Set();
  world.pds.addAccount(ALICE);
  world.pds.addAccount(BOB);
});

afterEach(async () => {
  cleanup();
  // 境界の外へ出ようとした通信は、どのテストでも 0 件でなければならない
  expect(world.unhandled).toEqual([]);
  await world.dispose();
});

/** 下部バーの「(N 変更)」 */
function pendingLabel(count: number): RegExp {
  return new RegExp(`\\(${count} 変更\\)`);
}

/** 端末を切り替えて App を描き、ログインした状態にする */
async function startOn(deviceName: string, account: FakeAccount) {
  cleanup();
  await world.activate(deviceName);
  render(<App />);
  const user = userEvent.setup();
  if (signedInDevices.has(deviceName)) {
    await waitForResumedSession(account);
  } else {
    await login(user, account);
    signedInDevices.add(deviceName);
  }
  return user;
}

/** alice が File を作って bob を招待し、bob が参加して File を開くまで */
async function aliceSharesFileWithBob(): Promise<{ code: string }> {
  const user = await startOn('alice', ALICE);
  await createFile(user, FILE_NAME);
  const code = await invite(user, BOB);
  await syncNow(user);
  return { code };
}

describe('App 結合: 受信した変更が画面まで届く (step2 T7-3 の実機の失敗)', () => {
  test('bob が branch を開いている間に届いた alice の編集が、canvas に描かれる', async () => {
    const { code } = await aliceSharesFileWithBob();

    // alice: branch を切って 1 つ目のノードを置き、送る
    let user = await startOn('alice', ALICE);
    await openFileNamed(user, FILE_NAME);
    await createBranch(user, BRANCH_NAME);
    await openBranch(user, BRANCH_NAME);
    await addNode(user);
    await waitFor(() => expect(renderedNodeCount()).toBe(1), WIRING_TIMEOUT);
    await syncNow(user);

    // alice: 2 つ目のノードは**まだ届かない**ように保留して送る
    world.pds.withhold(ALICE.did);
    await addNode(user);
    await waitFor(() => expect(renderedNodeCount()).toBe(2), WIRING_TIMEOUT);
    await syncNow(user);

    // bob: 参加して branch を開く。この時点で見えるのは 1 つ目だけ
    user = await startOn('bob', BOB);
    await participate(user, code, FILE_NAME);
    await syncNow(user);
    await openBranch(user, BRANCH_NAME);
    await waitFor(() => expect(renderedNodeCount()).toBe(1), WIRING_TIMEOUT);

    // 2 つ目が届く。bob は branch を開いたまま同期する
    world.pds.release(ALICE.did);
    await syncNow(user);

    // **op-log に入るだけでなく、画面に描かれること**。step2 ではここが
    // 「op-log は正しいのに画面が古い」で落ちていた (GraphEditor の再 seed の契機が無かった)
    await waitFor(() => expect(renderedNodeCount()).toBe(2), WIRING_TIMEOUT);
  });

  test('bob が trunk を開いている間に alice が切った branch が、サイドバーの一覧に出る', async () => {
    const { code } = await aliceSharesFileWithBob();

    // alice: branch を切るが、まだ届かないように保留する
    let user = await startOn('alice', ALICE);
    await openFileNamed(user, FILE_NAME);
    world.pds.withhold(ALICE.did);
    await createBranch(user, BRANCH_NAME);
    await syncNow(user);

    // bob: 参加して trunk を開いている。branch はまだ無い
    user = await startOn('bob', BOB);
    await participate(user, code, FILE_NAME);
    await syncNow(user);
    expect(screen.queryByText(branchLabel(BRANCH_NAME))).toBeNull();

    // branch が届く。**シートを切り替えずに**一覧に出ること。step2 では一覧を
    // シートの切り替えでしか読み直しておらず、受信では出なかった
    world.pds.release(ALICE.did);
    await syncNow(user);
    await screen.findByText(branchLabel(BRANCH_NAME), {}, WIRING_TIMEOUT);
  });
});

describe('App 結合: canvas の編集が「(N 変更)」に数えられる (step2 T7-7 の実機の失敗)', () => {
  /** 1 端末・未ログインで File と branch を作り、その branch を開く */
  async function openFreshBranch() {
    await world.activate('solo');
    render(<App />);
    const user = userEvent.setup();
    await createFile(user, FILE_NAME);
    await createBranch(user, BRANCH_NAME);
    await openBranch(user, BRANCH_NAME);
    return user;
  }

  test('branch を開いた直後に置いたノードも、変更として数えられる', async () => {
    const user = await openFreshBranch();

    // **開いてすぐ置く。**以前は再 seed の後 150ms の間 canvas の変化を時間で捨てていたので、
    // ノードは描かれるのに activeFile に届かず、コミットできなかった
    await addNode(user);

    await waitFor(() => expect(renderedNodeCount()).toBe(1), WIRING_TIMEOUT);
    await screen.findByText(pendingLabel(1), {}, WIRING_TIMEOUT);
  });

  test('branch を開いただけでは、変更は数えられない', async () => {
    await openFreshBranch();

    // 寸法の計測や差分の色で canvas の nodes/edges は変わるが、中身は変わらない。
    // 描画が落ち着くまで待ってから、変更が 0 のままであることを見る
    await waitFor(
      () => expect(document.querySelector('.react-flow__pane')).not.toBeNull(),
      WIRING_TIMEOUT,
    );
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    expect(screen.queryByText(/変更\)/)).toBeNull();
    expect(screen.getByRole('button', { name: 'コミット' })).toHaveProperty(
      'disabled',
      true,
    );
  });
});

describe('App 結合: 因果の点が端末をまたいで載る (step3 Phase 1)', () => {
  /** PDS に届いた batch レコード (v2) の本文 */
  type StoredBatch = {
    actor: string;
    seq: number;
    deps: Record<string, number>;
  };
  const storedBatches = (did: Did) =>
    world.pds.records(did, NSID.batch).map((r) => r.value as StoredBatch);

  test('bob が開いている間に届いた alice の編集は、bob が次に書く batch の deps に入る', async () => {
    const { code } = await aliceSharesFileWithBob();
    // alice の編集は、bob の tap が復元を済ませた**後**に届くよう保留する。復元より前に
    // 届くと、手元のログからの復元で知識に入ってしまい、受信の経路を検証できない
    let user = await startOn('alice', ALICE);
    await openFileNamed(user, FILE_NAME);
    world.pds.withhold(ALICE.did);
    await addNode(user);
    await waitFor(() => expect(renderedNodeCount()).toBe(1), WIRING_TIMEOUT);
    await syncNow(user);

    user = await startOn('bob', BOB);
    await participate(user, code, FILE_NAME);
    await syncNow(user);
    // tap の復元は最初に書いたときに走る。ここで 1 つ書いて済ませておく
    await addNode(user);
    await waitFor(() => expect(renderedNodeCount()).toBe(1), WIRING_TIMEOUT);
    await syncNow(user);

    world.pds.release(ALICE.did);
    const aliceActor = storedBatches(ALICE.did).find(
      (b) => b.actor !== 'genesis',
    )?.actor;
    const aliceMaxSeq = Math.max(
      ...storedBatches(ALICE.did)
        .filter((b) => b.actor === aliceActor)
        .map((b) => b.seq),
    );
    await syncNow(user);
    await waitFor(() => expect(renderedNodeCount()).toBe(2), WIRING_TIMEOUT);
    await addNode(user);
    await waitFor(() => expect(renderedNodeCount()).toBe(3), WIRING_TIMEOUT);
    await syncNow(user);

    const bobLatest = storedBatches(BOB.did)
      .filter((b) => b.actor.startsWith(BOB.did))
      .sort((a, b) => a.seq - b.seq)
      .at(-1);
    if (!aliceActor || !bobLatest) throw new Error('batch が PDS に無い');
    expect(bobLatest.deps[aliceActor]).toBeGreaterThanOrEqual(aliceMaxSeq);
  });

  test('trunk と branch で書いた点は、同じ連番から重複なく振られる', async () => {
    const user = await startOn('alice', ALICE);
    await createFile(user, FILE_NAME);
    await addNode(user);
    await waitFor(() => expect(renderedNodeCount()).toBe(1), WIRING_TIMEOUT);
    await createBranch(user, BRANCH_NAME);
    await openBranch(user, BRANCH_NAME);
    await addNode(user);
    await waitFor(() => expect(renderedNodeCount()).toBe(2), WIRING_TIMEOUT);
    await syncNow(user);

    // trunk の batch も branch の batch も同じ collection に載る (fileId が違うだけ)
    const seqs = storedBatches(ALICE.did)
      .filter((b) => b.actor.startsWith(ALICE.did))
      .map((b) => b.seq)
      .sort((a, b) => a - b);
    expect(seqs.length).toBeGreaterThan(2);
    // **同じ点を 2 回使っていない。**別々の発番器だと trunk と branch がそれぞれ 1 から振る
    expect(new Set(seqs).size).toBe(seqs.length);
  });
});

describe('App 結合: 同じ branch を 2 人が並行に merge しても収束する (step3 Phase 1 S1-4)', () => {
  test('写しが 2 組できても、両者の画面は同じグラフになる', async () => {
    const { code } = await aliceSharesFileWithBob();

    // alice: branch を切ってノードを置き、コミットして送る
    let user = await startOn('alice', ALICE);
    await openFileNamed(user, FILE_NAME);
    await createBranch(user, BRANCH_NAME);
    await openBranch(user, BRANCH_NAME);
    await addNode(user);
    await waitFor(() => expect(renderedNodeCount()).toBe(1), WIRING_TIMEOUT);
    await commitBranch(user, '案');
    await syncNow(user);

    // bob: 参加して同じ branch を開き、merge する。まだ届かないよう保留する
    user = await startOn('bob', BOB);
    await participate(user, code, FILE_NAME);
    await syncNow(user);
    await openBranch(user, BRANCH_NAME);
    await waitFor(() => expect(renderedNodeCount()).toBe(1), WIRING_TIMEOUT);
    world.pds.withhold(BOB.did);
    await mergeOpenBranch(user, 'bob が取り込む');
    await syncNow(user);

    // alice: bob の merge を知らずに、同じ branch を merge する
    user = await startOn('alice', ALICE);
    await openFileNamed(user, FILE_NAME);
    await openBranch(user, BRANCH_NAME);
    await mergeOpenBranch(user, 'alice が取り込む');
    await syncNow(user);

    // 互いの merge が届く。写しは 2 組あるが、畳み込みは同じ元の写しを 1 つだけ採る
    world.pds.release(BOB.did);
    await syncNow(user);
    await openFileNamed(user, FILE_NAME);
    await waitFor(() => expect(renderedNodeCount()).toBe(1), WIRING_TIMEOUT);

    user = await startOn('bob', BOB);
    await syncNow(user);
    await openFileNamed(user, FILE_NAME);
    await waitFor(() => expect(renderedNodeCount()).toBe(1), WIRING_TIMEOUT);

    // PDS には写しが 2 組ある (両方とも書かれている) ことを確かめておく — 重複除去が
    // 無ければ、ここで同じ編集が二重に畳まれる
    const copies = [ALICE.did, BOB.did].flatMap((did) =>
      world.pds
        .records(did, NSID.batch)
        .map((r) => r.value as { copyOf?: { actor: string; seq: number } })
        .filter((v) => v.copyOf),
    );
    const origins = new Set(
      copies.map((v) => `${v.copyOf?.actor}#${v.copyOf?.seq}`),
    );
    expect(copies.length).toBe(origins.size * 2);
  });
});

describe('App 結合: 同じブラウザの別のタブの書き込み (step3 Phase 2 S2-4)', () => {
  /**
   * 別のタブは、同じ DB に別の actor (= 別の deviceId, D4) で書き、BroadcastChannel で知らせる。
   * ここでは**別のタブの書き込みを直接 DB に入れ、知らせを送る**ことで再現する — 同じ
   * プロセスに App を 2 つは立てられないので (`appWorld` の注)
   */
  test('🔴 別のタブの編集は画面に出て、次に書く batch の deps に入る', async () => {
    const user = await startOn('alice', ALICE);
    await createFile(user, FILE_NAME);
    // tap の因果の復元は最初の書き込みで走る。先に済ませ、別のタブの点が復元ではなく
    // **知らせの経路**で知識に入ることを見る
    await addNode(user);
    await waitFor(() => expect(renderedNodeCount()).toBe(1), WIRING_TIMEOUT);

    const store = world.localStore();
    const fileId = store.listFiles()[0]?.id as FileId;
    const sheetId = projectFile(store.getBatches(fileId), fileId).sheets[0]?.id;
    const otherTab = `${ALICE.did}#other-tab`;
    const fromOtherTab: Batch = {
      id: crypto.randomUUID() as Batch['id'],
      actor: otherTab,
      clock: 1000,
      seq: 7,
      deps: {},
      timestamp: Date.now(),
      sheetId,
      ops: [
        {
          kind: 'node.add',
          target: crypto.randomUUID() as never,
          content: '別のタブ',
        },
      ],
    };
    store.appendBatches(fileId, [fromOtherTab]);
    const channel = new BroadcastChannel(LOCAL_CHANGES_CHANNEL);
    channel.postMessage({ fileId });
    channel.close();

    await waitFor(() => expect(renderedNodeCount()).toBe(2), WIRING_TIMEOUT);

    await addNode(user);
    await waitFor(() => expect(renderedNodeCount()).toBe(3), WIRING_TIMEOUT);
    // **見た上で書いた**ので、deps に別のタブの点が入る。入らないと並行と判定され、
    // 同じものを触れば偽の競合になる (step3 Phase 1 D4)
    await waitFor(() => {
      const mine = store
        .getBatches(fileId)
        .filter((b) => b.actor.startsWith(ALICE.did) && b.actor !== otherTab)
        .sort((a, b) => a.seq - b.seq)
        .at(-1);
      expect(mine?.deps[otherTab]).toBe(7);
    }, WIRING_TIMEOUT);
  });
});

/**
 * step3 Phase 3 S3-2 の網。branch を開くと、以前は `activeFile` のシートを branch の中身で
 * 差し替え、trunk を退避して戻るときに復元していた (設計 F1)。S3-2 でこの「化け」を撤去する
 * ので、**撤去の前に**、それが守っていた振る舞いを画面の側から固定しておく
 */
describe('App 結合: branch の出入りで trunk と branch が混ざらない (step3 Phase 3 S3-2)', () => {
  const TRUNK_SHEET = 'Sheet 1';

  /** 1 端末・未ログインで File と branch を作り、branch を開いてノードを 1 つ置く */
  async function branchWithOneNode() {
    await world.activate('solo');
    render(<App />);
    const user = userEvent.setup();
    await createFile(user, FILE_NAME);
    await createBranch(user, BRANCH_NAME);
    await openBranch(user, BRANCH_NAME);
    await addNode(user);
    await waitFor(() => expect(renderedNodeCount()).toBe(1), WIRING_TIMEOUT);
    return user;
  }

  test('trunk に戻ると branch のノードは出ず、branch を開き直すと出る', async () => {
    const user = await branchWithOneNode();

    await user.click(screen.getByRole('button', { name: TRUNK_SHEET }));
    await waitFor(() => expect(renderedNodeCount()).toBe(0), WIRING_TIMEOUT);

    await openBranch(user, BRANCH_NAME);
    await waitFor(() => expect(renderedNodeCount()).toBe(1), WIRING_TIMEOUT);
  });

  test('branch を開いたままシートを足しても、branch の中身は trunk に移らない', async () => {
    const user = await branchWithOneNode();

    await user.click(screen.getByText('+ シートを追加'));
    await screen.findByRole('button', { name: 'Sheet 2' }, WIRING_TIMEOUT);
    await waitFor(() => expect(renderedNodeCount()).toBe(0), WIRING_TIMEOUT);

    // 元のシートの trunk にも出ない (画面と op-log の両方)
    await user.click(screen.getByRole('button', { name: TRUNK_SHEET }));
    await waitFor(() => expect(renderedNodeCount()).toBe(0), WIRING_TIMEOUT);
    const fileId = world.localStore().listFiles()[0]?.id as FileId;
    const trunk = projectFile(world.localStore().getBatches(fileId), fileId);
    expect(trunk.sheets.map((s) => s.nodes.length)).toEqual([0, 0]);
  });

  test('branch を開いている間に届いた trunk の編集は、trunk に戻ると見える', async () => {
    const { code } = await aliceSharesFileWithBob();

    // bob: 参加して branch を切り、開いておく
    let user = await startOn('bob', BOB);
    await participate(user, code, FILE_NAME);
    await syncNow(user);
    await createBranch(user, BRANCH_NAME);
    await openBranch(user, BRANCH_NAME);
    await syncNow(user);

    // alice: trunk にノードを置いて送る
    user = await startOn('alice', ALICE);
    await openFileNamed(user, FILE_NAME);
    await addNode(user);
    await waitFor(() => expect(renderedNodeCount()).toBe(1), WIRING_TIMEOUT);
    await syncNow(user);

    // bob: branch を開いたまま受信し、branch には出ない
    user = await startOn('bob', BOB);
    await openFileNamed(user, FILE_NAME);
    await openBranch(user, BRANCH_NAME);
    await syncNow(user);
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    expect(renderedNodeCount()).toBe(0);

    // trunk に戻ると見える (以前は戻り先の控えを受信で入れ直す必要があった)
    await user.click(screen.getByRole('button', { name: TRUNK_SHEET }));
    await waitFor(() => expect(renderedNodeCount()).toBe(1), WIRING_TIMEOUT);
  });
});

describe('App 結合: タブ (step3 Phase 3 S3-3)', () => {
  /** タブの帯の並び (名前) */
  const tabLabels = () =>
    screen.queryAllByRole('tab').map((t) => t.textContent ?? '');
  const selectedTab = () =>
    screen
      .getAllByRole('tab')
      .find((t) => t.getAttribute('aria-selected') === 'true');

  /**
   * 1 端末・未ログインで File を作り、Sheet 1 に 1 つ、branch b1 に 2 つ置く。
   * タブは Sheet 1 (trunk) と b1 の 2 枚になる
   */
  async function fileWithTrunkAndBranch() {
    await world.activate('solo');
    render(<App />);
    const user = userEvent.setup();
    await createFile(user, FILE_NAME);
    await addNode(user);
    await waitFor(() => expect(renderedNodeCount()).toBe(1), WIRING_TIMEOUT);
    await createBranch(user, BRANCH_NAME);
    await openBranch(user, BRANCH_NAME);
    await addNode(user);
    await waitFor(() => expect(renderedNodeCount()).toBe(2), WIRING_TIMEOUT);
    return user;
  }

  test('シートと branch はそれぞれのタブで開き、タブを切り替えるとその中身が出る', async () => {
    const user = await fileWithTrunkAndBranch();
    expect(tabLabels()).toEqual([
      `${FILE_NAME} / Sheet 1`,
      `${FILE_NAME} / Sheet 1 (⎇ ${BRANCH_NAME})`,
    ]);

    await user.click(
      screen.getByRole('tab', { name: `${FILE_NAME} / Sheet 1` }),
    );
    await waitFor(() => expect(renderedNodeCount()).toBe(1), WIRING_TIMEOUT);
    await user.click(
      screen.getByRole('tab', {
        name: `${FILE_NAME} / Sheet 1 (⎇ ${BRANCH_NAME})`,
      }),
    );
    await waitFor(() => expect(renderedNodeCount()).toBe(2), WIRING_TIMEOUT);
  });

  test('既に開いているアドレスをサイドバーから開くと、そのタブへ移る (Q2)', async () => {
    const user = await fileWithTrunkAndBranch();

    await user.click(screen.getByRole('button', { name: 'Sheet 1' }));
    await waitFor(() => expect(renderedNodeCount()).toBe(1), WIRING_TIMEOUT);
    expect(tabLabels()).toHaveLength(2);
    expect(selectedTab()?.textContent).toBe(`${FILE_NAME} / Sheet 1`);
  });

  test('タブを閉じると隣のタブの中身が出る', async () => {
    const user = await fileWithTrunkAndBranch();

    await user.click(
      screen.getByRole('button', {
        name: `${FILE_NAME} / Sheet 1 (⎇ ${BRANCH_NAME}) を閉じる`,
      }),
    );
    await waitFor(() => expect(renderedNodeCount()).toBe(1), WIRING_TIMEOUT);
    expect(tabLabels()).toEqual([`${FILE_NAME} / Sheet 1`]);
  });

  test('再読み込みしてもタブが並び、アクティブなタブ (branch) の中身が出る (Q3)', async () => {
    await fileWithTrunkAndBranch();

    cleanup();
    await world.activate('solo');
    render(<App />);
    await waitFor(() => expect(renderedNodeCount()).toBe(2), WIRING_TIMEOUT);
    await screen.findByRole('button', { name: 'コミット' }, WIRING_TIMEOUT);
    expect(tabLabels()).toHaveLength(2);
  });

  test('別の File を作ると新しいタブで開き、元の File のタブへ戻れる', async () => {
    const user = await fileWithTrunkAndBranch();
    const OTHER = '別のファイル';

    await createFile(user, OTHER);
    await waitFor(() => expect(renderedNodeCount()).toBe(0), WIRING_TIMEOUT);
    expect(tabLabels()).toEqual([
      `${FILE_NAME} / Sheet 1`,
      `${FILE_NAME} / Sheet 1 (⎇ ${BRANCH_NAME})`,
      `${OTHER} / Sheet 1`,
    ]);

    await user.click(
      screen.getByRole('tab', { name: `${FILE_NAME} / Sheet 1` }),
    );
    await waitFor(() => expect(renderedNodeCount()).toBe(1), WIRING_TIMEOUT);
  });

  test('背後のタブの File も同期を続け、切り替えたときには届いている (Q4)', async () => {
    const OTHER = '別のファイル';
    const { code } = await aliceSharesFileWithBob();

    // bob: 参加し、自分の File も作る。共有の File のタブは背後に回る
    let user = await startOn('bob', BOB);
    await participate(user, code, FILE_NAME);
    await syncNow(user);
    await createFile(user, OTHER);

    // alice: 共有の File にノードを置いて送る
    user = await startOn('alice', ALICE);
    await openFileNamed(user, FILE_NAME);
    await addNode(user);
    await waitFor(() => expect(renderedNodeCount()).toBe(1), WIRING_TIMEOUT);
    await syncNow(user);

    // bob: 自分の File を前に出したまま同期する
    user = await startOn('bob', BOB);
    await waitFor(
      () => expect(selectedTab()?.textContent).toStartWith(OTHER),
      WIRING_TIMEOUT,
    );
    await syncNow(user);

    // **切り替える前に**手元の正典に入っている (開いたときの同期で取りに行ったのではない)
    const shared = world
      .localStore()
      .listFiles()
      .find((f) => f.name === FILE_NAME)?.id as FileId;
    await waitFor(() => {
      const trunk = projectFile(world.localStore().getBatches(shared), shared);
      expect(trunk.sheets[0]?.nodes).toHaveLength(1);
    }, WIRING_TIMEOUT);

    await user.click(
      screen.getByRole('tab', { name: new RegExp(`^${FILE_NAME}`) }),
    );
    await waitFor(() => expect(renderedNodeCount()).toBe(1), WIRING_TIMEOUT);
  });
});
