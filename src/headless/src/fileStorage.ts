/**
 * file に保存する `Storage` (agent 段 2 H1)
 *
 * client は端末の id・ログインのセッション・参加の初期化の印などを `localStorage` に置く
 * (`sync/safeStorage.ts` 経由)。bun には `localStorage` が無く、代わりを入れないと
 * **起動のたびに新しい端末の id** になる (`getDeviceId` の退避先はプロセスの中だけで一貫する)。
 * それでも正しさは壊れないが、actor (`did#deviceId`) が起動のたびに 1 つ増え、名簿にも
 * 判断ログにも残り続ける。
 *
 * そこで `localStorage` の口をそのまま満たし、中身を JSON の file 1 つに置く。
 *
 * - **書くたびに file へ書く。**量は小さい (数十のキー) ので、まとめて書く工夫はしない
 * - **一時 file に書いてから rename する。**途中で止まっても、前の中身か新しい中身のどちらかが残る
 * - プロセスの中では `Map` が正。file を読むのは作るときの 1 回だけ (1 プロセス = 1 agent, 計画 F8)
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

/** 保存の file の形。キーも値も文字列 (`Storage` の決まり) */
type Saved = Record<string, string>;

function load(path: string): Map<string, string> {
  if (!existsSync(path)) return new Map();
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`[headless] 保存の file の形が違う: ${path}`);
  }
  return new Map(
    Object.entries(parsed).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

export class FileStorage implements Storage {
  private readonly entries: Map<string, string>;
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
    this.entries = load(path);
  }

  get length(): number {
    return this.entries.size;
  }

  key(index: number): string | null {
    return [...this.entries.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.entries.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    // `Storage` は値を文字列にして持つ。数などを渡されても同じにする
    this.entries.set(key, String(value));
    this.save();
  }

  removeItem(key: string): void {
    if (this.entries.delete(key)) this.save();
  }

  clear(): void {
    this.entries.clear();
    this.save();
  }

  private save(): void {
    const saved: Saved = Object.fromEntries(this.entries);
    const temporary = `${this.path}.tmp`;
    writeFileSync(temporary, JSON.stringify(saved));
    renameSync(temporary, this.path);
  }
}
