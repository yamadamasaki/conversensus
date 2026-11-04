/**
 * 場面の組み立て (step4: 入門の図の下ごしらえ)
 *
 * 「File を作り、Sheet に node を置き、edge で結ぶ」を短く書いて、`.conversensus` の形にする。
 * 入門の図を撮るスクリプトは、写らない下ごしらえをこれで作って import する
 * (`deepse/architecture/step4/intro-guide-figures.md` §2)。
 *
 * **語彙は op ではなく、利用者の操作の単位**である (Sheet を足す、node を置く、edge で結ぶ)。
 * agent を actor として参加させる相談で、MCP の tool の語彙の下敷きにするつもりでいる。
 *
 * 決まりごとを 1 つだけ抱えている: **metagraph の graph node は保存しない** (`derivedNode.ts`)。
 * graph node を置く (`placeGraphNode`) と、その Sheet の導出 node の id に layout を付ける。
 * import がその id を新しい Sheet の導出 node に付け替える (`LocalStore.importFile`)。
 */

import { IMAGE_PROPERTY_KEY } from '../blob';
import { derivedNodeIdOf } from '../events/derivedNode';
import { deterministicUuid } from '../events/genesis';
import { METAGRAPH_SHEET_KIND, SHEET_KIND_PROPERTY } from '../events/sheetKind';
import {
  CONVERSENSUS_FILE_VERSION,
  type ConversensusFile,
  type EdgeId,
  type EdgeLabel,
  type ExportedBlob,
  type FileId,
  type GraphEdge,
  type GraphNode,
  type NodeContent,
  type NodeId,
  type NodeLabel,
  type NodeLayout,
  type Sheet,
  type SheetId,
} from '../schemas';

/** node の既定の大きさ (画面で新しく作ったときと同じ) */
const DEFAULT_NODE_WIDTH = 160;
const DEFAULT_NODE_HEIGHT = 80;

/** 同梱する画像。`size` はバイト数 (参照に載る) */
export type ImageBlob = ExportedBlob & { size: number };

export type Position = { x: number; y: number };
export type Size = { width: number; height: number };

export type NodeSpec = {
  at: Position;
  size?: Size;
  label?: NodeLabel;
  properties?: Record<string, unknown>;
  /** group の中に置くとき、その group */
  parent?: NodeId;
};

/** 1 枚の Sheet を組み立てる */
export class SheetBuilder {
  readonly id: SheetId;
  readonly name: string;
  private readonly file: FileBuilder;
  private readonly properties: Record<string, unknown> | undefined;
  private readonly nodes: GraphNode[] = [];
  private readonly edges: GraphEdge[] = [];
  private readonly layouts: NodeLayout[] = [];

  constructor(
    file: FileBuilder,
    name: string,
    properties?: Record<string, unknown>,
  ) {
    this.file = file;
    this.name = name;
    this.properties = properties;
    this.id = file.idFor(`sheet:${name}`) as SheetId;
  }

  /** markdown の node を置く */
  note(content: NodeContent, spec: NodeSpec): NodeId {
    return this.add({ content }, spec);
  }

  /** group を置く。中に入れる node は `parent` に返り値を渡す */
  group(content: NodeContent, spec: NodeSpec): NodeId {
    return this.add({ content, nodeType: 'group' }, spec);
  }

  /**
   * 画像の node を置く。画像の実体は File に同梱する — 同梱しないと、import した先で
   * 「画像を読み込めません」になる (`.conversensus` の存在理由, ANA-116 D1)
   */
  image(blob: ImageBlob, spec: NodeSpec): NodeId {
    this.file.attach(blob);
    const ref = {
      $type: 'blob',
      ref: { $link: blob.cid },
      mimeType: blob.mimeType,
      size: blob.size,
    };
    return this.add(
      {
        content: '',
        nodeType: 'image',
        properties: { [IMAGE_PROPERTY_KEY]: ref },
      },
      spec,
    );
  }

  /** metagraph に、ある Sheet の graph node を置く (graph node 自体は導出される) */
  placeGraphNode(sheet: SheetBuilder, at: Position): NodeId {
    const id = derivedNodeIdOf(sheet.id);
    this.layouts.push({ nodeId: id, ...at });
    return id;
  }

  /** source から target へ向きの付いた edge で結ぶ */
  connect(source: NodeId, target: NodeId, label?: EdgeLabel): EdgeId {
    const id = this.file.idFor(
      `edge:${this.name}:${this.edges.length}`,
    ) as EdgeId;
    this.edges.push({
      id,
      source,
      target,
      ...(label !== undefined && { label }),
    });
    return id;
  }

  build(): Sheet {
    return {
      id: this.id,
      name: this.name,
      ...(this.properties && { properties: this.properties }),
      nodes: this.nodes,
      edges: this.edges,
      layouts: this.layouts,
    };
  }

  private add(
    base: Pick<GraphNode, 'content' | 'nodeType'> & {
      properties?: Record<string, unknown>;
    },
    spec: NodeSpec,
  ): NodeId {
    const id = this.file.idFor(
      `node:${this.name}:${this.nodes.length}`,
    ) as NodeId;
    const properties = { ...base.properties, ...spec.properties };
    this.nodes.push({
      id,
      content: base.content,
      ...(spec.label !== undefined && { label: spec.label }),
      ...(Object.keys(properties).length > 0 && { properties }),
      ...(base.nodeType && { nodeType: base.nodeType }),
      ...(spec.parent !== undefined && { parentId: spec.parent }),
    });
    this.layouts.push({
      nodeId: id,
      ...spec.at,
      width: spec.size?.width ?? DEFAULT_NODE_WIDTH,
      height: spec.size?.height ?? DEFAULT_NODE_HEIGHT,
    });
    return id;
  }
}

/**
 * 1 つの File を組み立てる。
 *
 * **id は名前から決まる** (`deterministicUuid`)。同じ場面からは同じ `.conversensus` ができるので、
 * 撮り直しても差分が出ない。どうせ import が id を振り直すので、一意であれば足りる
 */
export class FileBuilder {
  private readonly sheets: SheetBuilder[] = [];
  private readonly blobs: ExportedBlob[] = [];

  readonly name: string;

  constructor(name: string) {
    this.name = name;
  }

  /** @internal 名前から決まる id。Sheet・node・edge が使う */
  idFor(key: string): string {
    return deterministicUuid(`scenario:${this.name}:${key}`);
  }

  /** ふつうの Sheet を足す */
  sheet(name: string): SheetBuilder {
    return this.push(new SheetBuilder(this, name));
  }

  /** metagraph の Sheet を足す。File を画面で作ったときの index に当たる */
  metagraph(name: string): SheetBuilder {
    return this.push(
      new SheetBuilder(this, name, {
        [SHEET_KIND_PROPERTY]: METAGRAPH_SHEET_KIND,
      }),
    );
  }

  /** @internal 画像の実体を File に同梱する (import がローカルの blob ストアへ戻す) */
  attach({ cid, mimeType, data }: ImageBlob): void {
    if (!this.blobs.some((b) => b.cid === cid))
      this.blobs.push({ cid, mimeType, data });
  }

  build(): ConversensusFile {
    return {
      version: CONVERSENSUS_FILE_VERSION,
      id: this.idFor('file') as FileId,
      name: this.name,
      sheets: this.sheets.map((sheet) => sheet.build()),
      ...(this.blobs.length > 0 && { blobs: this.blobs }),
    };
  }

  private push(sheet: SheetBuilder): SheetBuilder {
    if (this.sheets.some((s) => s.name === sheet.name)) {
      throw new Error(`同じ名前の Sheet が既にある: ${sheet.name}`);
    }
    this.sheets.push(sheet);
    return sheet;
  }
}
