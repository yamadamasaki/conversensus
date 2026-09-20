/**
 * property editor の画面 (step2 Phase 4 Q2)
 *
 * 仕様: `deepse/requirements/spec/propertyEditor.md`
 *
 * ## 何を出すかは決めない
 *
 * 行の選別 (system を除く)、型、編集させるかの判断は **Q1 (`propertyRows`) が
 * 済ませている**。ここは受け取った行を描き、操作を上へ返すだけである。分けているのは、
 * 可視性の判断と見た目を同じ場所に置くと「見た目を直したら system が見えるように
 * なった」が起こりうるからで、プロパティは op-log に載って全参加者に共有されるので
 * 表示の不具合では済まない。
 *
 * ## 覆いを敷かない
 *
 * 値を直しながらグラフを見るものなので、`inset: 0` の覆いに中央寄せしない
 * (検索窓と同じ判断)。既存のダイアログ 9 つはすべて覆い型だが、**これは編集の場で
 * あって問いではない**。
 *
 * ## 変更は「キー 1 つ」で上へ返す
 *
 * `NODE_PROPERTIES_CHANGED` / `EDGE_PROPERTIES_CHANGED` の `from`/`to` は
 * **置き換え後の全体**を載せる契約である (#208 / レビュー R4)。全体を組むのは
 * 呼び出し側の仕事にした — **契約を 1 か所に置く**ためで、ここが全体を組むと
 * `ImageNode` と 2 か所に同じ約束が散る。
 */

import { useEffect, useRef, useState } from 'react';
import type { PropertyRow, ReadOnlyReason } from './property/propertyRows';
import { FLOATING_UI_Z_INDEX } from './SettingsPopup';

/** 検索窓 (800) より下、画面上の浮遊 UI と同じ層 */
export const PROPERTY_EDITOR_Z_INDEX = FLOATING_UI_Z_INDEX;

const PANEL_WIDTH = 320;
const PANEL_MAX_HEIGHT = '60vh';

/** なぜ編集できないかを人に言う。**理由ごとに文言を変える** */
const READ_ONLY_NOTE: Record<ReadOnlyReason, string> = {
  templateKind: '種別は作成時に決まり、変更できません',
  structuredValue: '構造を持つ値はこの画面では編集できません',
};

/**
 * 型の表示名。
 *
 * **step 2 に来るのは `string` だけである** — 型は宣言から来るもので、step 2 は
 * 宣言の仕組みを持たないからである (利用者判断 2026-09-20)。残りを残してあるのは
 * **宣言から型が引ける step 3 のため**で、そのとき拡張が `number` や `date` を
 * 宣言しうる。消すと、そのたびに表を作り直すことになる。
 */
const TYPE_LABEL: Record<string, string> = {
  string: '文字列',
  number: '数値',
  boolean: '真偽値',
  date: '日付',
  datetime: '日時',
  array: '配列',
  object: '構造体',
};

/** 値を 1 行で見せる。**編集できない値もここを通る** */
function displayValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(displayValue).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

type Props = {
  /** 何のプロパティか。**id をそのまま出さない** — UUID は人に読めない */
  title: string;
  /** Q1 が組んだ行。選別も型も判断済みである */
  rows: readonly PropertyRow[];
  /** 追加できる名前の候補 (template の宣言から)。無ければ自由入力だけ */
  addable: readonly string[];
  /** プロパティ 1 つを設定する。**全体を組むのは呼び出し側** */
  onSet: (name: string, value: unknown) => void;
  /** プロパティ 1 つを消す */
  onRemove: (name: string) => void;
  /**
   * 再参加した後、同期が済むまでは編集させない (step2 Phase 2 S6)。
   * **見るのは止めない** — 読むための操作は残す、という S6 の判断に揃える
   */
  readOnly?: boolean;
  onClose: () => void;
};

export function PropertyEditor({
  title,
  rows,
  addable,
  onSet,
  onRemove,
  readOnly = false,
  onClose,
}: Props) {
  const [newName, setNewName] = useState('');
  const [newValue, setNewValue] = useState('');

  const addName = newName.trim();
  const canAdd =
    !readOnly && addName !== '' && !rows.some((r) => r.name === addName);

  return (
    <section
      aria-label="プロパティ"
      style={{
        position: 'absolute',
        top: 52,
        right: 12,
        width: PANEL_WIDTH,
        maxWidth: 'calc(100vw - 24px)',
        maxHeight: PANEL_MAX_HEIGHT,
        overflowY: 'auto',
        background: '#fff',
        border: '1px solid #ccc',
        borderRadius: 8,
        boxShadow: '0 4px 24px rgba(0,0,0,0.2)',
        zIndex: PROPERTY_EDITOR_Z_INDEX,
        fontSize: 13,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 8,
          padding: '10px 12px',
          borderBottom: '1px solid #eee',
        }}
      >
        <strong
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {title}
        </strong>
        <button
          type="button"
          onClick={onClose}
          aria-label="プロパティを閉じる"
          style={{
            padding: '2px 8px',
            cursor: 'pointer',
            background: 'none',
            border: '1px solid #ccc',
            borderRadius: 4,
            flexShrink: 0,
          }}
        >
          ✕
        </button>
      </div>

      {rows.length === 0 ? (
        <p style={{ margin: 0, padding: 12, color: '#777' }}>
          プロパティはありません
        </p>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {rows.map((row) => (
            <PropertyField
              key={row.name}
              row={row}
              readOnly={readOnly}
              onSet={onSet}
              onRemove={onRemove}
            />
          ))}
        </ul>
      )}

      {/* 追加の口。**custom は自由に足せる** (仕様の表) */}
      {!readOnly && (
        <div style={{ padding: 12, borderTop: '1px solid #eee' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              aria-label="追加するプロパティの名前"
              list="property-addable"
              placeholder="名前"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              style={{ flex: 1, minWidth: 0, padding: '4px 6px', fontSize: 12 }}
            />
            <input
              aria-label="追加するプロパティの値"
              placeholder="値"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              style={{ flex: 1, minWidth: 0, padding: '4px 6px', fontSize: 12 }}
            />
            <button
              type="button"
              disabled={!canAdd}
              onClick={() => {
                onSet(addName, newValue);
                setNewName('');
                setNewValue('');
              }}
              style={{
                padding: '4px 10px',
                fontSize: 12,
                cursor: canAdd ? 'pointer' : 'not-allowed',
              }}
            >
              追加
            </button>
          </div>
          {/* template が宣言した名前を候補に出す (仕様「名前を選択するメニュー」)。
              **datalist にするのは、宣言に無い名前も足せるからである** — custom は
              自由であり、選択肢に閉じてはいけない */}
          <datalist id="property-addable">
            {addable.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </div>
      )}
    </section>
  );
}

/**
 * 1 行。**編集できるかで要素そのものを変える** — 変更できない値を入力欄にすると、
 * 打てそうで打てない欄になる (Phase 5 が label で踏んだ形)。
 */
function PropertyField({
  row,
  readOnly,
  onSet,
  onRemove,
}: {
  row: PropertyRow;
  readOnly: boolean;
  onSet: (name: string, value: unknown) => void;
  onRemove: (name: string) => void;
}) {
  const shown = displayValue(row.value);
  const [draft, setDraft] = useState(shown);
  const composingRef = useRef(false);

  // 他者の編集が届いたら追従する。**編集中の打鍵は奪わない**ので、
  // 値が変わったときだけ差し替える
  useEffect(() => {
    setDraft(shown);
  }, [shown]);

  const locked = readOnly || row.readOnly !== undefined;

  const commit = () => {
    if (draft === shown) return; // 変わらないものは op-log に積まない (Phase 5 の判断)
    // **値は文字列のまま保存する** (利用者判断 2026-09-20)。
    //
    // 型を指定するのは**実装コードか template のような拡張**であって、入力された値
    // ではない。custom のプロパティは node のインスタンスごとに値が違いうるので、
    // その場の値から型を決めても**その型を使う場面が無い**。
    // 入力から型を推論して寄せると、`3` と打っただけで数値になり、
    // 文字列の `"3"` を入れる手段が無くなる (step2 に型を指定する口は無い)。
    onSet(row.name, draft);
  };

  return (
    <li
      style={{
        padding: '8px 12px',
        borderBottom: '1px solid #f0f0f0',
        lineHeight: 1.6,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 6,
        }}
      >
        <span style={{ fontWeight: 600, wordBreak: 'break-all' }}>
          {row.name}
        </span>
        <span style={{ color: '#777', fontSize: 11, flexShrink: 0 }}>
          {TYPE_LABEL[row.type] ?? row.type}
        </span>
      </div>

      {locked ? (
        <div style={{ color: '#555', wordBreak: 'break-all' }}>{shown}</div>
      ) : (
        <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
          <input
            aria-label={`${row.name} の値`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onCompositionEnd={() => {
              composingRef.current = false;
            }}
            onBlur={commit}
            onKeyDown={(e) => {
              if (composingRef.current) return; // IME 変換中は無視
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') setDraft(shown);
            }}
            style={{ flex: 1, minWidth: 0, padding: '4px 6px', fontSize: 12 }}
          />
          <button
            type="button"
            onClick={() => onRemove(row.name)}
            aria-label={`${row.name} を削除`}
            style={{ padding: '4px 8px', fontSize: 12, cursor: 'pointer' }}
          >
            🗑
          </button>
        </div>
      )}

      {/* **なぜ編集できないかを言う。**言わないと「壊れている」に見える */}
      {row.readOnly !== undefined && (
        <div style={{ color: '#999', fontSize: 11 }}>
          {READ_ONLY_NOTE[row.readOnly]}
        </div>
      )}
    </li>
  );
}
