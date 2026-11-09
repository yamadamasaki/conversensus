/**
 * MCP server: agent が conversensus を読み書きする入口 (agent 段 3 M3, 設計 D3・D4, #349)
 *
 * `Headless` の上に、読む道具 (完全な encoding) と書く道具 (op に 1 対 1、`tools.ts`) を載せる。
 * stdio で起動する入口は `mcp.ts`、常駐の agent は HTTP で出す (`resident/httpMcp.ts`)。
 *
 * - **書いたら送る。**道具 1 回ごとに同期する (送信と受信)。読む道具も読む前に同期する
 * - **module の道具を足す** (計画 node-actions-request-module.md B3)。依頼の道具などは module が
 *   `HeadlessModule` として出し、ここは module を知らない。どの module を使うかは入口が決める
 */

import type { GraphEvent } from '@conversensus/client/src/events/GraphEvent';
import {
  type FileId,
  FileIdSchema,
  type GraphEdge,
  type GraphNode,
} from '@conversensus/shared';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Headless } from './headless';
import type { HeadlessModule, McpKit, ToolResult } from './headlessModule';
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
- list_participants で File の参加者の DID とハンドル名が分かります`;

/** 書く先の指定 (書く道具に共通) */
const where = {
  fileId: z.string().uuid().describe('File の id'),
  sheetId: z.string().uuid().describe('書く Sheet の id'),
};
const propertyValue = z
  .unknown()
  .optional()
  .describe('JSON の値。省くとその property を消す');

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

/**
 * MCP server を組む (transport はつながない。テストは in-memory でつなぐ)。`modules` の説明・道具・
 * node の注釈を足す (登録の順)
 */
export function createMcpServer(
  headless: Headless,
  modules: readonly HeadlessModule[] = [],
): McpServer {
  const instructions = [
    INSTRUCTIONS,
    ...modules.flatMap((m) => (m.instructions ? [m.instructions] : [])),
  ].join('\n');
  const server = new McpServer(SERVER_INFO, { instructions });
  /** `read_file` の encoding で node に添える module の注釈 */
  const annotateNode = (node: GraphNode, edges: readonly GraphEdge[]) =>
    modules.flatMap((m) => m.annotateNode?.(node, edges) ?? []);

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
        return headless.encode(id, annotateNode);
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

  server.registerTool(
    'list_participants',
    {
      description: 'File の参加者の DID とハンドル名を返す',
      inputSchema: { fileId: where.fileId },
    },
    ({ fileId }) =>
      guarded(async () => {
        const list = await headless.participants(fileIdOf(fileId));
        return list.map((p) => `${p.did} ${p.handle}`).join('\n');
      }),
  );

  const kit: McpKit = { server, headless, write, guarded, fileIdOf, where };
  for (const m of modules) m.registerTools?.(kit);

  return server;
}
