/**
 * DOM の無い bun で headless を一周させる script (agent 段 2 H3)。
 *
 * `domFree.test.ts` が**別のプロセス**で `bun run` する。`bun test` は preload で happy-dom を入れる
 * (`bunfig.toml`) ので、テストの中では `window` や `localStorage` が在ってしまい、ブラウザへの依存が
 * 隠れる。ここでは preload が効かない。
 *
 * **最後に `process.exit` を呼ばない。**終われば自分でプロセスが終わることも確かめる対象である
 * (spike S4: ブラウザ版の OAuth を読むと event loop が握られて終わらなかった)。
 */

import { Headless } from '../headless';
import { nodeAdded } from './events';
import { AGENT, ALICE, createHeadlessWorld } from './headlessWorld';

const dom = ['window', 'document', 'localStorage'].filter(
  (name) => name in globalThis,
);
if (dom.length > 0) throw new Error(`DOM がある: ${dom.join(', ')}`);

const world = createHeadlessWorld();
const aliceDir = world.newDataDir();
const agentDir = world.newDataDir();

const alice = await Headless.open(world.options(aliceDir));
await alice.signIn(ALICE.handle, ALICE.password);
const fileId = await alice.createFile('DOM の無い世界');
const code = await alice.invite(fileId, AGENT.did);
await alice.sync(fileId);
await alice.close();

const agent = await Headless.open(world.options(agentDir));
await agent.signIn(AGENT.handle, AGENT.password);
await agent.accept(code);
const sheet = agent.read(fileId).sheets[0];
if (!sheet) throw new Error('Sheet が無い');
agent.record(fileId, sheet.id, nodeAdded('agent が書いた').event);
await agent.sync(fileId);
await agent.close();

const reader = await Headless.open(world.options(aliceDir));
await reader.sync(fileId);
const contents = (reader.read(fileId).sheets[0]?.nodes ?? []).map(
  (n) => n.content,
);
await reader.close();
world.dispose();

// 結果は 1 行の JSON で親に渡す (他のログと混ざらないよう印を付ける)
console.log(
  `RESULT ${JSON.stringify({ contents, unhandled: world.unhandled })}`,
);
