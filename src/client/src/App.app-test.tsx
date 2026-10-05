import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  type Batch,
  type Did,
  type FileId,
  kindPropertyOf,
  type NodeId,
  projectFile,
  sheetKindOf,
  TEMPLATE_SHEET_KIND,
  templateIdOf,
} from '@conversensus/shared';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { NSID } from './atproto/types';
import { LOCAL_CHANGES_CHANNEL } from './local/localChanges';
import { noticeCacheKey } from './notices/noticeCache';
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
  selectFirstNode,
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
/** 未ログインの端末の DID (別のタブの actor を作るのに使う) */
const LOCAL_TEST_ACTOR = 'local';
/** 「何も起きないこと」を見る前に、描画と計測が落ち着くのを待つ時間 */
const SETTLE_MS = 500;
/**
 * merger の件の時間の上限。File・branch・コミット・merge を画面の操作で積むので手数が多く、既定の
 * 5 秒では足りない (失敗ではなく時間切れになる)
 */
const MERGER_TEST_MS = 15_000;
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
    // ふつうのシートだけを見る (index は sheet の一覧を graph node として持つ, step3 Phase 4)
    expect(
      trunk.sheets
        .filter((s) => sheetKindOf(s) === undefined)
        .map((s) => s.nodes.length),
    ).toEqual([0, 0]);
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

describe('App 結合: ヘッダ (step3 Phase 3 S3-4a)', () => {
  async function soloFileWithOneNode() {
    await world.activate('solo');
    render(<App />);
    const user = userEvent.setup();
    await createFile(user, FILE_NAME);
    await addNode(user);
    await waitFor(() => expect(renderedNodeCount()).toBe(1), WIRING_TIMEOUT);
    return user;
  }
  const header = () => screen.getByRole('toolbar', { name: 'グラフの操作' });

  test('ヘッダの Undo で置いたノードが消え、Redo で戻る', async () => {
    const user = await soloFileWithOneNode();
    await user.click(within(header()).getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(renderedNodeCount()).toBe(0), WIRING_TIMEOUT);
    await user.click(within(header()).getByRole('button', { name: 'Redo' }));
    await waitFor(() => expect(renderedNodeCount()).toBe(1), WIRING_TIMEOUT);
  });

  test('🏷 を on にしてノードを選ぶと property editor が出て、足したプロパティが op-log に載る', async () => {
    const user = await soloFileWithOneNode();
    await user.click(within(header()).getByTitle('プロパティ'));
    selectFirstNode();
    const editor = await screen.findByRole(
      'region',
      { name: 'プロパティ' },
      WIRING_TIMEOUT,
    );
    await user.type(
      within(editor).getByLabelText('追加するプロパティの名前'),
      'owner',
    );
    await user.type(
      within(editor).getByLabelText('追加するプロパティの値'),
      'alice',
    );
    await user.click(within(editor).getByRole('button', { name: '追加' }));

    const fileId = world.localStore().listFiles()[0]?.id as FileId;
    await waitFor(() => {
      const file = projectFile(world.localStore().getBatches(fileId), fileId);
      expect(file.sheets[0]?.nodes[0]?.properties).toEqual({ owner: 'alice' });
    }, WIRING_TIMEOUT);
  });

  test('検索の窓は、別の view (タブ) へ移ると閉じる', async () => {
    const user = await soloFileWithOneNode();
    await user.click(screen.getByText('+ シートを追加'));
    await screen.findByRole('button', { name: 'Sheet 2' }, WIRING_TIMEOUT);
    await user.click(within(header()).getByTitle('このシートを検索'));
    await screen.findByRole('region', { name: '検索' });

    await user.click(
      screen.getByRole('tab', { name: `${FILE_NAME} / Sheet 1` }),
    );
    await waitFor(() => expect(renderedNodeCount()).toBe(1), WIRING_TIMEOUT);
    // 要素そのものを toBeNull に渡さない — 落ちたとき bun が DOM 全体を差分に出そうとして膨れる
    expect(screen.queryByRole('region', { name: '検索' }) === null).toBe(true);
  });
});

describe('App 結合: 右サイドバー (step3 Phase 3 S3-4b)', () => {
  test('右サイドバーの property editor で足したプロパティが op-log に載り、ボディ内のものにも出る', async () => {
    await world.activate('solo');
    render(<App />);
    const user = userEvent.setup();
    await createFile(user, FILE_NAME);
    await addNode(user);
    await waitFor(() => expect(renderedNodeCount()).toBe(1), WIRING_TIMEOUT);

    await user.click(
      screen.getByRole('button', { name: '右サイドバーを広げる' }),
    );
    selectFirstNode();
    const docked = await screen.findByRole(
      'region',
      { name: '詳細のプロパティ' },
      WIRING_TIMEOUT,
    );
    await user.type(
      within(docked).getByLabelText('追加するプロパティの名前'),
      'owner',
    );
    await user.type(
      within(docked).getByLabelText('追加するプロパティの値'),
      'alice',
    );
    await user.click(within(docked).getByRole('button', { name: '追加' }));

    const fileId = world.localStore().listFiles()[0]?.id as FileId;
    await waitFor(() => {
      const file = projectFile(world.localStore().getBatches(fileId), fileId);
      expect(file.sheets[0]?.nodes[0]?.properties).toEqual({ owner: 'alice' });
    }, WIRING_TIMEOUT);

    // 併用: ボディ内の property editor も同じ選択の同じ値を出す
    await user.click(
      within(screen.getByRole('toolbar', { name: 'グラフの操作' })).getByTitle(
        'プロパティ',
      ),
    );
    const floating = await screen.findByRole('region', { name: 'プロパティ' });
    await waitFor(
      () =>
        expect(within(floating).getByLabelText('owner の値')).toHaveProperty(
          'value',
          'alice',
        ),
      WIRING_TIMEOUT,
    );
  });
});

describe('App 結合: 別のタブで開く明示の操作 (step3 Phase 3 S3-4c)', () => {
  const tabLabels = () =>
    screen.queryAllByRole('tab').map((t) => t.textContent ?? '');

  /** ⌘ を押しながら押す (Ctrl も同じ扱い。どちらか片方を見れば足りる) */
  async function metaClick(
    user: ReturnType<typeof userEvent.setup>,
    el: Element,
  ) {
    await user.keyboard('{Meta>}');
    await user.click(el);
    await user.keyboard('{/Meta}');
  }

  test('⌘ を押しながらシートを選ぶと、同じアドレスでも新しいタブで開く (Q2)', async () => {
    await world.activate('solo');
    render(<App />);
    const user = userEvent.setup();
    await createFile(user, FILE_NAME);
    expect(tabLabels()).toEqual([`${FILE_NAME} / Sheet 1`]);

    await metaClick(user, screen.getByRole('button', { name: 'Sheet 1' }));
    await waitFor(
      () =>
        expect(tabLabels()).toEqual([
          `${FILE_NAME} / Sheet 1`,
          `${FILE_NAME} / Sheet 1`,
        ]),
      WIRING_TIMEOUT,
    );
    // 押さずに選ぶと、これまでどおり既存のタブへ移る (増えない)
    await user.click(screen.getByRole('button', { name: 'Sheet 1' }));
    expect(tabLabels()).toHaveLength(2);
  });

  test('⌘ を押しながら開いている branch を選ぶと、trunk に戻らずその branch を別のタブで開く', async () => {
    await world.activate('solo');
    render(<App />);
    const user = userEvent.setup();
    await createFile(user, FILE_NAME);
    await createBranch(user, BRANCH_NAME);
    await openBranch(user, BRANCH_NAME);

    // 文字で引くと、ヘッダの branch の状態 (⎇ b1) にも当たる。サイドバーの行はボタンである
    await metaClick(
      user,
      screen.getByRole('button', { name: branchLabel(BRANCH_NAME) }),
    );
    await waitFor(
      () =>
        expect(
          tabLabels().filter((l) => l.endsWith(`(⎇ ${BRANCH_NAME})`)),
        ).toHaveLength(2),
      WIRING_TIMEOUT,
    );
    await screen.findByRole('button', { name: 'コミット' }, WIRING_TIMEOUT);
  });
});

describe('App 結合: multiple モード (step3 Phase 3 S3-5)', () => {
  const TRUNK_LABEL = `${FILE_NAME} / Sheet 1`;
  const BRANCH_LABEL = `${TRUNK_LABEL} (⎇ ${BRANCH_NAME})`;
  /** pane の中に描かれているノードの数 */
  const nodesInPane = (label: string) =>
    screen
      .getByRole('region', { name: `pane: ${label}` })
      .querySelectorAll('.react-flow__node').length;

  beforeEach(() => {
    // 開発用の入口を開ける (Q6: 利用者の入口は作らない)。`devPanesEnabled` は描画のたびに読む
    process.env.VITE_DEV_PANES = 'true';
  });
  afterEach(() => {
    delete process.env.VITE_DEV_PANES;
  });

  /** trunk に 1 つ、branch b1 に 1 つ足して commit し、b1 のタブに trunk を並べる */
  async function branchBesideTrunk() {
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
    await commitBranch(user, '案');

    await user.click(screen.getByTitle('並べる (開発用)'));
    await user.click(screen.getByRole('menuitem', { name: TRUNK_LABEL }));
    await screen.findByRole('region', { name: `pane: ${TRUNK_LABEL}` });
    return user;
  }

  test('他のタブを並べると、アクティブな pane は編集のまま、並べた pane はその姿を見せる', async () => {
    await branchBesideTrunk();
    await waitFor(() => {
      expect(nodesInPane(BRANCH_LABEL)).toBe(2);
      expect(nodesInPane(TRUNK_LABEL)).toBe(1);
    }, WIRING_TIMEOUT);
    // ヘッダの branch の操作は、アクティブな pane (b1) を対象にしている
    expect(screen.getByRole('button', { name: 'コミット' })).toBeTruthy();
  });

  test('アクティブな pane で merge すると、並べた trunk の pane が読み直して merge 後の姿になる', async () => {
    const user = await branchBesideTrunk();
    await waitFor(
      () => expect(nodesInPane(TRUNK_LABEL)).toBe(1),
      WIRING_TIMEOUT,
    );
    await mergeOpenBranch(user, '取り込む');
    // 同じタブの中の書き込みの知らせ (BroadcastChannel は送り手自身に届かない) で読み直す
    await waitFor(
      () => expect(nodesInPane(TRUNK_LABEL)).toBe(2),
      WIRING_TIMEOUT,
    );
  });

  test('前に出すとアクティブが入れ替わり、pane を閉じると single に戻る', async () => {
    const user = await branchBesideTrunk();
    const trunkPane = screen.getByRole('region', {
      name: `pane: ${TRUNK_LABEL}`,
    });
    await user.click(
      within(trunkPane).getByRole('button', { name: '前に出す' }),
    );
    // 画面の仕組みが trunk へ移る: branch の操作がヘッダから消え、b1 は見るだけになる
    await waitFor(
      () =>
        expect(
          screen.queryByRole('button', { name: 'コミット' }) === null,
        ).toBe(true),
      WIRING_TIMEOUT,
    );
    await waitFor(() => {
      expect(nodesInPane(TRUNK_LABEL)).toBe(1);
      expect(nodesInPane(BRANCH_LABEL)).toBe(2);
    }, WIRING_TIMEOUT);

    await user.click(
      screen.getByRole('button', { name: `${BRANCH_LABEL} の pane を閉じる` }),
    );
    await waitFor(
      () =>
        expect(
          screen.queryByRole('region', { name: `pane: ${TRUNK_LABEL}` }) ===
            null,
        ).toBe(true),
      WIRING_TIMEOUT,
    );
    expect(renderedNodeCount()).toBe(1);
  });

  test('開発用の入口が閉じていれば「⧉」は出ない (利用者の入口は作らない, Q6)', async () => {
    delete process.env.VITE_DEV_PANES;
    await world.activate('solo');
    render(<App />);
    const user = userEvent.setup();
    await createFile(user, FILE_NAME);
    expect(screen.queryByTitle('並べる (開発用)') === null).toBe(true);
  });
});

describe('App 結合: template graph (step3 Phase 4 S4-1b)', () => {
  /** 開いている File の中の、種別 template のシート */
  const templateSheetOf = (fileId: FileId) =>
    projectFile(world.localStore().getBatches(fileId), fileId).sheets.find(
      (s) => sheetKindOf(s) === TEMPLATE_SHEET_KIND,
    );

  test('template graph の label の node が、当てたシートの種類のメニューに出て、作った node は種別と既定値を持つ', async () => {
    await world.activate('solo');
    render(<App />);
    const user = userEvent.setup();
    await createFile(user, FILE_NAME);

    // template graph を作る。branch は切れない (「+ branch」が出ない)
    await user.click(
      screen.getByRole('button', { name: 'template 付きでシートを追加' }),
    );
    await user.click(screen.getByRole('button', { name: '+ template graph' }));
    await screen.findByTitle('template graph', {}, WIRING_TIMEOUT);
    expect(screen.queryByRole('button', { name: '+ branch' }) === null).toBe(
      true,
    );

    // template graph に「主張」(既定値 owner = '') を置く。文字の入力は React Flow の中で扱いにくいので、
    // 別のタブが書いたものとして正典に入れて知らせる (S2-4 と同じ手)
    const store = world.localStore();
    const fileId = store.listFiles()[0]?.id as FileId;
    const templateSheet = templateSheetOf(fileId);
    if (!templateSheet) throw new Error('template graph が正典に無い');
    const claim = crypto.randomUUID() as NodeId;
    store.appendBatches(fileId, [
      {
        id: crypto.randomUUID() as Batch['id'],
        actor: `${LOCAL_TEST_ACTOR}#other-tab`,
        clock: 1000,
        seq: 1,
        deps: {},
        timestamp: Date.now(),
        sheetId: templateSheet.id,
        ops: [
          { kind: 'node.add', target: claim, content: '結論' },
          { kind: 'node.setLabel', target: claim, label: '主張' },
          { kind: 'node.setProperty', target: claim, name: 'owner', value: '' },
        ],
      },
    ]);
    const channel = new BroadcastChannel(LOCAL_CHANGES_CHANNEL);
    channel.postMessage({ fileId });
    channel.close();
    await waitFor(() => expect(renderedNodeCount()).toBe(1), WIRING_TIMEOUT);

    // 当ててシートを足す (Q7: チェックボックスのダイアログ)
    await user.click(screen.getByText('+ シートを追加'));
    const dialog = await screen.findByRole('dialog', { name: 'シートを追加' });
    await user.click(within(dialog).getByRole('checkbox'));
    await user.click(
      within(dialog).getByRole('button', { name: 'シートを追加' }),
    );
    await waitFor(() => expect(renderedNodeCount()).toBe(0), WIRING_TIMEOUT);

    // 種類のメニューに「主張」が出て、作った node は種別・label・既定値を持つ
    await addNode(user, '主張');
    await waitFor(() => {
      const applied = projectFile(store.getBatches(fileId), fileId).sheets.find(
        (s) => s.templateIds?.length,
      );
      const node = applied?.nodes[0];
      expect(node?.label).toBe('主張');
      expect(node?.properties).toEqual({
        owner: '',
        [kindPropertyOf(templateIdOf(templateSheet.id))]: claim,
      });
    }, WIRING_TIMEOUT);
  });

  test('Toulmin model を追加すると種から template graph ができ、当てたシートで Toulmin の種類を使える (Q1)', async () => {
    await world.activate('solo');
    render(<App />);
    const user = userEvent.setup();
    await createFile(user, FILE_NAME);

    await user.click(
      screen.getByRole('button', { name: 'template 付きでシートを追加' }),
    );
    await user.click(
      screen.getByRole('button', { name: '+ Toulmin model を追加' }),
    );
    // 種の 5 つの種類が node として並ぶ (ふつうの template graph として描かれる)
    await waitFor(() => expect(renderedNodeCount()).toBe(5), WIRING_TIMEOUT);
    await screen.findByTitle('template graph', {}, WIRING_TIMEOUT);

    await user.click(screen.getByText('+ シートを追加'));
    const dialog = await screen.findByRole('dialog', { name: 'シートを追加' });
    await user.click(
      within(dialog).getByRole('checkbox', { name: 'Toulmin model' }),
    );
    await user.click(
      within(dialog).getByRole('button', { name: 'シートを追加' }),
    );
    await waitFor(() => expect(renderedNodeCount()).toBe(0), WIRING_TIMEOUT);

    await addNode(user, '主張');
    const store = world.localStore();
    const fileId = store.listFiles()[0]?.id as FileId;
    await waitFor(() => {
      const file = projectFile(store.getBatches(fileId), fileId);
      const toulmin = file.sheets.find(
        (s) => sheetKindOf(s) === TEMPLATE_SHEET_KIND,
      );
      const applied = file.sheets.find((s) => s.templateIds?.length);
      const claim = toulmin?.nodes.find((n) => n.label === '主張');
      const node = applied?.nodes[0];
      // 種類の id は複製された template graph の node の id、名前空間はその template graph
      expect(node?.label).toBe('主張');
      expect(
        node?.properties?.[kindPropertyOf(templateIdOf(toulmin?.id ?? ''))],
      ).toBe(claim?.id);
    }, WIRING_TIMEOUT);
  });
});

describe('App 結合: metagraph (step3 Phase 4 S4-2b)', () => {
  /** graph node (導出 node) の DOM。本文 (= シートの名前) で探す */
  const graphNode = (name: string) => {
    const node = [...document.querySelectorAll('.react-flow__node')].find((n) =>
      n.textContent?.includes(name),
    );
    if (!node) throw new Error(`graph node「${name}」が描かれていない`);
    return node as HTMLElement;
  };
  const sheetNames = () => {
    const store = world.localStore();
    const fileId = store.listFiles()[0]?.id as FileId;
    return projectFile(store.getBatches(fileId), fileId).sheets.map(
      (s) => s.name,
    );
  };

  /** File を作り、index を開く */
  async function openIndex() {
    await world.activate('solo');
    render(<App />);
    const user = userEvent.setup();
    await createFile(user, FILE_NAME);
    await user.click(screen.getByRole('button', { name: /^index/ }));
    // Sheet 1 と index 自身 (Q4) が graph node として並ぶ
    await waitFor(() => expect(renderedNodeCount()).toBe(2), WIRING_TIMEOUT);
    return user;
  }

  test('File を作ると index があり、Sheet 1 と index 自身が graph node として並ぶ', async () => {
    await openIndex();
    expect(sheetNames()).toEqual(['Sheet 1', 'index']);
    graphNode('Sheet 1');
    graphNode('index');
  });

  test('「グラフ」で graph node を足すとシートが増え、metagraph に留まったまま graph node が出る', async () => {
    const user = await openIndex();
    await addNode(user, 'グラフ');
    await waitFor(() => expect(renderedNodeCount()).toBe(3), WIRING_TIMEOUT);
    expect(sheetNames()).toEqual(['Sheet 1', 'index', 'Sheet 2']);
    // 足したシートは開かない (index のタブのまま)
    expect(
      screen
        .getAllByRole('tab')
        .find((t) => t.getAttribute('aria-selected') === 'true')?.textContent,
    ).toBe(`${FILE_NAME} / index`);
    graphNode('Sheet 2');
  });

  test('graph node を消すと、確認の後にシートが消える。断れば消えない', async () => {
    const user = await openIndex();
    await addNode(user, 'グラフ');
    await waitFor(() => expect(renderedNodeCount()).toBe(3), WIRING_TIMEOUT);

    fireEvent.click(graphNode('Sheet 2'));
    fireEvent.keyDown(window, { key: 'Delete' });
    await user.click(await screen.findByRole('button', { name: 'キャンセル' }));
    expect(sheetNames()).toContain('Sheet 2');

    fireEvent.click(graphNode('Sheet 2'));
    fireEvent.keyDown(window, { key: 'Delete' });
    await user.click(await screen.findByRole('button', { name: 'OK' }));
    await waitFor(
      () => expect(sheetNames()).not.toContain('Sheet 2'),
      WIRING_TIMEOUT,
    );
    await waitFor(() => expect(renderedNodeCount()).toBe(2), WIRING_TIMEOUT);
  });

  test('graph node を選んで F2 で名前を変えると、シートの名前が変わる', async () => {
    const user = await openIndex();
    fireEvent.click(graphNode('Sheet 1'));
    fireEvent.keyDown(window, { key: 'F2' });
    const input = await waitFor(() => {
      const el = graphNode('Sheet 1').querySelector('textarea');
      if (!el) throw new Error('名前の編集が始まらない');
      return el;
    }, WIRING_TIMEOUT);
    await user.clear(input);
    await user.type(input, '本論');
    fireEvent.blur(input);
    await waitFor(
      () => expect(sheetNames()).toEqual(['本論', 'index']),
      WIRING_TIMEOUT,
    );
    await screen.findByRole('button', { name: '本論' }, WIRING_TIMEOUT);
  });

  test('graph node をダブルクリックすると、そのシートを新しいタブで開く (Q6)', async () => {
    await openIndex();
    // ダブルクリックの受け手は本文の要素 (React Flow の外枠ではない)
    const body = graphNode('Sheet 1').querySelector('[data-node-body]');
    if (!body) throw new Error('graph node の本文が無い');
    fireEvent.doubleClick(body);
    await waitFor(
      () =>
        expect(
          screen
            .getAllByRole('tab')
            .find((t) => t.getAttribute('aria-selected') === 'true')
            ?.textContent,
        ).toBe(`${FILE_NAME} / Sheet 1`),
      WIRING_TIMEOUT,
    );
  });
});

/** 描かれている唯一の node の本文を書き換える (本文のダブルクリック → 入力 → 外す) */
async function editOnlyNode(
  user: ReturnType<typeof userEvent.setup>,
  text: string,
  root: ParentNode = document,
) {
  // 本文を持つ node を優先する (足しただけの空の node より、書き換えたい node を選ぶ)
  const nodes = [...root.querySelectorAll('.react-flow__node')];
  const written = (n: Element) =>
    !(n.textContent ?? '').includes('ダブルクリックで編集');
  const node = nodes.find(written) ?? nodes[0];
  const body = node?.querySelector('[data-node-body]');
  if (!body) throw new Error('node が描かれていない');
  fireEvent.doubleClick(body);
  const input = await waitFor(() => {
    const el = node?.querySelector('textarea');
    if (!el) throw new Error('本文の編集が始まらない');
    return el as HTMLTextAreaElement;
  }, WIRING_TIMEOUT);
  await user.clear(input);
  await user.type(input, text);
  fireEvent.blur(input);
}
/** trunk の Sheet 1 の、本文を持つ node の本文 (足しただけの空の node は数えない) */
const trunkContent = () => {
  const store = world.localStore();
  const fileId = store.listFiles()[0]?.id as FileId;
  return projectFile(store.getBatches(fileId), fileId)
    .sheets.find((s) => s.name === 'Sheet 1')
    ?.nodes.find((n) => n.content !== '')?.content;
};

describe('App 結合: merger (step3 Phase 5 S5-1a)', () => {
  const TRUNK_TAB = `${FILE_NAME} / Sheet 1`;
  const BRANCH_TAB = `${TRUNK_TAB} (⎇ ${BRANCH_NAME})`;

  /** 同じ node の本文を branch (コミット済み) と trunk で書き換え、branch から merge ↑ を押す */
  async function conflictingMerge() {
    await world.activate('solo');
    render(<App />);
    const user = userEvent.setup();
    await createFile(user, FILE_NAME);
    await addNode(user);
    await waitFor(() => expect(renderedNodeCount()).toBe(1), WIRING_TIMEOUT);
    await editOnlyNode(user, 'もと');
    await waitFor(() => expect(trunkContent()).toBe('もと'), WIRING_TIMEOUT);

    await createBranch(user, BRANCH_NAME);
    await openBranch(user, BRANCH_NAME);
    await editOnlyNode(user, 'branch 案');
    await commitBranch(user, '案');

    await user.click(screen.getByRole('tab', { name: TRUNK_TAB }));
    await waitFor(() => expect(renderedNodeCount()).toBe(1), WIRING_TIMEOUT);
    await editOnlyNode(user, 'trunk 案');
    await waitFor(
      () => expect(trunkContent()).toBe('trunk 案'),
      WIRING_TIMEOUT,
    );
    // trunk にだけある node。merge 後 (trunk の最新 + branch) には出て、branch 自身の姿には出ない
    await addNode(user);
    await waitFor(() => expect(renderedNodeCount()).toBe(2), WIRING_TIMEOUT);

    await user.click(screen.getByRole('tab', { name: BRANCH_TAB }));
    await screen.findByRole('button', { name: 'コミット' }, WIRING_TIMEOUT);
    const mergeButton = screen.getByRole('button', { name: 'merge ↑' });
    await waitFor(
      () => expect(mergeButton).toHaveProperty('disabled', false),
      WIRING_TIMEOUT,
    );
    await user.click(mergeButton);
    return user;
  }

  test(
    '競合があると merger が新しいタブで開き、merge 後は branch の値、conflict list に競合が出る',
    async () => {
      await conflictingMerge();
      await waitFor(
        () =>
          expect(
            screen
              .getAllByRole('tab')
              .find((t) => t.getAttribute('aria-selected') === 'true')
              ?.textContent,
          ).toBe(`merge: ${BRANCH_TAB}`),
        WIRING_TIMEOUT,
      );
      const list = await screen.findByRole('region', { name: 'conflict list' });
      await waitFor(
        () => expect(within(list).getAllByRole('checkbox')).toHaveLength(1),
        WIRING_TIMEOUT,
      );
      const result = screen.getByRole('region', { name: 'pane: merge 後' });
      await waitFor(() => {
        expect(result.textContent).toContain('branch 案');
        // trunk の最新の上に重ねた姿 (branch 自身の姿なら node は 1 つ)
        expect(result.querySelectorAll('.react-flow__node')).toHaveLength(2);
      }, WIRING_TIMEOUT);
      // 確認のダイアログは出ない (merger が引き取った)
      expect(
        screen.queryByRole('button', { name: 'merge する' }) === null,
      ).toBe(true);
      // まだ trunk には載っていない
      expect(trunkContent()).toBe('trunk 案');
    },
    MERGER_TEST_MS,
  );

  test(
    'チェックとコメントが揃うまで merge は押せず、merge すると trunk に載ってタブが閉じる',
    async () => {
      const user = await conflictingMerge();
      const list = await screen.findByRole(
        'region',
        { name: 'conflict list' },
        WIRING_TIMEOUT,
      );
      const merge = () => within(list).getByRole('button', { name: 'merge' });
      await waitFor(
        () => expect(within(list).getAllByRole('checkbox')).toHaveLength(1),
        WIRING_TIMEOUT,
      );
      expect(merge()).toHaveProperty('disabled', true);
      await user.click(within(list).getByRole('checkbox'));
      expect(merge()).toHaveProperty('disabled', true);
      await user.type(
        within(list).getByLabelText('merge のコメント'),
        'branch 案を採る',
      );
      expect(merge()).toHaveProperty('disabled', false);

      // 解決の編集: merge 後で本文を直す。branch の op-log に積まれ (Q1)、未コミットなので merge の前に
      // コメントでコミットされ (Q3)、merge で trunk に載る
      await editOnlyNode(
        user,
        'まとめ案',
        screen.getByRole('region', { name: 'pane: merge 後' }),
      );
      await user.click(merge());
      await waitFor(
        () => expect(trunkContent()).toBe('まとめ案'),
        WIRING_TIMEOUT,
      );
      await waitFor(
        () =>
          expect(
            screen
              .queryAllByRole('tab')
              .some((t) => t.textContent?.startsWith('merge:')),
          ).toBe(false),
        WIRING_TIMEOUT,
      );
      // merger で決めた競合を「LWW で確定した」と知らせない
      expect(screen.queryByRole('status', { name: '競合の通知' })).toBeNull();
      // 戻った branch の画面にも解決の編集が出る。merger と branch のタブは同じ branch を指すので
      // タブを移っても branch は選び直されず、merger を開いた時の姿のまま残っていた (実機で発覚)
      await waitFor(() => {
        const nodes = [...document.querySelectorAll('.react-flow__node')];
        expect(nodes.some((n) => n.textContent?.includes('まとめ案'))).toBe(
          true,
        );
        expect(nodes.some((n) => n.textContent?.includes('branch 案'))).toBe(
          false,
        );
      }, WIRING_TIMEOUT);
    },
    MERGER_TEST_MS,
  );
  /** pane の中の node。本文で探す */
  const nodeIn = (pane: string, text: string) => {
    // pane の名前は「pane: merge 元: … (開いた時点)」のように続くので先頭で探す
    const region = screen.getByRole('region', {
      name: new RegExp(`^pane: ${pane}`),
    });
    const node = [...region.querySelectorAll('.react-flow__node')].find((n) =>
      n.textContent?.includes(text),
    );
    if (!node) throw new Error(`${pane} に「${text}」が無い`);
    return node as HTMLElement;
  };

  test(
    '元・先の両方で競合している node が点線で囲まれ、先では trunk にだけある node が追加の色になる (S5-1b)',
    async () => {
      await conflictingMerge();
      await waitFor(() => {
        expect(nodeIn('merge 元', 'branch 案').style.outline).toContain(
          'dashed',
        );
        expect(nodeIn('merge 先', 'trunk 案').style.outline).toContain(
          'dashed',
        );
      }, WIRING_TIMEOUT);
      // 先 (trunk) の空の node は、元 (branch を開いた時点) に無いので追加の色
      const target = screen.getByRole('region', { name: /^pane: merge 先/ });
      const added = [
        ...target.querySelectorAll('.react-flow__node [data-node-body]'),
      ]
        .map((b) => (b as HTMLElement).style.background)
        .filter((bg) => bg.includes('240, 253, 244') || bg.includes('f0fdf4'));
      expect(added).toHaveLength(1);
    },
    MERGER_TEST_MS,
  );

  test(
    '元の pane で node を押すと、merge 後の同じ node も選ばれる (選択の連動, S5-1b)',
    async () => {
      await conflictingMerge();
      const source = await waitFor(
        () => nodeIn('merge 元', 'branch 案'),
        WIRING_TIMEOUT,
      );
      fireEvent.click(source);
      await waitFor(
        () =>
          expect(
            nodeIn('merge 後', 'branch 案').classList.contains('selected'),
          ).toBe(true),
        WIRING_TIMEOUT,
      );
      // 先の同じ node も選ばれた見た目になる
      expect(
        nodeIn('merge 先', 'trunk 案').classList.contains('selected'),
      ).toBe(true);
    },
    MERGER_TEST_MS,
  );
  test(
    '先の pane で右クリックして取り込むと、merge 後がその姿になり、Undo で戻る (S5-1c)',
    async () => {
      const user = await conflictingMerge();
      const target = await waitFor(
        () => nodeIn('merge 先', 'trunk 案'),
        WIRING_TIMEOUT,
      );
      fireEvent.contextMenu(target);
      await user.click(
        await screen.findByRole('menuitem', { name: /merge 後に取り込む/ }),
      );
      await waitFor(
        () => expect(nodeIn('merge 後', 'trunk 案')).toBeTruthy(),
        WIRING_TIMEOUT,
      );
      await user.click(
        within(screen.getByRole('toolbar', { name: 'グラフの操作' })).getByRole(
          'button',
          { name: 'Undo' },
        ),
      );
      await waitFor(
        () => expect(nodeIn('merge 後', 'branch 案')).toBeTruthy(),
        WIRING_TIMEOUT,
      );
    },
    MERGER_TEST_MS,
  );
  test(
    'merger を開いている間に merge 先が進むと、先が更新されてチェックが外れ、チェックし直すと merge できる (S5-2, O3)',
    async () => {
      const user = await conflictingMerge();
      const list = await screen.findByRole(
        'region',
        { name: 'conflict list' },
        WIRING_TIMEOUT,
      );
      await waitFor(
        () => expect(within(list).getAllByRole('checkbox')).toHaveLength(1),
        WIRING_TIMEOUT,
      );
      await user.click(within(list).getByRole('checkbox'));
      await user.type(within(list).getByLabelText('merge のコメント'), '採る');
      const merge = () => within(list).getByRole('button', { name: 'merge' });
      expect(merge()).toHaveProperty('disabled', false);

      // 別のタブが trunk の同じ node を書き換える (S2-4 と同じ手: 正典に入れて知らせる)
      const store = world.localStore();
      const fileId = store.listFiles()[0]?.id as FileId;
      const trunk = projectFile(store.getBatches(fileId), fileId);
      const sheet = trunk.sheets.find((s) => s.name === 'Sheet 1');
      const node = sheet?.nodes.find((n) => n.content === 'trunk 案');
      if (!sheet || !node) throw new Error('trunk に競合の node が無い');
      store.appendBatches(fileId, [
        {
          id: crypto.randomUUID() as Batch['id'],
          actor: `${LOCAL_TEST_ACTOR}#other-tab`,
          clock: 5000,
          seq: 1,
          deps: {},
          timestamp: Date.now(),
          sheetId: sheet.id,
          ops: [
            { kind: 'node.setContent', target: node.id, content: 'trunk 更に' },
          ],
        },
      ]);
      const channel = new BroadcastChannel(LOCAL_CHANGES_CHANNEL);
      channel.postMessage({ fileId });
      channel.close();

      // 先が更新され、競合の trunk 側が新しくなったのでチェックが外れ、merge は押せなくなる
      await waitFor(
        () => expect(nodeIn('merge 先', 'trunk 更に')).toBeTruthy(),
        WIRING_TIMEOUT,
      );
      await waitFor(() => {
        expect(within(list).getByRole('checkbox')).toHaveProperty(
          'checked',
          false,
        );
        expect(merge()).toHaveProperty('disabled', true);
      }, WIRING_TIMEOUT);
      // チェックし直すと merge できる。merge 後は branch の勝ち
      await user.click(within(list).getByRole('checkbox'));
      expect(merge()).toHaveProperty('disabled', false);
      await user.click(merge());
      await waitFor(
        () => expect(trunkContent()).toBe('branch 案'),
        WIRING_TIMEOUT,
      );
    },
    MERGER_TEST_MS,
  );

  test(
    'implicit merge が保留した競合 (fork) を merge ↑ すると merger が開き、凍結した競合を決めて trunk に載せる (S5-3)',
    async () => {
      const { code } = await aliceSharesFileWithBob();
      let user = await startOn('alice', ALICE);
      await openFileNamed(user, FILE_NAME);
      await addNode(user);
      await waitFor(() => expect(renderedNodeCount()).toBe(1), WIRING_TIMEOUT);
      await editOnlyNode(user, 'もと');
      await waitFor(() => expect(trunkContent()).toBe('もと'), WIRING_TIMEOUT);
      await syncNow(user);

      // bob: 参加して同じ node を書き換える (alice の次の編集はまだ知らない)
      user = await startOn('bob', BOB);
      await participate(user, code, FILE_NAME);
      await syncNow(user);
      await waitFor(() => expect(trunkContent()).toBe('もと'), WIRING_TIMEOUT);
      // bob の編集は alice に届かないよう保留する。届くと alice は見た上で書き換えたことになり、
      // 競合ではなく上書きの報告になる
      world.pds.withhold(BOB.did);
      await editOnlyNode(user, 'bob 案');
      await waitFor(
        () => expect(trunkContent()).toBe('bob 案'),
        WIRING_TIMEOUT,
      );

      // alice: 並行に同じ node を書き換えて送る
      user = await startOn('alice', ALICE);
      await openFileNamed(user, FILE_NAME);
      await editOnlyNode(user, 'alice 案');
      await waitFor(
        () => expect(trunkContent()).toBe('alice 案'),
        WIRING_TIMEOUT,
      );
      await syncNow(user);

      // bob: 受け取ると implicit merge が競合を保留し、fork を記録する
      user = await startOn('bob', BOB);
      await openFileNamed(user, FILE_NAME);
      await syncNow(user);
      await screen.findByText(/件を保留として記録しました/, {}, WIRING_TIMEOUT);
      // fork の名前は対象の分岐点 (検出時点の手元) での本文から付く
      await openBranch(user, '競合: .+ の内容');
      await user.click(screen.getByRole('button', { name: 'merge ↑' }));

      // 確認のダイアログではなく merger が開き、fork に凍結した競合が conflict list に出る
      const list = await screen.findByRole(
        'region',
        { name: 'conflict list' },
        WIRING_TIMEOUT,
      );
      await waitFor(
        () => expect(within(list).getAllByRole('checkbox')).toHaveLength(1),
        WIRING_TIMEOUT,
      );
      // 元は fork の分岐点 = 検出した bob の手元 (bob の案)。届いた alice の案はどの pane にも無く、
      // conflict list が両側を書いた人の名前で示す
      expect(nodeIn('merge 元', 'bob 案')).toBeTruthy();
      // (名前はこの世界では handle に解けず DID のまま出る。上書きの報告と同じ)
      expect(list.textContent).toContain(`${BOB.did}: 本文「bob 案」`);
      expect(list.textContent).toContain(`${ALICE.did}: 本文「alice 案」`);
      await user.click(within(list).getByRole('checkbox'));
      await user.type(
        within(list).getByLabelText('merge のコメント'),
        '両案をまとめる',
      );
      await editOnlyNode(
        user,
        'まとめ案',
        screen.getByRole('region', { name: 'pane: merge 後' }),
      );
      await user.click(within(list).getByRole('button', { name: 'merge' }));
      await waitFor(
        () => expect(trunkContent()).toBe('まとめ案'),
        WIRING_TIMEOUT,
      );
    },
    MERGER_TEST_MS * 2,
  );
});

describe('App 結合: 通知の既読 (step3 Phase 6 S6-1a)', () => {
  test(
    '競合の通知を 1 台で閉じると、同じ人の別の端末には同じ競合 (fork) の到着が出ない',
    async () => {
      const { code } = await aliceSharesFileWithBob();
      let user = await startOn('alice', ALICE);
      await openFileNamed(user, FILE_NAME);
      await addNode(user);
      await waitFor(() => expect(renderedNodeCount()).toBe(1), WIRING_TIMEOUT);
      await editOnlyNode(user, 'もと');
      await waitFor(() => expect(trunkContent()).toBe('もと'), WIRING_TIMEOUT);
      await syncNow(user);

      // bob の 2 台目: 競合の前に File を持っておく (届く batch が「新着」になる側)
      user = await startOn('bob-2', BOB);
      await participate(user, code, FILE_NAME);
      await syncNow(user);
      await waitFor(() => expect(trunkContent()).toBe('もと'), WIRING_TIMEOUT);

      // bob の 1 台目: 同じ node を書き換える。alice に届かないよう保留する
      user = await startOn('bob', BOB);
      await openFileNamed(user, FILE_NAME);
      await syncNow(user);
      await waitFor(() => expect(trunkContent()).toBe('もと'), WIRING_TIMEOUT);
      world.pds.withhold(BOB.did);
      await editOnlyNode(user, 'bob 案');
      await waitFor(
        () => expect(trunkContent()).toBe('bob 案'),
        WIRING_TIMEOUT,
      );

      // alice: 並行に同じ node を書き換えて送る
      user = await startOn('alice', ALICE);
      await openFileNamed(user, FILE_NAME);
      await editOnlyNode(user, 'alice 案');
      await waitFor(
        () => expect(trunkContent()).toBe('alice 案'),
        WIRING_TIMEOUT,
      );
      await syncNow(user);

      // bob の 1 台目: 受け取ると競合を検出して fork を書く。通知を閉じる
      user = await startOn('bob', BOB);
      world.pds.release(BOB.did);
      await openFileNamed(user, FILE_NAME);
      await syncNow(user);
      await screen.findByText(/件を保留として記録しました/, {}, WIRING_TIMEOUT);
      await user.click(
        screen.getByRole('button', { name: '競合の通知を閉じる' }),
      );
      // 閉じたことが自分の PDS に載る
      await waitFor(
        () =>
          expect(
            world.pds.records(BOB.did, NSID.noticeDismissal).length,
          ).toBeGreaterThan(0),
        WIRING_TIMEOUT,
      );

      // bob の 2 台目: bob の編集・alice の編集・fork が届く。2 台目も同じ競合を自分で検出する
      // (同じ鍵になる) が、1 台目で閉じたので出ない。fork の branch が一覧に出るまで待つ
      // のは、受信が済んだことの印である
      user = await startOn('bob-2', BOB);
      await openFileNamed(user, FILE_NAME);
      await syncNow(user);
      await openBranch(user, '競合: .+ の内容');
      await new Promise((r) => setTimeout(r, SETTLE_MS));
      // 失敗したときに DOM 全体を出力させない (textContent で比べる)
      expect(
        screen.queryByRole('status', { name: '競合の通知' })?.textContent ??
          null,
      ).toBeNull();
    },
    MERGER_TEST_MS * 2,
  );
});

describe('App 結合: 閉じていない通知の控え (step3 Phase 6 S6-1b)', () => {
  /** alice と bob が同じ node を並行に書き換え、bob が受信して競合を検出し fork を書くまで */
  async function bobDetectsConflict() {
    const { code } = await aliceSharesFileWithBob();
    let user = await startOn('alice', ALICE);
    await openFileNamed(user, FILE_NAME);
    await addNode(user);
    await waitFor(() => expect(renderedNodeCount()).toBe(1), WIRING_TIMEOUT);
    await editOnlyNode(user, 'もと');
    await waitFor(() => expect(trunkContent()).toBe('もと'), WIRING_TIMEOUT);
    await syncNow(user);

    user = await startOn('bob', BOB);
    await participate(user, code, FILE_NAME);
    await syncNow(user);
    await waitFor(() => expect(trunkContent()).toBe('もと'), WIRING_TIMEOUT);
    world.pds.withhold(BOB.did);
    await editOnlyNode(user, 'bob 案');
    await waitFor(() => expect(trunkContent()).toBe('bob 案'), WIRING_TIMEOUT);

    user = await startOn('alice', ALICE);
    await openFileNamed(user, FILE_NAME);
    await editOnlyNode(user, 'alice 案');
    await waitFor(
      () => expect(trunkContent()).toBe('alice 案'),
      WIRING_TIMEOUT,
    );
    await syncNow(user);

    user = await startOn('bob', BOB);
    // ここからの bob の書き込み (fork・既読) は PDS に載せる
    world.pds.release(BOB.did);
    await openFileNamed(user, FILE_NAME);
    await syncNow(user);
    await screen.findByText(/件を保留として記録しました/, {}, WIRING_TIMEOUT);
    return user;
  }

  /** 競合の通知の文面 (無ければ null)。要素を比べると失敗時に DOM 全体が出力される */
  const noticeText = () =>
    screen.queryByRole('status', { name: '競合の通知' })?.textContent ?? null;

  test(
    '閉じる前に再読み込みしても競合の通知が残り、同じ競合の fork は重ねない。閉じた後は出ない',
    async () => {
      await bobDetectsConflict();

      // 再読み込み: 受信はもう新着ではないので検出し直されない。控えから戻る
      let user = await startOn('bob', BOB);
      await waitFor(
        () => expect(noticeText()).toContain('件の競合を検出しました'),
        WIRING_TIMEOUT,
      );
      // File を開くと未決着の fork を op-log から求めるが、通知に出ている競合と同じなので重ねない
      await openFileNamed(user, FILE_NAME);
      await screen.findAllByText(/競合: .+ の内容/, {}, WIRING_TIMEOUT);
      await new Promise((r) => setTimeout(r, SETTLE_MS));
      expect(noticeText()).not.toContain('相手が保留した競合');

      await user.click(
        screen.getByRole('button', { name: '競合の通知を閉じる' }),
      );
      // 既読が PDS に載るのを待つ (書き終える前に再読み込みすると、既読は失われる)
      await waitFor(
        () =>
          expect(
            world.pds.records(BOB.did, NSID.noticeDismissal).length,
          ).toBeGreaterThan(0),
        WIRING_TIMEOUT,
      );
      user = await startOn('bob', BOB);
      await openFileNamed(user, FILE_NAME);
      await screen.findAllByText(/競合: .+ の内容/, {}, WIRING_TIMEOUT);
      await new Promise((r) => setTimeout(r, SETTLE_MS));
      expect(noticeText()).toBeNull();
    },
    MERGER_TEST_MS * 2,
  );

  test(
    '通知の控えが無くても、まだ決着していない fork は File を開くと出る',
    async () => {
      await bobDetectsConflict();
      // 控えを失った端末 (閉じずに localStorage を消した、など)。activate の前に消すと、
      // 端末の localStorage の控えにも載らない
      cleanup();
      localStorage.removeItem(noticeCacheKey(BOB.did));

      const user = await startOn('bob', BOB);
      await openFileNamed(user, FILE_NAME);
      await waitFor(
        () => expect(noticeText()).toContain('保留した競合 1 件'),
        WIRING_TIMEOUT,
      );
    },
    MERGER_TEST_MS * 2,
  );
});

describe('App 結合: Folder (step3 Phase 6 S6-2c)', () => {
  /** Folder を作る (トップ・レベル、または `parent` の中) */
  async function createFolder(
    user: ReturnType<typeof userEvent.setup>,
    name: string,
    parent?: string,
  ) {
    await user.click(
      screen.getByRole('button', {
        name:
          parent === undefined
            ? 'Folder を作る'
            : `${parent} の中に Folder を作る`,
      }),
    );
    const dialog = await screen.findByLabelText('入力');
    await user.type(within(dialog).getByRole('textbox'), name);
    await user.click(within(dialog).getByRole('button', { name: 'OK' }));
  }

  /** Folder の行を含む `<li>` (中身の File もここに描かれる) */
  const folderItem = (name: string) =>
    screen
      .getByRole('button', { name: `${name} の名前を変える` })
      .closest('li') as HTMLElement;

  /** 表示されている Folder の名前 (並び順) */
  const folderNames = () =>
    screen
      .queryAllByRole('button', { name: /の名前を変える$/ })
      .map((b) =>
        (b.getAttribute('aria-label') ?? '').replace(/ の名前を変える$/, ''),
      );

  test(
    'File を Folder に移すと Folder の中に出て、同じ人の別の端末でも同じ Folder の中に出る',
    async () => {
      const user = await startOn('alice', ALICE);
      await createFile(user, FILE_NAME);
      await createFolder(user, '研究');
      await screen.findByRole('button', { name: '研究 の名前を変える' });

      await user.click(
        screen.getByRole('button', { name: `${FILE_NAME} を Folder へ移す` }),
      );
      await user.click(screen.getByRole('button', { name: '→ 研究' }));
      await waitFor(
        () =>
          expect(within(folderItem('研究')).getByText(FILE_NAME)).toBeTruthy(),
        WIRING_TIMEOUT,
      );
      // 中身のある Folder は削除できない (仕様)
      expect(
        screen.getByRole('button', { name: '研究 を削除' }),
      ).toHaveProperty('disabled', true);
      // 自分の PDS に Folder と置き場が載る
      await waitFor(() => {
        expect(world.pds.records(ALICE.did, NSID.folder)).toHaveLength(1);
        expect(world.pds.records(ALICE.did, NSID.filePlacement)).toHaveLength(
          1,
        );
      }, WIRING_TIMEOUT);

      // 別の端末: File を見つけ、Folder の中に出す
      const user2 = await startOn('alice-2', ALICE);
      await syncNow(user2);
      await waitFor(
        () =>
          expect(within(folderItem('研究')).getByText(FILE_NAME)).toBeTruthy(),
        WIRING_TIMEOUT,
      );

      // トップ・レベルに戻すと Folder は空になり、削除できる
      await user2.click(
        screen.getByRole('button', { name: `${FILE_NAME} を Folder へ移す` }),
      );
      await user2.click(
        screen.getByRole('button', { name: '→ トップ・レベル' }),
      );
      await waitFor(
        () =>
          expect(
            screen.getByRole('button', { name: '研究 を削除' }),
          ).toHaveProperty('disabled', false),
        WIRING_TIMEOUT,
      );
      await user2.click(screen.getByRole('button', { name: '研究 を削除' }));
      await waitFor(
        () => expect(world.pds.records(ALICE.did, NSID.folder)).toHaveLength(0),
        WIRING_TIMEOUT,
      );
    },
    MERGER_TEST_MS * 2,
  );

  test(
    '同じ階層に同じ名前の Folder は作れない',
    async () => {
      const user = await startOn('alice', ALICE);
      await createFolder(user, '研究');
      await screen.findByRole('button', { name: '研究 の名前を変える' });
      await createFolder(user, '研究');
      await screen.findByText('同じ階層に「研究」という Folder があります');
      await user.click(screen.getByRole('button', { name: 'OK' }));
      // 別の階層なら同じ名前でよい
      await createFolder(user, '研究', '研究');
      await waitFor(
        () => expect(folderNames()).toEqual(['研究', '研究']),
        WIRING_TIMEOUT,
      );
    },
    MERGER_TEST_MS,
  );

  test(
    '2 台が互いを知らずに同じ名前の Folder を作ると、同期の後で後の方が「名前 (2)」に揃う',
    async () => {
      await startOn('alice-2', ALICE);
      // 2 台とも、相手の Folder を読めない間に作る (保留している書き込みは本人の読みにも出ない)
      world.pds.withhold(ALICE.did);
      let user = await startOn('alice', ALICE);
      await createFolder(user, '研究');
      await screen.findByRole('button', { name: '研究 の名前を変える' });
      user = await startOn('alice-2', ALICE);
      await createFolder(user, '研究');
      await screen.findByRole('button', { name: '研究 の名前を変える' });
      world.pds.release(ALICE.did);

      // 同期すると両方が見え、どちらの端末も同じ改名を書く
      await syncNow(user);
      await waitFor(
        () => expect(folderNames()).toEqual(['研究', '研究 (2)']),
        WIRING_TIMEOUT,
      );
      user = await startOn('alice', ALICE);
      await syncNow(user);
      await waitFor(
        () => expect(folderNames()).toEqual(['研究', '研究 (2)']),
        WIRING_TIMEOUT,
      );
      const names = world.pds
        .records(ALICE.did, NSID.folder)
        .map((r) => (r.value as { name: string }).name)
        .sort();
      expect(names).toEqual(['研究', '研究 (2)']);
    },
    MERGER_TEST_MS * 2,
  );
});

describe('App 結合: 知らない種類の op (step3 FPR の確認 §5.3)', () => {
  test(
    '新しい版が書いた知らない op を受け取っても受信は止まらず、同じ batch の知っている op も効く',
    async () => {
      const { code } = await aliceSharesFileWithBob();
      let user = await startOn('bob', BOB);
      await participate(user, code, FILE_NAME);
      await syncNow(user);

      // alice: node を置いて本文を書く。書いた record に、まだ無い種類の op を混ぜる
      // (FPR の後で op を足した新しい版の alice、を表す)
      user = await startOn('alice', ALICE);
      await openFileNamed(user, FILE_NAME);
      const before = new Set(
        world.pds.records(ALICE.did, NSID.batch).map((r) => r.rkey),
      );
      world.pds.withhold(ALICE.did);
      await addNode(user);
      await waitFor(() => expect(renderedNodeCount()).toBe(1), WIRING_TIMEOUT);
      await editOnlyNode(user, '新しい版から');
      await waitFor(
        () => expect(trunkContent()).toBe('新しい版から'),
        WIRING_TIMEOUT,
      );
      world.pds.release(ALICE.did);
      await syncNow(user);
      const written = world.pds
        .records(ALICE.did, NSID.batch)
        .filter((r) => !before.has(r.rkey));
      expect(written.length).toBeGreaterThan(0);
      for (const record of written) {
        (record.value as { ops: unknown[] }).ops.push({
          kind: 'node.futureThing',
          target: 'x',
        });
      }

      // bob: 受け取ると、知っている op (node の追加と本文) が効く
      user = await startOn('bob', BOB);
      await openFileNamed(user, FILE_NAME);
      await syncNow(user);
      await waitFor(
        () => expect(trunkContent()).toBe('新しい版から'),
        WIRING_TIMEOUT,
      );
      // 読み出しには知らない op が出てこない (保存の JSON には残る — eventStore の単体で見ている)
      const stored = world
        .localStore()
        .getBatches(world.localStore().listFiles()[0]?.id as FileId);
      expect(
        stored.some((b) =>
          (b.ops as { kind: string }[]).some(
            (op) => op.kind === 'node.futureThing',
          ),
        ),
      ).toBe(false);

      // その後の編集も届き続ける (受信が止まっていない)
      user = await startOn('alice', ALICE);
      await openFileNamed(user, FILE_NAME);
      await editOnlyNode(user, 'その後の編集');
      await waitFor(
        () => expect(trunkContent()).toBe('その後の編集'),
        WIRING_TIMEOUT,
      );
      await syncNow(user);
      user = await startOn('bob', BOB);
      await openFileNamed(user, FILE_NAME);
      await syncNow(user);
      await waitFor(
        () => expect(trunkContent()).toBe('その後の編集'),
        WIRING_TIMEOUT,
      );
    },
    MERGER_TEST_MS * 2,
  );
});

describe('App 結合: 未ログインの編集を出し直す (FPR 前 L-1)', () => {
  /** ログインせずに File を作って node を置き、本文を書いてからログインする */
  async function drawSignedOutThenLogin() {
    cleanup();
    await world.activate('alice');
    render(<App />);
    const user = userEvent.setup();
    await createFile(user, FILE_NAME);
    await addNode(user);
    await waitFor(() => expect(renderedNodeCount()).toBe(1), WIRING_TIMEOUT);
    await editOnlyNode(user, 'ログイン前');
    await waitFor(
      () => expect(trunkContent()).toBe('ログイン前'),
      WIRING_TIMEOUT,
    );
    // ログインしていない間は、この端末にだけある編集があることを知らせる (L-3)
    const banner = await screen.findByRole(
      'button',
      { name: '未ログインの編集' },
      WIRING_TIMEOUT,
    );
    expect(banner.textContent).toMatch(/この端末にだけ \d+ 件の編集があります/);
    await login(user, ALICE);
    signedInDevices.add('alice');
    return { user };
  }

  /** alice の PDS にある、この File の編集 (File の起源 genesis を除く) の batch の数 */
  const remoteEditCount = () => {
    const fileId = world.localStore().listFiles()[0]?.id as string;
    return world.pds
      .records(ALICE.did, NSID.batch)
      .filter((r) => r.rkey.startsWith(fileId))
      .filter((r) => (r.value as { actor: string }).actor !== 'genesis').length;
  };

  test(
    '未ログインで描いたものは、ログインして送ると答えると、同じ人の別の端末に届く',
    async () => {
      const { user } = await drawSignedOutThenLogin();
      await screen.findByText(
        /ログインしていない間にこの端末で描いた編集が/,
        {},
        WIRING_TIMEOUT,
      );
      expect(
        screen.getByText(new RegExp(`@${ALICE.handle} の編集として`)),
      ).toBeTruthy();
      await user.click(screen.getByRole('button', { name: 'OK' }));
      // 付け替えた batch が自分の repo に載る
      await waitFor(
        () => expect(remoteEditCount()).toBeGreaterThan(0),
        WIRING_TIMEOUT,
      );
      // 手元に未ログインの actor は残らない
      expect(world.localStore().listLocalActorBatches()).toEqual([]);

      // 別の端末: 同じ File が見つかり、ログイン前の本文が出る
      const user2 = await startOn('alice-2', ALICE);
      await syncNow(user2);
      await openFileNamed(user2, FILE_NAME);
      await waitFor(
        () => expect(trunkContent()).toBe('ログイン前'),
        WIRING_TIMEOUT,
      );
    },
    MERGER_TEST_MS * 2,
  );

  test(
    '送らないと答えたら、手元に未ログインのまま残り、編集は PDS に載らない',
    async () => {
      const { user } = await drawSignedOutThenLogin();
      await screen.findByText(
        /ログインしていない間にこの端末で描いた編集が/,
        {},
        WIRING_TIMEOUT,
      );
      await user.click(screen.getByRole('button', { name: 'キャンセル' }));
      await new Promise((r) => setTimeout(r, SETTLE_MS));
      // 編集は送られない。File の起源 (genesis: 名前・最初のシート) は今までどおりログインで送られる
      // (他の端末の発見がそれに乗っている) ので、genesis 以外が無いことを見る
      expect(remoteEditCount()).toBe(0);
      expect(world.localStore().listLocalActorBatches().length).toBeGreaterThan(
        0,
      );
    },
    MERGER_TEST_MS * 2,
  );
});
