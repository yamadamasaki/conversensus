/**
 * template の property の型 (template-update K10、計画 T4)
 *
 * 型は template graph の種類の node/edge に**文字列で**書く (K9、宣言の置き場所は T5)。ここはその文字列の
 * 文法・読み (`parsePropertyType`)・書き (`formatPropertyType`)・型で値を検証する関数 (`checkPropertyValue`) を持つ。
 * **値から型を推論することはしない** (利用者判断 2026-09-20、`events/properties.ts`)。型は定義する側が書く。
 *
 * 文法:
 *
 * ```
 * 宣言       := 本体 '?'?                       optional (無くてもよい)
 * 本体       := 列挙 | 並べられるもの
 * 列挙       := リテラル ('|' リテラル)+           リテラルのユニオン。後ろに [] は付けられない
 * 並べられるもの := 原子 ('[]')*                    配列
 * 原子       := 基本の型 | リテラル | '(' リテラル ('|' リテラル)* ')'
 * 基本の型    := string | number | boolean | date | datetime
 * リテラル    := '…' | "…"                        引用符の中に同じ引用符は書けない (エスケープは無い)
 * ```
 *
 * - **ユニオンはリテラルに限る** (K10)。`string | number` のような型のユニオンは扱わない。編集の欄 (どちらの
 *   入力欄を出すか) が重い割に、使い道が少ないため
 * - 列挙の配列は括弧で書く: `('高' | '中')[]`。括弧が無い `'高' | '中'[]` は、`[]` がどこに掛かるか読み手に
 *   分からないので誤りにする
 * - 空白は語の間のどこにでも置ける
 */

/** 基本の型。`events/properties.ts` の `PropertyType` のうち、宣言で書けるもの */
export const BASE_PROPERTY_TYPES = [
  'string',
  'number',
  'boolean',
  'date',
  'datetime',
] as const;
export type BasePropertyType = (typeof BASE_PROPERTY_TYPES)[number];

/** 型の構文木 (optional は宣言の側が持つ) */
export type PropertyTypeExpr =
  | { kind: 'base'; name: BasePropertyType }
  /** リテラルのユニオン。要素が 1 つなら 1 つのリテラル */
  | { kind: 'literals'; values: string[] }
  | { kind: 'array'; element: PropertyTypeExpr };

/** 型の宣言 = 型 + 無くてもよいか */
export type PropertyTypeDecl = { type: PropertyTypeExpr; optional: boolean };

export type ParseResult =
  | { ok: true; decl: PropertyTypeDecl }
  /** `at` は誤りを見つけた位置 (文字の番号、0 始まり) */
  | { ok: false; error: string; at: number };

class TypeSyntaxError extends Error {
  readonly at: number;
  constructor(message: string, at: number) {
    super(message);
    this.at = at;
  }
}

/** 型の文字列を読む。誤りなら位置と理由を返す (例外は投げない。他の参加者が書いた文字列を読むため) */
export function parsePropertyType(text: string): ParseResult {
  let pos = 0;

  const skipSpaces = () => {
    while (pos < text.length && /\s/.test(text[pos] as string)) pos++;
  };
  const peek = (s: string) => {
    skipSpaces();
    return text.startsWith(s, pos);
  };
  const expect = (s: string) => {
    if (!peek(s)) throw new TypeSyntaxError(`「${s}」が要る`, pos);
    pos += s.length;
  };

  const literal = (): string => {
    skipSpaces();
    const quote = text[pos];
    if (quote !== "'" && quote !== '"') {
      throw new TypeSyntaxError('リテラル (引用符で囲んだ文字列) が要る', pos);
    }
    const end = text.indexOf(quote, pos + 1);
    if (end < 0) throw new TypeSyntaxError('引用符が閉じていない', pos);
    const value = text.slice(pos + 1, end);
    pos = end + 1;
    return value;
  };

  /** '|' で繋いだリテラルの並び (最初の 1 つは読んであるもの) */
  const moreLiterals = (first: string): string[] => {
    const values = [first];
    while (peek('|')) {
      pos++;
      values.push(literal());
    }
    return values;
  };

  const atom = (): PropertyTypeExpr => {
    skipSpaces();
    if (peek('(')) {
      pos++;
      const values = moreLiterals(literal());
      expect(')');
      return { kind: 'literals', values };
    }
    if (peek("'") || peek('"'))
      return { kind: 'literals', values: [literal()] };
    const start = pos;
    while (pos < text.length && /[a-z]/.test(text[pos] as string)) pos++;
    const name = text.slice(start, pos);
    if ((BASE_PROPERTY_TYPES as readonly string[]).includes(name)) {
      return { kind: 'base', name: name as BasePropertyType };
    }
    pos = start;
    throw new TypeSyntaxError(
      name === ''
        ? '型が要る'
        : `知らない型「${name}」 (書けるのは ${BASE_PROPERTY_TYPES.join('・')}・リテラル)`,
      start,
    );
  };

  const arrays = (inner: PropertyTypeExpr): PropertyTypeExpr => {
    let type = inner;
    while (peek('[')) {
      pos++;
      expect(']');
      type = { kind: 'array', element: type };
    }
    return type;
  };

  const body = (): PropertyTypeExpr => {
    const first = atom();
    // 括弧の無いリテラルの後に '|' が続けば列挙。後ろに [] は付けられない
    if (first.kind === 'literals' && first.values.length === 1 && peek('|')) {
      const values = moreLiterals(first.values[0] as string);
      if (peek('[')) {
        throw new TypeSyntaxError("列挙の配列は括弧で囲む: ('a' | 'b')[]", pos);
      }
      return { kind: 'literals', values };
    }
    return arrays(first);
  };

  try {
    const type = body();
    let optional = false;
    if (peek('?')) {
      pos++;
      optional = true;
    }
    skipSpaces();
    if (pos < text.length) {
      throw new TypeSyntaxError('余計な文字がある', pos);
    }
    return { ok: true, decl: { type, optional } };
  } catch (e) {
    if (e instanceof TypeSyntaxError) {
      return { ok: false, error: e.message, at: e.at };
    }
    throw e;
  }
}

/**
 * 型を文字列にする (`parsePropertyType` の逆)。リテラルは単引用符で囲み、単引用符を含むものだけ二重引用符で
 * 囲む。列挙は、配列の要素のときだけ括弧で囲む
 */
export function formatPropertyType(decl: PropertyTypeDecl): string {
  return `${formatExpr(decl.type, false)}${decl.optional ? '?' : ''}`;
}

function formatExpr(type: PropertyTypeExpr, inArray: boolean): string {
  switch (type.kind) {
    case 'base':
      return type.name;
    case 'array':
      return `${formatExpr(type.element, true)}[]`;
    case 'literals': {
      const joined = type.values.map(quoteLiteral).join(' | ');
      return inArray && type.values.length > 1 ? `(${joined})` : joined;
    }
  }
}

function quoteLiteral(value: string): string {
  return value.includes("'") ? `"${value}"` : `'${value}'`;
}

/** 日付 (`YYYY-MM-DD`)。存在しない日 (2 月 30 日など) は誤り */
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** 日時 (ISO 8601。秒・小数・時差は省略できる) */
const DATETIME =
  /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d+)?)?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)?$/;

function isDate(value: string): boolean {
  const m = DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === mo - 1 &&
    date.getUTCDate() === d
  );
}

function isDatetime(value: string): boolean {
  const m = DATETIME.exec(value);
  return m !== null && isDate(m[1] as string);
}

/** 値がその型に合うか (値が在るときだけ呼ぶ) */
export function matchesPropertyType(
  type: PropertyTypeExpr,
  value: unknown,
): boolean {
  switch (type.kind) {
    case 'base':
      switch (type.name) {
        case 'string':
          return typeof value === 'string';
        case 'number':
          return typeof value === 'number' && Number.isFinite(value);
        case 'boolean':
          return typeof value === 'boolean';
        case 'date':
          return typeof value === 'string' && isDate(value);
        case 'datetime':
          return typeof value === 'string' && isDatetime(value);
      }
      break;
    case 'literals':
      return typeof value === 'string' && type.values.includes(value);
    case 'array':
      return (
        Array.isArray(value) &&
        value.every((v) => matchesPropertyType(type.element, v))
      );
  }
  return false;
}

/**
 * 値を宣言で検証する。値が無い (`undefined`) ときは、optional なら合格、そうでなければ「欠けている」。
 *
 * **読み取り側で使う** (K9): 他の参加者の op は書き込みの検証を通らずに届くので、合わない値を落としたり
 * 書き換えたりせず、印を付けるための判定を返す
 */
export function checkPropertyValue(
  decl: PropertyTypeDecl,
  value: unknown,
): 'ok' | 'missing' | 'mismatch' {
  if (value === undefined) return decl.optional ? 'ok' : 'missing';
  return matchesPropertyType(decl.type, value) ? 'ok' : 'mismatch';
}

/**
 * 入力欄の文字列を、**宣言された型に従って**値にする (template-update T7)。値から型を推論するのではない —
 * 型を決めているのは宣言である。number なら数として読める文字列を数に、boolean なら `true`/`false` を真偽値に
 * する。読めない文字列・それ以外の型 (文字列・日付・列挙) は文字列のまま返す (型に合わなければ印が付く)
 */
export function valueFromInput(
  type: PropertyTypeExpr | undefined,
  text: string,
): unknown {
  if (type?.kind !== 'base') return text;
  if (type.name === 'number') {
    const trimmed = text.trim();
    const n = Number(trimmed);
    return trimmed !== '' && Number.isFinite(n) ? n : text;
  }
  if (type.name === 'boolean') {
    if (text.trim() === 'true') return true;
    if (text.trim() === 'false') return false;
  }
  return text;
}
