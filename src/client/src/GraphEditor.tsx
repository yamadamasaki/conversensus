import type {
  EdgeId,
  EdgeLayout,
  GraphEdge,
  GraphNode,
  NodeId,
  NodeKindRef,
  NodeLayout,
  SheetId,
} from '@conversensus/shared';
import {
  DERIVED_FROM_SHEET_PROPERTY,
  type EdgeKindRef,
  kindPropertyOf,
  nodeKindsOf,
  type Template,
} from '@conversensus/shared';
import {
  Background,
  type Connection,
  ConnectionMode,
  Controls,
  type Edge,
  type EdgeChange,
  MiniMap,
  type NodeChange,
  type OnConnect,
  type OnReconnect,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { color, font, radius, space } from './theme';
import '@xyflow/react/dist/style.css';
import type { FileId, Sheet } from '@conversensus/shared';
import { AlertDialog } from './AlertDialog';
import { EdgeContextMenu } from './EdgeContextMenu';
import { EdgeKindMenu } from './EdgeKindMenu';
import { EventDispatchContext } from './EventDispatchContext';
import { type GraphEvent, makeEventBase } from './events/GraphEvent';
import { contentOf, createChangeGate } from './graph/changeGate';
import { deletionTargets } from './graph/deletion';
import {
  type GraphEditorControls,
  type PropertyTarget,
  propertyTargetKey,
} from './graph/editorControls';
import { exportPng } from './graph/exportPng';
import { FLOW_EDGE_TYPES, FLOW_NODE_TYPES } from './graph/flowTypes';
import { GraphNodeProvider } from './graph/graphNodeContext';
import {
  canConnectByTemplate,
  canReconnectByTemplate,
  edgeKindCandidatesFor,
} from './graph/templateEdge';
import {
  DEFAULT_EDGE_PATH_TYPE,
  DEFAULT_NODE_STYLE,
  fromFlowEdges,
  fromFlowNodes,
  GROUP_NODE_TYPE,
  IMAGE_NODE_TYPE,
  toFlowAndGhostEdges,
  toFlowAndGhostNodes,
} from './graphTransform';
import { useClipboard } from './hooks/useClipboard';
import { useEdgeContextMenu } from './hooks/useEdgeContextMenu';
import { type UndoState, useEventStore } from './hooks/useEventStore';
import {
  type GroupAbility,
  groupAbilityOf,
  useGroupNodes,
} from './hooks/useGroupNodes';
import { useImageIntake } from './hooks/useImageIntake';
import { useNodeDragTracking } from './hooks/useNodeDragTracking';
import { useNodeTypeMenu } from './hooks/useNodeTypeMenu';
import { ImageErrorProvider } from './images/imageErrorContext';
import { NodeCreationContext } from './NodeCreationContext';
import type { NodeTypeOption } from './NodeTypeMenu';
import { NodeTypeMenu } from './NodeTypeMenu';
import { addablePropertyNames } from './property/propertyRows';
import { useReadOnly } from './readOnlyContext';
import type { SearchHit } from './search/searchSheet';

/** 検索結果から要素へ寄せるときの拡大率 (step2 Phase 7) */
const REVEAL_ZOOM = 1.2;
/** 寄せるのにかける時間。一瞬で飛ぶと、どこからどこへ動いたのか分からない */
const REVEAL_DURATION_MS = 400;
type Props = {
  /**
   * 表示するシート (step3 Phase 3 S3-2)。**File 全体は受け取らない** — 以前は File を受け取り
   * File を返していたので、親は「開いている File の state」を 1 つ持つしかなく、branch を
   * 見るにもその state のシートを差し替えるしかなかった (設計 F1)
   */
  sheet: Sheet;
  /** 再 seed の契機と PNG のファイル名にだけ使う */
  fileId: FileId;
  fileName: string;
  /** canvas の中身が変わったときに、そのシートを返す */
  onSheetChange: (sheet: Sheet) => void;
  // ファイル単位の操作ログ tap (W3c1)。App から渡され content 編集を op-log へ流す。
  // sheetId は content batch へ付与される (W3c2)。
  syncRecord: (event: GraphEvent, sheetId?: SheetId) => void;
  addedNodeIds?: Set<string>;
  updatedNodeIds?: Set<string>;
  addedEdgeIds?: Set<string>;
  updatedEdgeIds?: Set<string>;
  deletedNodes?: GraphNode[];
  deletedEdges?: GraphEdge[];
  deletedNodeLayouts?: NodeLayout[];
  deletedEdgeLayouts?: EdgeLayout[];
  graphKey?: string;
  undoStateMap?: React.MutableRefObject<Map<string, UndoState>>;
  // 受信 swap の世代番号 (Phase 4e-3/4e-4)。同一 file.id のまま activeFile が受信で
  // 差し替わったとき、この値の増加を契機に React Flow の state を再 seed する。
  receiveEpoch?: number;
  /**
   * このシートに当てた template の実体 (step3 Phase 4 S4-1b)。**当たっていなければ空**で、空で
   * あることが「種別の段を出さない」「接続に制約をかけない」の両方の根拠になる (設計 D1/D3/D5)。
   * template graph の切断面の解決は op-log を読むので、外 (`useResolvedTemplates`) が行う
   */
  templates: readonly Template[];
  /**
   * dispatch の前の読み替え (step3 Phase 4 S4-2b)。null を返すと dispatch しない。metagraph の
   * graph node への操作をシートの操作に回すのに使う (`splitMetagraphEvent`)
   */
  transformEvent?: (event: GraphEvent) => GraphEvent | null;
  /**
   * metagraph の graph node の口 (step3 Phase 4 S4-2b)。渡すと種類のメニューに「グラフ」が出て、
   * graph node のダブルクリックでそのシートを開く。名前の変更は選んで Enter / F2
   */
  graphNodes?: {
    onOpen: (sheetId: SheetId) => void;
    onAdd: (position: { x: number; y: number }) => void;
  };
  /**
   * 外から呼べる口 (step3 Phase 3 S3-4a)。描かれている間は口を、外されるときは null を渡す。
   * ヘッダ (undo・グループ化・PNG) と検索・property editor はこの口を通して canvas に触れる
   */
  onControls?: (controls: GraphEditorControls | null) => void;
  /**
   * 選ばれている要素 (property editor の対象) が変わった (S3-4a)。**中身が変わったときだけ**
   * 呼ぶ。選択の正は React Flow にあり、これは写しである (設計 S3-4 の U1)
   */
  onSelectionChange?: (target: PropertyTarget | undefined) => void;
  /** ヘッダの「group にまとめる / 解く」を押せるか (#269)。変わったときだけ知らせる */
  onGroupAbilityChange?: (ability: GroupAbility) => void;
};

function GraphEditorInner({
  sheet: activeSheet,
  fileId,
  fileName,
  onSheetChange,
  syncRecord,
  addedNodeIds,
  updatedNodeIds,
  addedEdgeIds,
  updatedEdgeIds,
  deletedNodes,
  deletedEdges,
  deletedNodeLayouts,
  deletedEdgeLayouts,
  graphKey,
  undoStateMap,
  receiveEpoch,
  templates,
  transformEvent,
  graphNodes,
  onControls,
  onSelectionChange,
  onGroupAbilityChange,
}: Props) {
  const { screenToFlowPosition, getNodes, getEdges, setCenter } =
    useReactFlow();
  // 再参加した後、同期が済むまでは編集させない (step2 Phase 2 S6)。
  // **props ではなく context で受ける** — 途中の層はこの値に用が無い
  const readOnly = useReadOnly();

  const nodeKinds = useMemo(() => nodeKindsOf(templates), [templates]);

  const ghostDeletedNodeIds = useMemo(
    () => new Set((deletedNodes ?? []).map((n) => n.id)),
    [deletedNodes],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(
    toFlowAndGhostNodes(
      activeSheet?.nodes ?? [],
      activeSheet?.layouts ?? [],
      deletedNodes ?? [],
      deletedNodeLayouts ?? [],
      addedNodeIds,
      updatedNodeIds,
    ),
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(
    toFlowAndGhostEdges(
      activeSheet?.edges ?? [],
      activeSheet?.edgeLayouts ?? [],
      deletedEdges ?? [],
      deletedEdgeLayouts ?? [],
      ghostDeletedNodeIds,
      addedEdgeIds,
      updatedEdgeIds,
    ),
  );

  // 画像の受け入れに失敗した理由 (上限超過・保存失敗)。App へ持ち上げず GraphEditor 内で
  // 出す — 既に 14 個ある GraphEditorProps をこのために増やす理由が無い
  const [imageError, setImageError] = useState<string | null>(null);

  // 常に最新の sheet / onSheetChange / deleted items を参照するための ref
  const sheetRef = useRef(activeSheet);
  sheetRef.current = activeSheet;
  const fileNameRef = useRef(fileName);
  fileNameRef.current = fileName;
  const onSheetChangeRef = useRef(onSheetChange);
  onSheetChangeRef.current = onSheetChange;
  const deletedNodesRef = useRef(deletedNodes);
  deletedNodesRef.current = deletedNodes;
  const deletedEdgesRef = useRef(deletedEdges);
  deletedEdgesRef.current = deletedEdges;
  const deletedNodeLayoutsRef = useRef(deletedNodeLayouts);
  deletedNodeLayoutsRef.current = deletedNodeLayouts;
  const deletedEdgeLayoutsRef = useRef(deletedEdgeLayouts);
  deletedEdgeLayoutsRef.current = deletedEdgeLayouts;

  // canvas の変化のうち中身が変わったものだけを親へ通す (寸法の計測・差分の色・選択は
  // 通さない)。**時刻や回数ではなく中身で見分ける** — 理由は `graph/changeGate.ts`
  const changeGate = useRef(createChangeGate()).current;

  /**
   * property editor が対象にしている要素 (step2 Phase 4 Q2)。
   *
   * **node を優先する。**両方選ばれていることがあり得るが、editor は 1 つの要素の
   * 表である。ゴーストは対象外 — 消された要素のプロパティを編集させても行き先が無い。
   * 選択の観測経路は React Flow の nodes/edges にしか無いので、そこから読む
   */
  const propertyTarget = useMemo((): PropertyTarget | undefined => {
    const node = nodes.find((n) => n.selected && !n.data?.ghost);
    if (node)
      return {
        kind: 'node',
        id: node.id,
        // **id をそのまま出さない** — UUID は人に読めない。本文か種別で呼ぶ
        title: String(node.data?.content || node.data?.label || 'node'),
        properties: node.data?.properties as
          | Record<string, unknown>
          | undefined,
        addable: [],
      };
    const edge = edges.find((e) => e.selected && !e.data?.ghost);
    if (edge) {
      const properties = edge.data?.properties as
        | Record<string, unknown>
        | undefined;
      return {
        kind: 'edge',
        id: edge.id,
        title: String(edge.label || '辺'),
        properties,
        // **候補は edge にしか無い** — 宣言を持つのは `EdgeKind` だけである
        addable: addablePropertyNames(templates, properties),
      };
    }
    return undefined;
  }, [nodes, edges, templates]);

  // 選択の写しを外へ知らせる (S3-4a)。**中身が変わったときだけ** — nodes はドラッグの
  // 間じゅう変わるので、毎回知らせると App がドラッグの各フレームで描き直す
  const selectionKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const key = propertyTargetKey(propertyTarget);
    if (selectionKeyRef.current === key) return;
    selectionKeyRef.current = key;
    onSelectionChange?.(propertyTarget);
  }, [propertyTarget, onSelectionChange]);

  const groupAbility = useMemo(() => groupAbilityOf(nodes), [nodes]);
  const { canGroup, canUngroup } = groupAbility;
  useEffect(() => {
    onGroupAbilityChange?.({ canGroup, canUngroup });
  }, [canGroup, canUngroup, onGroupAbilityChange]);

  // 結果の 1 件をグラフで示す (仕様「ダブル・クリックにより, グラフ内で対象を
  // ハイライト表示」)。**React Flow の選択に寄せる** — 差分の色 (diffType の緑/橙) と
  // 混ざらず、再 seed のたびにハイライトを塗り直す配線も要らない
  const handleReveal = useCallback(
    (hit: SearchHit) => {
      const isNode = hit.elementKind === 'node';
      setNodes((current) =>
        current.map((n) => ({ ...n, selected: isNode && n.id === hit.id })),
      );
      setEdges((current) =>
        current.map((e) => ({ ...e, selected: !isNode && e.id === hit.id })),
      );
      // 辺そのものは座標を持たないので、**始点のノードに寄せる**。
      // 画面の外に居る要素を選んだだけでは、選んだことが見えない
      const target = isNode
        ? getNodes().find((n) => n.id === hit.id)
        : getNodes().find(
            (n) => n.id === getEdges().find((e) => e.id === hit.id)?.source,
          );
      if (!target) return;
      setCenter(
        target.position.x + (target.measured?.width ?? 0) / 2,
        target.position.y + (target.measured?.height ?? 0) / 2,
        { zoom: REVEAL_ZOOM, duration: REVEAL_DURATION_MS },
      );
    },
    [getNodes, getEdges, setCenter, setNodes, setEdges],
  );

  // fileId / シートが変わったとき、および受信 swap (receiveEpoch の増加,
  // Phase 4e-3) のとき React Flow の state をリセットする。受信 swap は file.id が
  // 同一のままファイル内容が差し替わるため、epoch を依存に入れないと画面に出ない
  // (4e-4 実機で発見)。swap は reprojectAfterReceive が「編集中でない・pending 0」を
  // 保証した後にしか起きないので、ここで無条件に再 seed してよい。
  // biome-ignore lint/correctness/useExhaustiveDependencies: fileId / シート / receiveEpoch の変化のみをトリガーにする意図的な設計
  useEffect(() => {
    const sheet = sheetRef.current;
    const seededNodes = toFlowAndGhostNodes(
      sheet.nodes,
      sheet.layouts ?? [],
      deletedNodesRef.current ?? [],
      deletedNodeLayoutsRef.current ?? [],
      addedNodeIds,
      updatedNodeIds,
    );
    const seededEdges = toFlowAndGhostEdges(
      sheet.edges,
      sheet.edgeLayouts ?? [],
      deletedEdgesRef.current ?? [],
      deletedEdgeLayoutsRef.current ?? [],
      new Set((deletedNodesRef.current ?? []).map((n) => n.id)),
      addedEdgeIds,
      updatedEdgeIds,
    );
    // 置き直した中身は親が既に知っているので、それ自体は変化として通さない
    changeGate.seed(contentOf(seededNodes, seededEdges));
    setNodes(seededNodes);
    setEdges(seededEdges);
  }, [fileId, activeSheet.id, receiveEpoch, setNodes, setEdges]);

  // コンフリクト状態が変わったらノード/エッジのスタイルだけ更新。
  // nodes/edges が変わるので onChange の effect は走るが、中身は変わらないので
  // changeGate が通さない
  useEffect(() => {
    setNodes((current) =>
      current.map((n) => {
        const dt: 'add' | 'update' | undefined = addedNodeIds?.has(n.id)
          ? 'add'
          : updatedNodeIds?.has(n.id)
            ? 'update'
            : undefined;
        return {
          ...n,
          data: { ...n.data, diffType: dt },
        };
      }),
    );
  }, [addedNodeIds, updatedNodeIds, setNodes]);

  useEffect(() => {
    setEdges((current) =>
      current.map((e) => {
        const added = addedEdgeIds?.has(e.id) ?? false;
        const updated = updatedEdgeIds?.has(e.id) ?? false;
        const dt: 'add' | 'update' | undefined = added
          ? 'add'
          : updated
            ? 'update'
            : undefined;
        return {
          ...e,
          style: dt
            ? {
                stroke: dt === 'add' ? color.diffAdd : color.diffUpdate,
                strokeWidth: 3,
              }
            : undefined,
          data: { ...e.data, diffType: dt },
        };
      }),
    );
  }, [addedEdgeIds, updatedEdgeIds, setEdges]);

  // 削除ノード/エッジが変わったらゴーストを同期
  useEffect(() => {
    setNodes((current) => {
      const active = current.filter((n) => !n.data?.ghost);
      const ghosts = toFlowAndGhostNodes(
        [],
        [],
        deletedNodes ?? [],
        deletedNodeLayouts ?? [],
      );
      return [...active, ...ghosts];
    });
  }, [deletedNodes, deletedNodeLayouts, setNodes]);

  useEffect(() => {
    const dnIds = new Set((deletedNodes ?? []).map((n) => n.id));
    setEdges((current) => {
      const active = current.filter((e) => !e.data?.ghost);
      const ghosts = toFlowAndGhostEdges(
        [],
        [],
        deletedEdges ?? [],
        deletedEdgeLayouts ?? [],
        dnIds,
      );
      return [...active, ...ghosts];
    });
  }, [deletedNodes, deletedEdges, deletedEdgeLayouts, setEdges]);

  // nodes/edges の中身が変わったら親に通知
  useEffect(() => {
    const content = contentOf(nodes, edges);
    if (!changeGate.admit(content)) return;
    const {
      nodes: graphNodes,
      layouts,
      edges: graphEdges,
      edgeLayouts,
    } = content;
    onSheetChangeRef.current({
      ...sheetRef.current,
      nodes: graphNodes,
      layouts,
      edges: graphEdges,
      edgeLayouts,
    });
  }, [nodes, edges, changeGate]);

  // --- Event store ---
  // dispatch された event を操作ログへ流す tap (W2)。tap はファイル単位で App が保持し
  // syncRecord として渡される (W3c1: content と structure が単一 tap を共有)。
  // content 編集はこの GraphEditor が表示する単一シートに属すため activeSheetId を付与する (W3c2)。
  const recordContent = useCallback(
    (event: GraphEvent) => syncRecord(event, activeSheet.id),
    [syncRecord, activeSheet.id],
  );
  const {
    dispatch: storeDispatch,
    undo,
    redo,
    setDragging,
    exportState,
    importState,
  } = useEventStore(nodes, edges, setNodes, setEdges, recordContent);
  /**
   * dispatch の前の読み替え (step3 Phase 4 S4-2b)。metagraph では graph node への削除・本文の変更を
   * シートの操作に回し (undo に入れない)、残りだけを dispatch する。読み替えが無ければそのまま
   */
  const transformEventRef = useRef(transformEvent);
  transformEventRef.current = transformEvent;
  const dispatch = useCallback(
    (event: GraphEvent) => {
      const transform = transformEventRef.current;
      const rest = transform ? transform(event) : event;
      if (rest) storeDispatch(rest);
    },
    [storeDispatch],
  );

  /**
   * プロパティ 1 つの変更を op へ流す (step2 Phase 4 Q2)。
   *
   * **ここが「全体を載せる」契約を守る唯一の場所である。**`NODE_PROPERTIES_CHANGED` /
   * `EDGE_PROPERTIES_CHANGED` の from/to は**置き換え後の全体**で、op に落ちる差分は
   * その差から採る (#208 / レビュー R4)。画面が差分だけを載せると、他のキーが
   * 「削除された」と読まれて消える (`ImageNode` が同じ約束を守っている)。
   *
   * **値の省略は削除**である (`diffProperties` の規則)。
   *
   * **`dispatch` より後ろに置く。**`propertyTarget` は nodes/edges だけに依るので
   * 前に置けるが、こちらは `useEventStore` の戻りを使う
   */
  const applyPropertyChange = useCallback(
    (name: string, value: unknown) => {
      if (!propertyTarget) return;
      const from = { ...(propertyTarget.properties ?? {}) };
      const to = { ...from };
      if (value === undefined) delete to[name];
      else to[name] = value;
      dispatch(
        propertyTarget.kind === 'node'
          ? {
              ...makeEventBase('content'),
              type: 'NODE_PROPERTIES_CHANGED',
              nodeId: propertyTarget.id as NodeId,
              from,
              to,
            }
          : {
              ...makeEventBase('content'),
              type: 'EDGE_PROPERTIES_CHANGED',
              edgeId: propertyTarget.id as EdgeId,
              from,
              to,
            },
      );
    },
    [propertyTarget, dispatch],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount/unmount のみ (React key 変更による再マウント)
  useEffect(() => {
    if (!graphKey || !undoStateMap) return;
    const key = graphKey;
    const saved = undoStateMap.current.get(key);
    if (saved) {
      importState(saved);
    }
    return () => {
      undoStateMap.current.set(key, exportState());
    };
  }, []);

  // reconnectEdge は元の UUID を破棄して xy-edge__... 形式の ID を生成するため,
  // 元の ID を保持したまま接続先のみ更新する独自実装を使用する
  const onReconnect: OnReconnect = useCallback(
    (oldEdge: Edge, newConnection: Connection) => {
      dispatch({
        ...makeEventBase('structure'),
        type: 'EDGE_RECONNECTED',
        edgeId: oldEdge.id as EdgeId,
        from: {
          source: oldEdge.source as NodeId,
          target: oldEdge.target as NodeId,
          sourceHandle: oldEdge.sourceHandle ?? undefined,
          targetHandle: oldEdge.targetHandle ?? undefined,
        },
        to: {
          source: newConnection.source as NodeId,
          target: newConnection.target as NodeId,
          sourceHandle: newConnection.sourceHandle ?? undefined,
          targetHandle: newConnection.targetHandle ?? undefined,
        },
      });
    },
    [dispatch],
  );

  /**
   * 両端の種別から edge の種類を決める (設計 D5)。**候補 1 のときだけ自動で当てる。**
   *
   * 候補 0 は「繋げない」だが、それを止めるのは `isValidConnection` の仕事である
   * (P6)。ここは既に繋がると決まったものに種類を与えるだけなので、**候補 1 以外は
   * 何もしない** — 候補が複数のときに選ばせる UI は step2 では作らない (D5)。
   */

  /**
   * template の規則に反する接続を**繋がせない** (設計 D5)。React Flow が繋ぐ前に
   * 訊いてくるので、**警告ではなく拒否**として実現できる。
   *
   * 拒否するのは **template の要素どうし**だけである。普通のノードが絡む接続は
   * 今までどおり自由に繋げる。
   */
  /**
   * いま繋ぎ替え中の edge。**`isValidConnection` の引数からは分からない** —
   * React Flow は `Connection` (source/target/handle) しか渡さないので、
   * 新規の接続と繋ぎ替えを区別できない。`onReconnectStart` で控えておく。
   */
  const reconnectingEdge = useRef<Edge | null>(null);
  const onReconnectStart = useCallback((_e: unknown, edge: Edge) => {
    reconnectingEdge.current = edge;
  }, []);
  const onReconnectEnd = useCallback(() => {
    reconnectingEdge.current = null;
  }, []);

  const isValidConnection = useCallback(
    (c: Connection | Edge) => {
      const nodes = getNodes();
      const source = c.source as string;
      const target = c.target as string;
      const editing = reconnectingEdge.current;
      // 繋ぎ替えは**種類が変わらない範囲でのみ**許す (仕様 OnMutation)。
      // 新規の接続とは規則が違うので、対象の edge が在るときはそちらを見る
      return editing
        ? canReconnectByTemplate(templates, nodes, editing, source, target)
        : canConnectByTemplate(templates, nodes, source, target);
    },
    [templates, getNodes],
  );

  /**
   * edge を作る。種類が決まっていれば label・種別・既定値を一緒に載せる (仕様 OnCreation の
   * `edge.label ← edge の種類名`。node と同じく **id が実体で label は表示**なので、両方を 1 つの
   * op に載せる。既定値は template 側の property の値, step3 Phase 4)
   */
  const createEdge = useCallback(
    (connection: Connection, kind: EdgeKindRef | undefined) => {
      const edgeId = crypto.randomUUID() as EdgeId;
      const graphEdge: GraphEdge = {
        id: edgeId,
        source: connection.source as NodeId,
        target: connection.target as NodeId,
        ...(kind
          ? {
              ...(kind.kind.label !== '' && { label: kind.kind.label }),
              properties: {
                ...kind.kind.defaults,
                [kindPropertyOf(kind.templateId)]: kind.kind.id,
              },
            }
          : {}),
      };
      const edgeLayout: EdgeLayout = {
        edgeId,
        sourceHandle: connection.sourceHandle ?? undefined,
        targetHandle: connection.targetHandle ?? undefined,
        pathType: DEFAULT_EDGE_PATH_TYPE,
      };
      dispatch({
        ...makeEventBase('structure'),
        type: 'EDGE_ADDED',
        edgeId,
        data: graphEdge,
        edgeLayout,
      });
    },
    [dispatch],
  );

  /**
   * 種類の候補が複数ある接続 (step3 Phase 4 Q8)。**選ぶまで edge を作らない** — 作ってから種類を
   * 書き足すと、op が 2 つに割れ、undo も 2 回要る。メニューの位置は接続を終えた所 (`onConnectEnd`)
   */
  const [pendingEdge, setPendingEdge] = useState<{
    connection: Connection;
    candidates: EdgeKindRef[];
    position?: { x: number; y: number };
  } | null>(null);

  const onConnect: OnConnect = useCallback(
    (connection) => {
      const candidates = edgeKindCandidatesFor(
        templates,
        getNodes(),
        connection.source as string,
        connection.target as string,
      );
      if (candidates.length > 1) {
        setPendingEdge({ connection, candidates });
        return;
      }
      createEdge(connection, candidates[0]);
    },
    [templates, getNodes, createEdge],
  );

  const onConnectEnd = useCallback((event: MouseEvent | TouchEvent) => {
    const point =
      'changedTouches' in event
        ? event.changedTouches[0]
        : (event as MouseEvent);
    if (!point) return;
    setPendingEdge((pending) =>
      pending && !pending.position
        ? { ...pending, position: { x: point.clientX, y: point.clientY } }
        : pending,
    );
  }, []);

  // **更新関数の中で edge を作らない** — StrictMode は更新関数を 2 度呼ぶので、edge が 2 本できる
  const resolvePendingEdge = useCallback(
    (kind: EdgeKindRef | undefined) => {
      if (pendingEdge) createEdge(pendingEdge.connection, kind);
      setPendingEdge(null);
    },
    [pendingEdge, createEdge],
  );

  const addNode = useCallback(
    (
      position?: { x: number; y: number },
      nodeType?: NodeTypeOption,
      properties?: Record<string, unknown>,
      // 作成時の種別 (Phase 5)。**作成時にしか決まらない** (設計 D3)
      kind?: NodeKindRef,
      // 生成先のグループ。指定時 position はそのグループから見た相対座標
      parentId?: NodeId,
    ) => {
      const nodeId = crypto.randomUUID() as NodeId;
      const pos = position ?? {
        x: 100 + Math.random() * 200,
        y: 100 + Math.random() * 200,
      };
      const graphNode: GraphNode = {
        id: nodeId,
        content: '',
        // 仕様 OnCreation の `node.label ← node の種類名` をそのまま写す。
        // **`kind` (id) が実体で `label` は表示**だが、通知や op-log を読むだけの側が
        // template を引かずに済むよう label も持つ。変更できないので食い違わない
        ...(kind ? { label: kind.kind.label } : {}),
        ...(nodeType === 'group' ? { nodeType: GROUP_NODE_TYPE } : {}),
        ...(nodeType === 'image' ? { nodeType: IMAGE_NODE_TYPE } : {}),
        ...(properties || kind
          ? {
              properties: {
                ...properties,
                // 種類の既定値 (template 側の property の値, step3 Phase 4)。種別より前に置く —
                // 既定値に種別の名前が紛れても、種別の方が勝つ
                ...(kind?.kind.defaults ?? {}),
                ...(kind
                  ? { [kindPropertyOf(kind.templateId)]: kind.kind.id }
                  : {}),
              },
            }
          : {}),
        ...(parentId ? { parentId } : {}),
      };
      const layout: NodeLayout = {
        nodeId,
        x: pos.x,
        y: pos.y,
        ...DEFAULT_NODE_STYLE,
      };
      dispatch({
        ...makeEventBase('structure'),
        type: 'NODE_ADDED',
        nodeId,
        data: graphNode,
        layout,
      });
    },
    [dispatch],
  );

  // Delete/Backspace で選択ノード・エッジを削除
  // React Flow の組み込み削除を無効化し, dispatch 経由で処理する
  const handleDeleteKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      const currentNodes = getNodes();
      const currentEdges = getEdges();
      const doomed = deletionTargets(currentNodes, currentEdges);
      if (doomed.nodes.length === 0 && doomed.edges.length === 0) return;

      // 1 イベントにまとめる。グループと子を別々のイベントで消すと,
      // undo の途中で親の居ない子が現れてしまう
      const { nodes: graphNodes, layouts } = fromFlowNodes(doomed.nodes);
      const { edges: graphEdges, edgeLayouts } = fromFlowEdges(doomed.edges);
      dispatch({
        ...makeEventBase('structure'),
        type: 'NODES_DELETED',
        nodeIds: doomed.nodes.map((n) => n.id as NodeId),
        edgeIds: doomed.edges.map((edge) => edge.id as EdgeId),
        nodes: graphNodes,
        layouts,
        edges: graphEdges,
        edgeLayouts,
      });
    },
    [getNodes, getEdges, dispatch],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleDeleteKey);
    return () => window.removeEventListener('keydown', handleDeleteKey);
  }, [handleDeleteKey]);

  // remove タイプの変更は dispatch 経由で処理するためフィルタする
  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      onNodesChange(changes.filter((c) => c.type !== 'remove'));
    },
    [onNodesChange],
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      onEdgesChange(changes.filter((c) => c.type !== 'remove'));
    },
    [onEdgesChange],
  );

  // --- Custom hooks ---
  const { groupSelectedNodes, ungroupSelectedNodes } = useGroupNodes(
    getNodes,
    dispatch,
  );
  useClipboard(getNodes, getEdges, dispatch);
  const { contextMenu, onEdgeContextMenu, setEdgePathType } =
    useEdgeContextMenu(getEdges, dispatch);
  const { onPaneClick, openNodeTypeMenu, nodeTypeMenu, clearNodeTypeMenu } =
    useNodeTypeMenu(screenToFlowPosition, getNodes);
  const { onNodeDragStart, onNodeDrag, onNodeDragStop } = useNodeDragTracking(
    getNodes,
    dispatch,
  );
  const { handleDragOver, handleDrop } = useImageIntake({
    addNode,
    getNodes,
    screenToFlowPosition,
    dispatch,
    reportError: setImageError,
  });

  // metagraph の graph node (step3 Phase 4 S4-2b)。名前の変更は選んで Enter / F2 で始める —
  // ダブルクリックはシートを開くのに使う (Q6)
  const [renameRequest, setRenameRequest] = useState<NodeId | null>(null);
  useEffect(() => {
    if (!graphNodes) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== 'F2') return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const selected = getNodes().filter((n) => n.selected);
      const only = selected.length === 1 ? selected[0] : undefined;
      const props = only?.data?.properties as
        | Record<string, unknown>
        | undefined;
      if (!only || props?.[DERIVED_FROM_SHEET_PROPERTY] === undefined) return;
      e.preventDefault();
      setRenameRequest(only.id as NodeId);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [graphNodes, getNodes]);
  const graphNodeHandlers = useMemo(
    () =>
      graphNodes
        ? {
            openSheet: graphNodes.onOpen,
            renameRequest,
            clearRenameRequest: () => setRenameRequest(null),
          }
        : null,
    [graphNodes, renameRequest],
  );

  /** 外から選ぶ (merger の選択の連動)。React Flow の選択を入れ替えるだけで、op は積まない */
  const selectIds = useCallback(
    (ids: readonly string[]) => {
      const chosen = new Set(ids);
      setNodes((current) =>
        current.map((n) => ({ ...n, selected: chosen.has(n.id) })),
      );
      setEdges((current) =>
        current.map((e) => ({ ...e, selected: chosen.has(e.id) })),
      );
    },
    [setNodes, setEdges],
  );

  const handleExportPng = useCallback(() => {
    void exportPng(getNodes(), fileNameRef.current, sheetRef.current.name);
  }, [getNodes]);

  // 外から呼べる口 (S3-4a)。**口は描かれている間ずっと同じもの**にし、中身は最新を呼ぶ —
  // 口が変わるたびに外へ知らせると、外 (App) が描き直すたびにまた口が変わる
  const latest = {
    undo,
    redo,
    groupSelectedNodes,
    ungroupSelectedNodes,
    handleExportPng,
    handleReveal,
    applyPropertyChange,
    selectIds,
    dispatch,
  };
  const latestRef = useRef(latest);
  latestRef.current = latest;
  // biome-ignore lint/correctness/useExhaustiveDependencies: 口は mount/unmount でだけ渡し直す (中身は latestRef)
  useEffect(() => {
    if (!onControls) return;
    onControls({
      undo: () => latestRef.current.undo(),
      redo: () => latestRef.current.redo(),
      groupSelected: () => latestRef.current.groupSelectedNodes(),
      ungroupSelected: () => latestRef.current.ungroupSelectedNodes(),
      exportPng: () => latestRef.current.handleExportPng(),
      reveal: (hit) => latestRef.current.handleReveal(hit),
      setProperty: (name, value) =>
        latestRef.current.applyPropertyChange(name, value),
      select: (ids) => latestRef.current.selectIds(ids),
      apply: (events) => {
        for (const event of events) latestRef.current.dispatch(event);
      },
    });
    return () => onControls(null);
  }, []);

  return (
    <EventDispatchContext.Provider value={{ dispatch, setDragging }}>
      {/* 画像の失敗はここ 1 つのダイアログに集める。ImageNode は React Flow が
          描くので props を渡せず, context で降ろす (ANA-117 S6) */}
      <ImageErrorProvider value={setImageError}>
        <NodeCreationContext.Provider value={{ openNodeTypeMenu }}>
          <GraphNodeProvider value={graphNodeHandlers}>
            {/* biome-ignore lint/a11y/noStaticElementInteractions: drop target wrapper */}
            <div
              style={{ width: '100%', height: '100%' }}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
            >
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={FLOW_NODE_TYPES}
                edgeTypes={FLOW_EDGE_TYPES}
                onNodesChange={handleNodesChange}
                onEdgesChange={handleEdgesChange}
                connectionMode={ConnectionMode.Loose}
                onConnect={onConnect}
                onConnectEnd={onConnectEnd}
                isValidConnection={isValidConnection}
                onReconnect={onReconnect}
                onReconnectStart={onReconnectStart}
                onReconnectEnd={onReconnectEnd}
                onNodeDragStart={onNodeDragStart}
                onNodeDrag={onNodeDrag}
                onNodeDragStop={onNodeDragStop}
                // 読み取り専用のときは動かす・繋ぐ・繋ぎ替えるを止める
                // (step2 Phase 2 S6)。**選択と拡大縮小は残す** — 読むための操作である
                nodesDraggable={!readOnly}
                nodesConnectable={!readOnly}
                edgesReconnectable={!readOnly}
                onPaneClick={onPaneClick}
                onEdgeContextMenu={onEdgeContextMenu}
                zoomOnDoubleClick={false}
                deleteKeyCode={null}
                fitView
              >
                {readOnly && (
                  <Panel position="top-center">
                    {/* **なぜ編集できないかを出す。**出さないと「動かない」に見える */}
                    <div
                      role="status"
                      style={{
                        background: color.warningBg,
                        border: `1px solid ${color.warning}`,
                        color: color.warningText,
                        borderRadius: radius.sm,
                        padding: '4px 10px',
                        fontSize: font.body,
                      }}
                    >
                      参加していなかった間の編集を取り込んでいます。終わるまで読み取り専用です
                    </div>
                  </Panel>
                )}
                {nodes.length === 0 && !readOnly && (
                  // 空の Sheet (visual language §9.1, #279): 何をすれば node ができるかを言う。
                  // 押す操作を邪魔しないよう、ポインタは下の pane へ通す
                  <div aria-live="polite" style={EMPTY_SHEET_HINT}>
                    <p style={{ margin: 0 }}>ダブルクリックで node を作る</p>
                    <p style={{ margin: 0, fontSize: font.caption }}>
                      画像をドロップしても置けます
                    </p>
                  </div>
                )}
                <Background />
                <Controls />
                <MiniMap />
              </ReactFlow>
              {nodeTypeMenu && (
                <NodeTypeMenu
                  position={nodeTypeMenu.screenPos}
                  nodeKinds={nodeKinds}
                  graphNodeOption={graphNodes !== undefined}
                  onSelect={(nodeType, kind) => {
                    if (nodeType === 'graph') {
                      graphNodes?.onAdd(nodeTypeMenu.position);
                      clearNodeTypeMenu();
                      return;
                    }
                    addNode(
                      nodeTypeMenu.position,
                      nodeType,
                      undefined,
                      kind,
                      nodeTypeMenu.containerId,
                    );
                    clearNodeTypeMenu();
                  }}
                />
              )}
              {pendingEdge?.position && (
                <EdgeKindMenu
                  position={pendingEdge.position}
                  candidates={pendingEdge.candidates}
                  templates={templates}
                  onSelect={resolvePendingEdge}
                />
              )}
              {contextMenu && (
                <EdgeContextMenu
                  contextMenu={contextMenu}
                  onSelect={setEdgePathType}
                />
              )}
              {imageError && (
                <AlertDialog
                  message={imageError}
                  onClose={() => setImageError(null)}
                />
              )}
            </div>
          </GraphNodeProvider>
        </NodeCreationContext.Provider>
      </ImageErrorProvider>
    </EventDispatchContext.Provider>
  );
}

/** 空の Sheet の案内。グラフの中央に置き、ポインタは下の pane へ通す */
const EMPTY_SHEET_HINT = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: space[1],
  color: color.textMuted,
  fontSize: font.body,
  pointerEvents: 'none',
  zIndex: 1,
} as const;

export function GraphEditor(props: Props) {
  return (
    <ReactFlowProvider>
      <GraphEditorInner {...props} />
    </ReactFlowProvider>
  );
}

export type { Props as GraphEditorProps };
