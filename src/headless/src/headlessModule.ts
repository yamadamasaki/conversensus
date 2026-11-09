/**
 * headless の module の口 (計画 node-actions-request-module.md B3)
 *
 * 画面の module (`NodeModule`) と同じく、core から切り出した機能 (依頼など) が headless に足すものを宣言する。
 * headless の library (`mcpServer.ts`・`encoding.ts`) は module を知らず、どの module を使うかは入口
 * (`mcp.ts`・`resident/resident.ts`) が決める。
 */

import type { GraphEvent } from '@conversensus/client/src/events/GraphEvent';
import type { FileId, GraphEdge, GraphNode } from '@conversensus/shared';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { z } from 'zod';
import type { Headless } from './headless';
import type { ToolContext } from './tools';

/** MCP の道具が返すもの */
export type ToolResult = {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
};

/** module が MCP の道具を足すときに使う、server と共通の流れ */
export type McpKit = {
  server: McpServer;
  headless: Headless;
  /**
   * 書く道具の共通の流れ: 前の書き込みが正典に入るのを待ち、今の Sheet を見て GraphEvent を作り、
   * 書いて送る。`make` が投げた理由は `isError` で返す
   */
  write: (
    args: { fileId: string; sheetId: string },
    make: (ctx: ToolContext) => { event: GraphEvent; report: string },
  ) => Promise<ToolResult>;
  /** 例外を道具の失敗として返す (agent が理由を読んで直せるように) */
  guarded: (run: () => Promise<string>) => Promise<ToolResult>;
  fileIdOf: (value: string) => FileId;
  /** 書く先の指定 (fileId・sheetId) の入力の形 */
  where: { fileId: z.ZodString; sheetId: z.ZodString };
};

export type HeadlessModule = {
  id: string;
  /** MCP の `instructions` に足す説明 (agent に道具の組み合わせ方を伝える) */
  instructions?: string;
  /** MCP の道具を足す */
  registerTools?: (kit: McpKit) => void;
  /**
   * `read_file` の encoding で node に添える注釈 (行頭の `# ` は core が付ける)。状態のように、property から
   * 導くものを agent に読ませる
   */
  annotateNode?: (node: GraphNode, edges: readonly GraphEdge[]) => string[];
};
