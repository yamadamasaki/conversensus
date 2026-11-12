/**
 * headless を手で動かす CLI (agent 段 2 H5)
 *
 * 開発用の PDS で、agent 用のアカウントとして参加・同期・読み書きを確かめるための道具である。
 * 段 3 の MCP server は同じ `Headless` の上に載る。
 *
 * ```sh
 * bun run src/headless/src/cli.ts login agent.test      # ブラウザで同意する
 * bun run src/headless/src/cli.ts accept <参加コード>
 * bun run src/headless/src/cli.ts files
 * bun run src/headless/src/cli.ts show <fileId>
 * bun run src/headless/src/cli.ts add <fileId> "本文"
 * ```
 *
 * 置き場所 (`--data`) の既定は `~/.conversensus/agent`。PDS (`--pds`) の既定は開発用の PDS。
 * 1 つの置き場所 = 1 つの端末 (actor) である。
 */

import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  type AgentDeclaration,
  type FileId,
  FileIdSchema,
  type NodeId,
  type SheetId,
} from '@conversensus/shared';
import { Headless } from './headless';
import { oauthLoopback } from './oauthLoopback';
import { forTerminal } from './terminalText';

/** 既定の PDS (開発用。`deepse/requirements/user-test-environment.md` §1) */
export const DEFAULT_PDS_URL = 'http://localhost:3000';
/** ブラウザで開いてよい URL の scheme (#391) */
const BROWSER_SCHEMES = new Set(['https:', 'http:']);
/** 既定の置き場所 */
export const DEFAULT_DATA_DIR = join(homedir(), '.conversensus', 'agent');
/** OAuth のセッションを置く file (`dataDir` の中) */
export const OAUTH_FILE = 'oauth.json';

export type Command =
  | { kind: 'login'; handle: string }
  | { kind: 'logout' }
  | { kind: 'whoami' }
  | { kind: 'accept'; code: string }
  | { kind: 'files' }
  | { kind: 'show'; fileId: FileId }
  | { kind: 'add'; fileId: FileId; content: string }
  | {
      kind: 'profile';
      /** 書くときの operator (ハンドル名か DID)。無ければ今の宣言を出す */
      operator?: string;
      model?: string;
      description?: string;
    };

export type Parsed = {
  command: Command;
  dataDir: string;
  pdsUrl: string;
  /** 同意のページをブラウザで自動で開くか */
  open: boolean;
};

export const USAGE = `使い方: cli.ts [--data <dir>] [--pds <url>] [--no-open] <command>
  login <handle>        ブラウザで同意してログインする
  logout                ログアウトする
  whoami                ログインしている DID と actor
  accept <code>         参加コードで File に参加する
  files                 手元に無い File を見つけて、一覧を出す
  show <fileId>         File を同期して、Sheet ごとの node を出す
  add <fileId> <text>   File の最初の Sheet に node を足して送る
  profile [<operator>] [--model <m>] [--description <d>]
                        agent であると宣言する (operator はハンドル名か DID)。
                        operator を省くと今の宣言と裏付けを出す`;

/** File の id を検める (branded UUID。境界で検証する規約) */
function fileIdOf(value: string | undefined): FileId {
  const parsed = FileIdSchema.safeParse(value);
  if (!parsed.success) throw new Error(`File の id ではない: ${value}`);
  return parsed.data;
}

/** 引数を読む。読めなければ理由つきで例外 */
export function parseArgs(argv: readonly string[]): Parsed {
  let dataDir = DEFAULT_DATA_DIR;
  let pdsUrl = DEFAULT_PDS_URL;
  let open = true;
  /** `profile` の選択肢 */
  const profileOptions: { model?: string; description?: string } = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === '--data' || arg === '--pds') {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`${arg} の値が無い`);
      if (arg === '--data') dataDir = value;
      else pdsUrl = value;
      i++;
    } else if (arg === '--model' || arg === '--description') {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`${arg} の値が無い`);
      profileOptions[arg === '--model' ? 'model' : 'description'] = value;
      i++;
    } else if (arg === '--no-open') {
      open = false;
    } else {
      rest.push(arg);
    }
  }
  const [name, ...params] = rest;
  const need = (count: number): string[] => {
    if (params.length !== count) {
      throw new Error(`${name} は引数を ${count} つ取る`);
    }
    return params;
  };
  let command: Command;
  switch (name) {
    case 'login':
      command = { kind: 'login', handle: need(1)[0] as string };
      break;
    case 'logout':
    case 'whoami':
    case 'files':
      need(0);
      command = { kind: name };
      break;
    case 'accept':
      command = { kind: 'accept', code: need(1)[0] as string };
      break;
    case 'show':
      command = { kind: 'show', fileId: fileIdOf(need(1)[0]) };
      break;
    case 'add': {
      const [fileId, content] = need(2) as [string, string];
      command = { kind: 'add', fileId: fileIdOf(fileId), content };
      break;
    }
    case 'profile': {
      if (params.length > 1) throw new Error('profile は引数を 0 か 1 つ取る');
      const [operator] = params;
      if (operator === undefined && Object.keys(profileOptions).length > 0) {
        throw new Error('--model・--description は operator と一緒に渡す');
      }
      command = {
        kind: 'profile',
        ...(operator !== undefined && { operator }),
        ...profileOptions,
      };
      break;
    }
    default:
      throw new Error(name ? `知らないコマンド: ${name}` : 'コマンドが無い');
  }
  if (command.kind !== 'profile' && Object.keys(profileOptions).length > 0) {
    throw new Error('--model・--description は profile だけが取る');
  }
  return { command, dataDir, pdsUrl, open };
}

/** File を Sheet ごとの node の一覧として出す */
function describe(headless: Headless, fileId: FileId): string {
  const file = headless.read(fileId);
  const lines = [`${file.name} (${fileId})`];
  for (const sheet of file.sheets) {
    lines.push(`  [${sheet.name}]`);
    for (const node of sheet.nodes) lines.push(`    - ${node.content}`);
  }
  return lines.join('\n');
}

/** agent の宣言を 1 行で */
export function describeDeclaration(declaration: AgentDeclaration): string {
  if (declaration.status === 'none') return 'agent の宣言: なし';
  const state =
    declaration.status === 'verified'
      ? '裏付けあり'
      : '名乗りのみ (operator がまだ App で認めていない)';
  return [
    `agent の宣言: ${state}`,
    `  operator ${declaration.operator}`,
    ...(declaration.model ? [`  model ${declaration.model}`] : []),
    ...(declaration.description
      ? [`  description ${declaration.description}`]
      : []),
  ].join('\n');
}

async function run(parsed: Parsed): Promise<string> {
  const { command, dataDir, pdsUrl, open } = parsed;
  mkdirSync(dataDir, { recursive: true });
  const headless = await Headless.open({
    dataDir,
    auth: oauthLoopback({
      pdsUrl,
      storePath: join(dataDir, OAUTH_FILE),
      openUrl: (url) => {
        // 開くのは同意のページ (http か https) だけ。`open` は file: や他の scheme の app も開く (#391)
        if (!BROWSER_SCHEMES.has(url.protocol)) {
          throw new Error(
            `同意のページの URL が http(s) でない: ${url.protocol}`,
          );
        }
        console.error(`ブラウザで同意してください:\n${forTerminal(url.href)}`);
        if (open) Bun.spawn(['open', url.href]);
      },
    }),
  });
  try {
    switch (command.kind) {
      case 'login':
        return `ログインした: ${await headless.signIn(command.handle)} (${headless.actor})`;
      case 'logout':
        await headless.signOutAndClose();
        return 'ログアウトした';
      case 'whoami':
        return `${headless.did} (${headless.actor})\n${describeDeclaration(
          await headless.agentDeclaration(),
        )}`;
      case 'profile': {
        if (command.operator !== undefined) {
          await headless.declareAgent({
            operator: command.operator,
            ...(command.model !== undefined && { model: command.model }),
            ...(command.description !== undefined && {
              description: command.description,
            }),
          });
        }
        return describeDeclaration(await headless.agentDeclaration());
      }
      case 'accept': {
        const fileId = await headless.accept(command.code);
        return `参加した: ${describe(headless, fileId)}`;
      }
      case 'files': {
        await headless.discover();
        const files = await headless.files();
        return (
          files.map((f) => `${f.id}  ${f.name}`).join('\n') || '(File は無い)'
        );
      }
      case 'show':
        await headless.sync(command.fileId);
        return describe(headless, command.fileId);
      case 'add': {
        await headless.sync(command.fileId);
        const sheet = headless.read(command.fileId).sheets[0];
        if (!sheet) throw new Error('Sheet が無い');
        const nodeId = crypto.randomUUID() as NodeId;
        headless.record(command.fileId, sheet.id as SheetId, {
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          category: 'structure',
          type: 'NODE_ADDED',
          nodeId,
          data: { id: nodeId, content: command.content },
        });
        await headless.sync(command.fileId);
        return describe(headless, command.fileId);
      }
    }
  } finally {
    await headless.close();
  }
}

if (import.meta.main) {
  try {
    // File の本文は他の参加者が書いたもの。端末の命令を落としてから出す (#391)
    console.log(forTerminal(await run(parseArgs(process.argv.slice(2)))));
  } catch (error) {
    console.error(
      forTerminal(error instanceof Error ? error.message : String(error)),
    );
    console.error(USAGE);
    process.exitCode = 1;
  }
}
