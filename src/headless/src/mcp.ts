/**
 * MCP server: agent が conversensus を読み書きする入口 (agent 段 3 M3, 設計 D3・D4, #349)
 *
 * `Headless` の上に、読む道具 (完全な encoding) と書く道具 (op に 1 対 1、`tools.ts`) を載せる。
 * Claude Code などの MCP client が stdio で起動する:
 *
 * ```sh
 * bun run src/headless/src/cli.ts login agent.test     # 先に一度だけ (ブラウザで同意する)
 * claude mcp add conversensus -- bun run <repo>/src/headless/src/mcp.ts [--data <dir>] [--pds <url>]
 * ```
 *
 * - **ログインは CLI で済ませておく。**stdio の server はブラウザの同意を待てないので、ここは
 *   前のセッションを戻す (`resume`) だけである
 * - **書いたら送る。**道具 1 回ごとに同期する (送信と受信)。読む道具も読む前に同期する。
 *   常駐して合図で受信するのは段 5
 * - **標準出力は MCP の通信路**なので、client の部品が出す `console.log` は標準エラーへ回す
 */

import { join } from 'node:path';
import type { GraphEvent } from '@conversensus/client/src/events/GraphEvent';
import {
  answerRequest,
  closeRequest,
  reopenRequest,
  sendRequest,
  setAddressee,
} from '@conversensus/client/src/request/requestEvents';
import {
  type Did,
  type FileId,
  FileIdSchema,
  type GraphNode,
  sentCountOf,
} from '@conversensus/shared';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { DEFAULT_DATA_DIR, DEFAULT_PDS_URL, OAUTH_FILE } from './cli';
import { Headless } from './headless';
import { oauthLoopback } from './oauthLoopback';
import {
  addEdge,
  addNode,
  moveNode,
  removeEdge,
  removeNode,
  setEdgeLabel,
  setEdgeProperty,
  setNodeContent,
  setNodeProperty,
  type ToolContext,
  ToolError,
} from './tools';

/** server の名前と版 (MCP の初期化で client に名乗る) */
const SERVER_INFO = { name: 'conversensus', version: '0.1.0' };

/** agent への全体の説明 (MCP の `instructions`)。道具をどう組み合わせるか */
const INSTRUCTIONS = `conversensus はグラフ (node と edge) で議論や考えを書く道具です。あなたは agent として、自分の DID で File に参加して読み書きします。人間の参加者と同じ立場で、書いたものは参加者全員に届きます。

- list_files で参加している File と Sheet を見て、read_file で File を読みます。read_file の出力は File の完全な encoding です。値は JSON で、\`#\` で始まる行は注釈 (種別の一覧と説明、種別の名前、property の種類) です
- 書く道具には read_file に出た id (fileId・sheetId・nodeId・edgeId) を渡します
- Sheet に template が当たっていれば、注釈 \`# template\` に node と edge の種別の id があります。種別は node・edge を作るときにだけ付けられます。種別の説明は、その種別をどう使うかの指示です
- system の property (app.conversensus.*) と種別の property は書き換えられません
- 書くと、すぐ参加者に送られます。大きく書き換える前には、人間に確かめてください
- **依頼・相談** (応答を求める node): list_requests で自分宛ての未回答の依頼を見つけ、read_file で依頼のある File を読んで文脈をつかみ、answer_request で答えます。依頼の本文が指示です。種類ごとの指示は種類の説明 (\`# template\` の注釈) にあります。答えられないときは、その理由を答えとして書いてください
- 自分から依頼することもできます: 依頼の種類で add_node し、set_addressee で宛先 (list_participants の DID) を選び、send_request で送ります`;

/** 書く先の指定 (書く道具に共通) */
const where = {
  fileId: z.string().uuid().describe('File の id'),
  sheetId: z.string().uuid().describe('書く Sheet の id'),
};
const propertyValue = z
  .unknown()
  .optional()
  .describe('JSON の値。省くとその property を消す');

type ToolResult = {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
};

const text = (t: string): ToolResult => ({
  content: [{ type: 'text', text: t }],
});

/** 例外を道具の失敗として返す (agent が理由を読んで直せるように) */
async function guarded(run: () => Promise<string>): Promise<ToolResult> {
  try {
    return text(await run());
  } catch (error) {
    return {
      ...text(error instanceof Error ? error.message : String(error)),
      isError: true,
    };
  }
}

function fileIdOf(value: string): FileId {
  return FileIdSchema.parse(value);
}

/** MCP server を組む (transport はつながない。テストは in-memory でつなぐ) */
export function createMcpServer(headless: Headless): McpServer {
  const server = new McpServer(SERVER_INFO, { instructions: INSTRUCTIONS });

  /**
   * 書く道具の共通の流れ: 前の書き込みが正典に入るのを待ち、今の Sheet を見て GraphEvent を作り、
   * 書いて送る
   */
  const write = (
    args: { fileId: string; sheetId: string },
    make: (ctx: ToolContext) => { event: GraphEvent; report: string },
  ) =>
    guarded(async () => {
      const fileId = fileIdOf(args.fileId);
      await headless.settled(fileId);
      const ctx = headless.toolContext(fileId, args.sheetId);
      const { event, report } = make(ctx);
      headless.record(fileId, ctx.sheet.id, event);
      await headless.sync(fileId);
      return report;
    });

  server.registerTool(
    'whoami',
    { description: 'agent として名乗っている DID と actor (did#端末) を返す' },
    () => guarded(async () => `${headless.did} (${headless.actor})`),
  );

  server.registerTool(
    'list_files',
    {
      description:
        '参加している File を見つけて、File と Sheet の id と名前の一覧を返す',
    },
    () =>
      guarded(async () => {
        await headless.discover();
        const files = await headless.files();
        if (files.length === 0) return '(参加している File は無い)';
        return files
          .map((f) =>
            [
              `file ${f.id} ${JSON.stringify(f.name)}`,
              ...f.sheets.map(
                (s) => `  sheet ${s.id} ${JSON.stringify(s.name)}`,
              ),
            ].join('\n'),
          )
          .join('\n');
      }),
  );

  server.registerTool(
    'accept_invitation',
    {
      description:
        '人間から受け取った参加コードで File に参加する。参加した File の id を返す',
      inputSchema: { code: z.string().describe('参加コード') },
    },
    ({ code }) =>
      guarded(async () => {
        const fileId = await headless.accept(code);
        return `参加した: ${fileId} ${JSON.stringify(headless.read(fileId).name)}`;
      }),
  );

  server.registerTool(
    'read_file',
    {
      description:
        'File を同期して、trunk を完全な encoding で返す (id・本文・property・位置を欠けなく)',
      inputSchema: { fileId: where.fileId },
    },
    ({ fileId }) =>
      guarded(async () => {
        const id = fileIdOf(fileId);
        await headless.sync(id);
        return headless.encode(id);
      }),
  );

  server.registerTool(
    'add_node',
    {
      description:
        'node を足す。kind は種別の id (read_file の `# template` の行)。x・y を省くと既存の node の下に置く。足した node の id を返す',
      inputSchema: {
        ...where,
        content: z.string().describe('本文 (markdown)'),
        kind: z.string().optional().describe('node の種別の id'),
        properties: z
          .record(z.string(), z.unknown())
          .optional()
          .describe('property (名前 → JSON の値)'),
        parentId: z
          .string()
          .uuid()
          .optional()
          .describe('入れる group の node の id'),
        x: z.number().optional(),
        y: z.number().optional(),
      },
    },
    ({ fileId, sheetId, ...args }) =>
      write({ fileId, sheetId }, (ctx) => {
        const { event, nodeId } = addNode(ctx, args);
        return { event, report: `node ${nodeId} を足した` };
      }),
  );

  server.registerTool(
    'set_node_content',
    {
      description: 'node の本文を書き換える',
      inputSchema: { ...where, nodeId: z.string().uuid(), content: z.string() },
    },
    ({ fileId, sheetId, ...args }) =>
      write({ fileId, sheetId }, (ctx) => ({
        event: setNodeContent(ctx, args),
        report: `node ${args.nodeId} の本文を変えた`,
      })),
  );

  server.registerTool(
    'set_node_property',
    {
      description: 'node の property を 1 つ書く (value を省くと消す)',
      inputSchema: {
        ...where,
        nodeId: z.string().uuid(),
        name: z.string(),
        value: propertyValue,
      },
    },
    ({ fileId, sheetId, ...args }) =>
      write({ fileId, sheetId }, (ctx) => ({
        event: setNodeProperty(ctx, args),
        report: `node ${args.nodeId} の property ${args.name} を変えた`,
      })),
  );

  server.registerTool(
    'move_node',
    {
      description: 'node を動かす (group の中では親からの相対の位置)',
      inputSchema: {
        ...where,
        nodeId: z.string().uuid(),
        x: z.number(),
        y: z.number(),
      },
    },
    ({ fileId, sheetId, ...args }) =>
      write({ fileId, sheetId }, (ctx) => ({
        event: moveNode(ctx, args),
        report: `node ${args.nodeId} を動かした`,
      })),
  );

  server.registerTool(
    'remove_node',
    {
      description: 'node を消す (繋がった edge も消える)',
      inputSchema: { ...where, nodeId: z.string().uuid() },
    },
    ({ fileId, sheetId, ...args }) =>
      write({ fileId, sheetId }, (ctx) => ({
        event: removeNode(ctx, args),
        report: `node ${args.nodeId} を消した`,
      })),
  );

  server.registerTool(
    'add_edge',
    {
      description:
        'edge を足す。両端に種別があれば、edge の種別は template の規則に従う (候補が 1 つなら自動、複数なら kind で選ぶ)。足した edge の id を返す',
      inputSchema: {
        ...where,
        source: z.string().uuid().describe('始点の node の id'),
        target: z.string().uuid().describe('終点の node の id'),
        kind: z.string().optional().describe('edge の種別の id'),
        label: z.string().optional().describe('種別の無い edge の label'),
        properties: z.record(z.string(), z.unknown()).optional(),
      },
    },
    ({ fileId, sheetId, ...args }) =>
      write({ fileId, sheetId }, (ctx) => {
        const { event, edgeId } = addEdge(ctx, args);
        return { event, report: `edge ${edgeId} を足した` };
      }),
  );

  server.registerTool(
    'set_edge_label',
    {
      description: '種別の無い edge の label を書き換える',
      inputSchema: { ...where, edgeId: z.string().uuid(), label: z.string() },
    },
    ({ fileId, sheetId, ...args }) =>
      write({ fileId, sheetId }, (ctx) => ({
        event: setEdgeLabel(ctx, args),
        report: `edge ${args.edgeId} の label を変えた`,
      })),
  );

  server.registerTool(
    'set_edge_property',
    {
      description: 'edge の property を 1 つ書く (value を省くと消す)',
      inputSchema: {
        ...where,
        edgeId: z.string().uuid(),
        name: z.string(),
        value: propertyValue,
      },
    },
    ({ fileId, sheetId, ...args }) =>
      write({ fileId, sheetId }, (ctx) => ({
        event: setEdgeProperty(ctx, args),
        report: `edge ${args.edgeId} の property ${args.name} を変えた`,
      })),
  );

  server.registerTool(
    'remove_edge',
    {
      description: 'edge を消す',
      inputSchema: { ...where, edgeId: z.string().uuid() },
    },
    ({ fileId, sheetId, ...args }) =>
      write({ fileId, sheetId }, (ctx) => ({
        event: removeEdge(ctx, args),
        report: `edge ${args.edgeId} を消した`,
      })),
  );

  // --- 依頼・相談 (agent 段 4 R6) ---

  /** 書く先の Sheet の、応答を求める node */
  const requestIn = (ctx: ToolContext, nodeId: string): GraphNode => {
    const node = ctx.sheet.nodes.find((n) => n.id === nodeId);
    if (!node) throw new ToolError(`この Sheet に node ${nodeId} は無い`);
    return node;
  };
  const target = {
    ...where,
    nodeId: z.string().uuid().describe('依頼の node の id'),
  };

  server.registerTool(
    'list_participants',
    {
      description: 'File の参加者の DID とハンドル名を返す (依頼の宛先に使う)',
      inputSchema: { fileId: where.fileId },
    },
    ({ fileId }) =>
      guarded(async () => {
        const list = await headless.participants(fileIdOf(fileId));
        return list.map((p) => `${p.did} ${p.handle}`).join('\n');
      }),
  );

  server.registerTool(
    'list_requests',
    {
      description:
        '自分宛ての未回答の依頼を返す (同期してから)。fileId を省くと、参加している File すべてを見る。自分が送った依頼は出さない',
      inputSchema: { fileId: where.fileId.optional() },
    },
    ({ fileId }) =>
      guarded(async () => {
        let ids: FileId[];
        if (fileId) {
          ids = [fileIdOf(fileId)];
        } else {
          await headless.discover();
          ids = (await headless.files()).map((f) => f.id as FileId);
        }
        const lines: string[] = [];
        for (const id of ids) {
          await headless.sync(id);
          for (const r of headless.requestsForMe(id)) {
            lines.push(
              `request ${r.node.id} file ${id} sheet ${r.sheet.id} (${sentCountOf(r.node)} 回目) from ${r.from ?? '?'}`,
              `  content ${JSON.stringify(r.node.content)}`,
            );
          }
        }
        return lines.length > 0
          ? lines.join('\n')
          : '(自分宛ての未回答の依頼は無い)';
      }),
  );

  server.registerTool(
    'answer_request',
    {
      description:
        '依頼に答える: 答えを新しい node に書き、依頼からその node へ edge を張る (edge に何回目の送信への答えかが付く)。答えの node の id を返す',
      inputSchema: {
        ...target,
        content: z.string().describe('答えの本文 (markdown)'),
        label: z.string().optional().describe('答えの edge の label (省略可)'),
      },
    },
    ({ fileId, sheetId, nodeId, content, label }) =>
      write({ fileId, sheetId }, (ctx) => {
        const answered = answerRequest(ctx.sheet, requestIn(ctx, nodeId), {
          content,
          ...(label !== undefined && { edgeLabel: label }),
        });
        return {
          event: answered.event,
          report: `答えた: node ${answered.nodeId} (edge ${answered.edgeId})`,
        };
      }),
  );

  server.registerTool(
    'send_request',
    {
      description:
        '依頼を送る (送り直す)。宛先 (空なら参加者全員) に知らせが届く。閉じた依頼は送れない',
      inputSchema: target,
    },
    ({ fileId, sheetId, nodeId }) =>
      write({ fileId, sheetId }, (ctx) => ({
        event: sendRequest(requestIn(ctx, nodeId)),
        report: `node ${nodeId} を送った`,
      })),
  );

  server.registerTool(
    'close_request',
    { description: '依頼を閉じる', inputSchema: target },
    ({ fileId, sheetId, nodeId }) =>
      write({ fileId, sheetId }, (ctx) => ({
        event: closeRequest(requestIn(ctx, nodeId)),
        report: `node ${nodeId} を閉じた`,
      })),
  );

  server.registerTool(
    'reopen_request',
    { description: '閉じた依頼を開き直す', inputSchema: target },
    ({ fileId, sheetId, nodeId }) =>
      write({ fileId, sheetId }, (ctx) => ({
        event: reopenRequest(requestIn(ctx, nodeId)),
        report: `node ${nodeId} を開き直した`,
      })),
  );

  server.registerTool(
    'set_addressee',
    {
      description:
        '依頼の宛先を置き換える (DID の列。空なら不特定 = 参加者全員)。DID は list_participants で引く',
      inputSchema: { ...target, dids: z.array(z.string()) },
    },
    ({ fileId, sheetId, nodeId, dids }) =>
      write({ fileId, sheetId }, (ctx) => ({
        event: setAddressee(requestIn(ctx, nodeId), dids as Did[]),
        report: `node ${nodeId} の宛先を変えた`,
      })),
  );

  return server;
}

/** 引数から置き場所と PDS を読む (`--data <dir>`、`--pds <url>`) */
export function parseServerArgs(argv: readonly string[]): {
  dataDir: string;
  pdsUrl: string;
} {
  let dataDir = DEFAULT_DATA_DIR;
  let pdsUrl = DEFAULT_PDS_URL;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if ((arg === '--data' || arg === '--pds') && next === undefined) {
      throw new Error(`${arg} の値が無い`);
    }
    if (arg === '--data') dataDir = next as string;
    else if (arg === '--pds') pdsUrl = next as string;
    else throw new Error(`知らない引数: ${arg}`);
    i++;
  }
  return { dataDir, pdsUrl };
}

if (import.meta.main) {
  // 標準出力は MCP の通信路。client の部品のログで壊さない
  console.log = console.error;
  console.info = console.error;
  const { dataDir, pdsUrl } = parseServerArgs(process.argv.slice(2));
  const headless = await Headless.open({
    dataDir,
    auth: oauthLoopback({
      pdsUrl,
      storePath: join(dataDir, OAUTH_FILE),
      openUrl: () => {
        throw new Error(
          'MCP server からはログインしない。先に cli.ts login を使う',
        );
      },
    }),
  });
  const server = createMcpServer(headless);
  const close = async () => {
    await server.close();
    await headless.close();
    process.exit(0);
  };
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
  // client が stdin を閉じたら終わる
  process.stdin.on('end', close);
  await server.connect(new StdioServerTransport());
}
