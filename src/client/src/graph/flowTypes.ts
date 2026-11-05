/**
 * React Flow に渡すノード・辺の部品の対応 (step3 Phase 3 S3-5)
 *
 * 編集する canvas (`GraphEditor`) と見るだけの pane (`GraphPreview`) が**同じ部品で描く**ように、
 * 1 か所に置く。別々に持つと、片方だけに新しい種類を足して見た目が食い違う。
 * モジュールの定数にする — React Flow は描画のたびに別の object を渡されると警告を出す
 */

import { ConnectionMode } from '@xyflow/react';
import { EditableLabelEdge } from '../EditableLabelEdge';
import { EditableNode } from '../EditableNode';
import { GroupNode } from '../GroupNode';
import { RF_GROUP_NODE_TYPE, RF_IMAGE_NODE_TYPE } from '../graphTransform';
import { ImageNode } from '../ImageNode';

export const FLOW_NODE_TYPES = {
  editableNode: EditableNode,
  [RF_GROUP_NODE_TYPE]: GroupNode,
  [RF_IMAGE_NODE_TYPE]: ImageNode,
};

export const FLOW_EDGE_TYPES = { editableLabel: EditableLabelEdge };

/**
 * 辺の端の handle の解き方。**node の handle はすべて `type="source"`** (どの向きからも繋げるため)
 * なので、`Loose` でないと辺の行き先の handle が見つからず、React Flow は辺を描かない。
 * 見るだけの pane がこれを持たず、merger の merge 元・merge 先に辺が出なかった (#328)
 */
export const FLOW_CONNECTION_MODE = ConnectionMode.Loose;
