import { Trash2, X } from 'lucide-react';
import { color, font, radius, shadow } from './theme';
import { ICON_SIZE_SM } from './ui/Button';
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

import {
  parsePropertyType,
  propertySchemaPropertyOf,
  propertySchemaValueOf,
  valueFromInput,
} from '@conversensus/shared';
import { useEffect, useRef, useState } from 'react';
import { messages, useMessages } from './i18n/messages';
import type { PropertyRow, RowSchema } from './property/propertyRows';
import {
  setShowReadOnlyProperties,
  useShowReadOnlyProperties,
} from './property/readOnlyToggle';
import { FLOATING_UI_Z_INDEX } from './SettingsPopup';

/** 検索窓 (800) より下、画面上の浮遊 UI と同じ層 */
export const PROPERTY_EDITOR_Z_INDEX = FLOATING_UI_Z_INDEX;

const PANEL_WIDTH = 320;
const PANEL_MAX_HEIGHT = '60vh';

/**
 * 型の表示名 (辞書の `property.types`)。
 *
 * **step 2 に来るのは `string` だけである** — 型は宣言から来るもので、step 2 は
 * 宣言の仕組みを持たないからである (利用者判断 2026-09-20)。残りを残してあるのは
 * **宣言から型が引ける step 3 のため**で、そのとき拡張が `number` や `date` を
 * 宣言しうる。消すと、そのたびに表を作り直すことになる。
 */
/** 型の列の最大の幅 (px)。宣言した選択肢の型が長くても、名前の場所を奪わない */
const TYPE_COLUMN_MAX_WIDTH = 120;

function typeLabel(type: string): string {
  const types: Record<string, string> = messages().property.types;
  return types[type] ?? type;
}

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
   * プロパティをいくつか同時に (1 つの op で) 変える。値が undefined のキーは削除。template graph の行
   * (`row.schema` を持つ行) の宣言を直すのに使う (template-update K9)。無ければ宣言の欄を出さない
   */
  onChange?: (changes: Readonly<Record<string, unknown>>) => void;
  /**
   * 再参加した後、同期が済むまでは編集させない (step2 Phase 2 S6)。
   * **見るのは止めない** — 読むための操作は残す、という S6 の判断に揃える
   */
  readOnly?: boolean;
  /** 閉じるボタンの働き。省くとボタンを出さない (右サイドバーの pane は畳むのはサイドバー側) */
  onClose?: () => void;
  /**
   * 置き方 (step3 Phase 3 S3-4b)。`floating` はボディの上に浮かべる、`docked` は右サイドバーの
   * pane に収める。仕様は両方を併用する (property editor: merger では右サイドバーに 3 つ載らない)
   */
  placement?: 'floating' | 'docked';
  /** 領域の名前。同じ画面に 2 つ出るので、呼び分けられるようにする */
  label?: string;
  /**
   * template graph の要素の欄か (template-update K9)。そうなら値は適用先の既定値で、**空は「既定値なし」**
   * (空文字を既定値にすると、型を宣言したときに「型に合わない」になる)
   */
  templateGraph?: boolean;
};

export function PropertyEditor({
  title,
  rows,
  addable,
  onSet,
  onRemove,
  onChange,
  readOnly = false,
  onClose,
  placement = 'floating',
  label = 'property',
  templateGraph = false,
}: Props) {
  const t = useMessages();
  const showReadOnly = useShowReadOnlyProperties();
  const [newName, setNewName] = useState('');
  const [newValue, setNewValue] = useState('');

  const addName = newName.trim();
  const canAdd =
    !readOnly && addName !== '' && !rows.some((r) => r.name === addName);

  return (
    <section
      aria-label={label}
      style={
        placement === 'docked'
          ? { fontSize: font.body, overflowY: 'auto', minHeight: 0 }
          : {
              position: 'absolute',
              top: 12,
              right: 12,
              width: PANEL_WIDTH,
              maxWidth: 'calc(100vw - 24px)',
              maxHeight: PANEL_MAX_HEIGHT,
              overflowY: 'auto',
              background: color.bg,
              border: `1px solid ${color.border}`,
              borderRadius: radius.md,
              boxShadow: shadow.dialog,
              zIndex: PROPERTY_EDITOR_Z_INDEX,
              fontSize: font.body,
            }
      }
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 8,
          padding: '10px 12px',
          borderBottom: `1px solid ${color.borderSubtle}`,
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
        {/* 読み取り専用の property (system と種別) も出すか (#357)。端末に覚え、どの欄にも効く */}
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            marginLeft: 'auto',
            color: color.textMuted,
            fontSize: font.caption,
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          <input
            type="checkbox"
            checked={showReadOnly}
            onChange={(e) => setShowReadOnlyProperties(e.target.checked)}
          />
          {t.property.showReadOnly}
        </label>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label={t.property.close}
            className="cs-btn cs-btn--icon cs-btn--sm"
          >
            <X size={ICON_SIZE_SM} aria-hidden />
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <p style={{ margin: 0, padding: 12, color: color.textMuted }}>
          {t.property.none}
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
              onChange={onChange}
            />
          ))}
        </ul>
      )}

      {/* 追加の口。**custom は自由に足せる** (仕様の表) */}
      {!readOnly && (
        <div
          style={{ padding: 12, borderTop: `1px solid ${color.borderSubtle}` }}
        >
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              aria-label={t.property.newName}
              list="property-addable"
              placeholder={t.property.newNamePlaceholder}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              style={{
                flex: 1,
                minWidth: 0,
                padding: '4px 6px',
                fontSize: font.body,
              }}
            />
            <input
              aria-label={t.property.newValue}
              placeholder={t.property.newValuePlaceholder}
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              style={{
                flex: 1,
                minWidth: 0,
                padding: '4px 6px',
                fontSize: font.body,
              }}
            />
            <button
              type="button"
              disabled={!canAdd}
              onClick={() => {
                // template graph で値が空なら、既定値の無い宣言として足す (行は宣言から出る)
                if (templateGraph && newValue === '' && onChange) {
                  onChange({
                    [propertySchemaPropertyOf(addName)]: { editable: true },
                  });
                } else onSet(addName, newValue);
                setNewName('');
                setNewValue('');
              }}
              style={{
                padding: '4px 10px',
                fontSize: font.body,
                cursor: canAdd ? 'pointer' : 'not-allowed',
              }}
            >
              {t.property.add}
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
  onChange,
}: {
  row: PropertyRow;
  readOnly: boolean;
  onSet: (name: string, value: unknown) => void;
  onRemove: (name: string) => void;
  onChange?: (changes: Readonly<Record<string, unknown>>) => void;
}) {
  const t = useMessages();
  // 既定値を補っただけの行 (template-update K12) は、欄を空にして既定値を薄く出す。打てば要素の値になる
  const fromDefault = row.origin === 'default';
  const shown = fromDefault ? '' : displayValue(row.value);
  // 種別は名前も値も id なので、template の名前と種類の名前で出す (#384)。id は hover で見られる
  const label = row.kindLabel;
  const templated = row.templateLabel;
  // 宣言した型 (適用先は `declaredType`、template graph は宣言の欄の型)。入力を型に従って読む (T7)
  const typeText = row.declaredType ?? row.schema?.type;
  const parsedType = typeText ? parsePropertyType(typeText) : undefined;
  const declared = parsedType?.ok ? parsedType.decl.type : undefined;
  const [draft, setDraft] = useState(shown);
  const composingRef = useRef(false);

  // 他者の編集が届いたら追従する。**編集中の打鍵は奪わない**ので、
  // 値が変わったときだけ差し替える
  useEffect(() => {
    setDraft(shown);
  }, [shown]);

  const locked = readOnly || row.readOnly !== undefined;
  // template graph の行: 値は適用先の既定値で、型と editable を宣言できる (K9)
  const schema = onChange ? row.schema : undefined;
  // 宣言ごと消す。値と宣言を 1 つの op にする (2 回に分けると 2 回目が 1 回目を打ち消しうる)
  const remove = () =>
    schema && onChange
      ? onChange({
          [row.name]: undefined,
          [propertySchemaPropertyOf(row.name)]: undefined,
        })
      : onRemove(row.name);

  const commit = () => {
    if (draft === shown) return; // 変わらないものは op-log に積まない (Phase 5 の判断)
    // **型を宣言していなければ値は文字列のまま保存する** (利用者判断 2026-09-20)。
    //
    // 型を指定するのは**実装コードか template のような拡張**であって、入力された値
    // ではない。入力から型を推論して寄せると、`3` と打っただけで数値になり、
    // 文字列の `"3"` を入れる手段が無くなる。template が型を宣言していれば、その型に従って
    // 読む (`valueFromInput`: number なら数に。読めなければ文字列のまま — 型に合わない印が付く)
    // template graph で空にしたら「既定値なし」: 値を消し、宣言は残す (行が消えないように)
    if (schema && onChange && draft.trim() === '') {
      onChange({
        [row.name]: undefined,
        [propertySchemaPropertyOf(row.name)]: {
          ...(schema.type !== '' && { type: schema.type }),
          editable: schema.editable,
        },
      });
      return;
    }
    onSet(row.name, valueFromInput(declared, draft));
  };

  return (
    <li
      style={{
        padding: '8px 12px',
        borderBottom: `1px solid ${color.borderSubtle}`,
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
        <span
          style={{ fontWeight: 600, wordBreak: 'break-all' }}
          title={label || templated ? row.name : undefined}
        >
          {label
            ? t.property.kindOf(label.template)
            : templated
              ? templated.name
              : row.name}
          {/* template が配った property は、prefix を外した名前に template の名前を添える (K7) */}
          {!label && templated && (
            <span
              style={{
                marginLeft: 6,
                fontWeight: 400,
                color: color.textMuted,
                fontSize: font.caption,
              }}
            >
              {templated.template}
            </span>
          )}
        </span>
        {/* template graph の行は型を宣言の欄で見せる (値から読んだ「文字列」と並べると紛らわしい) */}
        {!schema && (
          <span
            data-property-type
            // 宣言した型は、template graph で書いた文字列のまま出す (v1.5.0 の UI レビュー U1)。値から読んだ
            // 「文字列」を出すと、型を宣言したのに効いていないように見えた。選択肢の型は長くなりうるので省略し、
            // hover で全体を出す
            {...(row.declaredType && { title: row.declaredType })}
            style={{
              color: color.textMuted,
              fontSize: font.caption,
              flexShrink: 0,
              maxWidth: TYPE_COLUMN_MAX_WIDTH,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {row.declaredType ?? typeLabel(row.type)}
          </span>
        )}
      </div>

      {locked ? (
        <div
          style={{ color: color.textMuted, wordBreak: 'break-all' }}
          title={label ? shown : undefined}
        >
          {label ? label.kind : shown}
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
          {declared?.kind === 'literals' ? (
            // 列挙を宣言していれば、選択肢から選ばせる (選べば確定する)
            <select
              aria-label={
                schema
                  ? t.property.defaultValueOf(row.name)
                  : t.property.valueOf(templated?.name ?? row.name)
              }
              value={
                declared.values.includes(displayValue(row.value)) &&
                !fromDefault
                  ? displayValue(row.value)
                  : ''
              }
              onChange={(e) =>
                e.target.value === ''
                  ? fromDefault || onRemove(row.name)
                  : onSet(row.name, e.target.value)
              }
              style={{
                flex: 1,
                minWidth: 0,
                padding: '4px 6px',
                fontSize: font.body,
              }}
            >
              <option value="">
                {fromDefault ? displayValue(row.value) || '—' : '—'}
              </option>
              {declared.values.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          ) : (
            <input
              aria-label={
                schema
                  ? t.property.defaultValueOf(row.name)
                  : t.property.valueOf(templated?.name ?? row.name)
              }
              placeholder={
                schema
                  ? t.property.noDefault
                  : fromDefault
                    ? displayValue(row.value)
                    : undefined
              }
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
              style={{
                flex: 1,
                minWidth: 0,
                padding: '4px 6px',
                fontSize: font.body,
              }}
            />
          )}
          {/* 既定値を補っただけの行には、消す値が無い */}
          {!fromDefault && (
            <button
              type="button"
              onClick={remove}
              aria-label={t.property.remove(templated?.name ?? row.name)}
              className="cs-btn cs-btn--icon cs-btn--sm"
            >
              <Trash2 size={ICON_SIZE_SM} aria-hidden />
            </button>
          )}
        </div>
      )}

      {/* 宣言した型に合わない値・欠けた必須の値 (K9)。値は書き換えず、印だけを付ける (K2) */}
      {row.check !== undefined && (
        <div
          role="status"
          style={{ color: color.warningText, fontSize: font.caption }}
        >
          {row.check === 'missing'
            ? t.property.missingValue
            : t.property.typeMismatch(row.declaredType ?? '')}
        </div>
      )}

      {schema && onChange && (
        <SchemaFields
          name={row.name}
          schema={schema}
          readOnly={readOnly}
          onChange={onChange}
        />
      )}

      {/* **なぜ編集できないかを言う。**言わないと「壊れている」に見える */}
      {row.readOnly !== undefined && (
        <div style={{ color: color.textMuted, fontSize: font.caption }}>
          {/* なぜ編集できないかを人に言う。**理由ごとに文言を変える** */}
          {t.property.readOnly[row.readOnly]}
        </div>
      )}
    </li>
  );
}

/**
 * template graph の行の宣言の欄: 型の入力欄と editable のチェック (template-update K9・Q4)。
 *
 * 書くのは `app.conversensus.propertySchema.<名前>` の値 1 つ。何も宣言しない形 (型が空で editable) になれば
 * その property を消す (`propertySchemaValueOf`)。型の文字列が読めなければ理由を出す — 読めない型は適用先で
 * 効かない (型の無い property として扱う) ので、黙っていると「型を付けたのに効かない」になる
 */
function SchemaFields({
  name,
  schema,
  readOnly,
  onChange,
}: {
  name: string;
  schema: RowSchema;
  readOnly: boolean;
  onChange: (changes: Readonly<Record<string, unknown>>) => void;
}) {
  const t = useMessages();
  const [draft, setDraft] = useState(schema.type);
  const composingRef = useRef(false);
  useEffect(() => {
    setDraft(schema.type);
  }, [schema.type]);

  const write = (type: string, editable: boolean) =>
    onChange({
      [propertySchemaPropertyOf(name)]: propertySchemaValueOf({
        type,
        editable,
      }),
    });
  const commit = () => {
    if (draft.trim() === schema.type) return;
    write(draft, schema.editable);
  };

  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          aria-label={t.property.typeOf(name)}
          placeholder={t.property.typePlaceholder}
          value={draft}
          disabled={readOnly}
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
            if (e.key === 'Escape') setDraft(schema.type);
          }}
          style={{
            flex: 1,
            minWidth: 0,
            padding: '2px 6px',
            fontSize: font.caption,
            fontFamily: 'monospace',
          }}
        />
        <label
          title={t.property.editableTitle}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            color: color.textMuted,
            fontSize: font.caption,
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          <input
            type="checkbox"
            checked={schema.editable}
            disabled={readOnly}
            onChange={(e) => write(schema.type, e.target.checked)}
          />
          {t.property.editable}
        </label>
      </div>
      {schema.typeError !== undefined && (
        <div
          role="alert"
          style={{ color: color.warningText, fontSize: font.caption }}
        >
          {t.property.typeError(schema.typeError)}
        </div>
      )}
    </div>
  );
}
