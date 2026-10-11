/**
 * File をまたいで探す (#248)
 *
 * サイドバーの名前の検索 (#249) とは別の口にする (利用者判断 2026-10-11)。ここは名前に加えて
 * **中身** (node の本文・label・property と edge の label) を、全 File の trunk の Sheet から引く。
 *
 * - 名前の当たりは打つたびに出す (一覧に載っているので手元で引ける)
 * - 中身はローカル正典の Worker で全 File を畳み込んで引くので、打ち終わるのを少し待って
 *   (`CONTENT_SEARCH_DELAY_MS`) 引く。遅れて届いた古い検索語の結果は捨てる
 * - 1 件を押すと、ダイアログを閉じてその File と Sheet を開く。中身の当たりはそこで要素に寄せる
 *
 * 型は「入力」(visual language §6.1): Esc と外側のクリックで閉じる。
 */

import type { GraphFileListItem } from '@conversensus/shared';
import { useEffect, useRef, useState } from 'react';
import type { FolderTree } from '../folders/folderTree';
import { color, font, radius, space } from '../theme';
import { Dialog } from '../ui/Dialog';
import { HitText, hitKeyOf } from './HitText';
import { NameHighlight } from './NameHighlight';
import { type NameHit, nameHits } from './nameHits';
import type { FileSearchHit, FileSearchResult } from './searchFiles';
import type { SearchOptions } from './searchSheet';

/** 打ち終わりを待つ時間。1 文字ごとに全 File を畳み込まない */
export const CONTENT_SEARCH_DELAY_MS = 250;

export const GLOBAL_SEARCH_LABEL = 'File をまたいで探す';
const DIALOG_WIDTH_WIDE = 560;

type Props = {
  files: readonly GraphFileListItem[];
  folderTree: FolderTree;
  searchContent: (
    query: string,
    options: SearchOptions,
  ) => Promise<FileSearchResult>;
  /** 名前の当たりを開く (File なら最初の Sheet) */
  onOpenName: (hit: NameHit) => void;
  /** 中身の当たりを開き、要素に寄せる */
  onOpenContent: (hit: FileSearchHit) => void;
  onClose: () => void;
};

const rowStyle = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: `${space[2]}px ${space[3]}px`,
  border: 'none',
  borderBottom: `1px solid ${color.borderSubtle}`,
  background: 'none',
  cursor: 'pointer',
  fontSize: font.body,
  lineHeight: 1.6,
} as const;

const sectionTitleStyle = {
  margin: `${space[3]}px 0 ${space[1]}px`,
  fontSize: font.caption,
  color: color.textMuted,
  fontWeight: 600,
} as const;

export function GlobalSearchDialog({
  files,
  folderTree,
  searchContent,
  onOpenName,
  onOpenContent,
  onClose,
}: Props) {
  const [query, setQuery] = useState('');
  /** 変換が確定した検索語。日本語の変換中に引かない */
  const [settled, setSettled] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [content, setContent] = useState<{
    query: string;
    result: FileSearchResult;
  } | null>(null);
  const composingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  /** 引く検索語。前後の空白は無視する (サイドバーの名前の検索と同じ) */
  const term = settled.trim();

  // 中身は打ち終わりを待って引く。古い検索語の結果が後から届いても捨てる
  useEffect(() => {
    if (term === '') {
      setContent(null);
      return;
    }
    let stale = false;
    const timer = setTimeout(() => {
      searchContent(term, { caseSensitive })
        .then((result) => {
          if (!stale) setContent({ query: term, result });
        })
        .catch((error: unknown) =>
          console.error('[search] File をまたぐ検索に失敗した', error),
        );
    }, CONTENT_SEARCH_DELAY_MS);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [term, caseSensitive, searchContent]);

  const names = nameHits(folderTree, files, term);
  const contentHits = content?.query === term ? content.result : null;
  const searching = term !== '' && contentHits === null;
  const nothing =
    term !== '' &&
    names.length === 0 &&
    contentHits !== null &&
    contentHits.hits.length === 0;

  return (
    <Dialog
      kind="input"
      label={GLOBAL_SEARCH_LABEL}
      title={GLOBAL_SEARCH_LABEL}
      onDismiss={onClose}
      width={DIALOG_WIDTH_WIDE}
      scroll
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: space[2] }}>
        <input
          ref={inputRef}
          type="search"
          aria-label="検索語"
          placeholder="名前と中身を探す"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!composingRef.current) setSettled(e.target.value);
          }}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={(e) => {
            composingRef.current = false;
            setSettled(e.currentTarget.value);
          }}
          style={{
            flex: 1,
            minWidth: 0,
            padding: '6px 8px',
            fontSize: font.body,
            borderRadius: radius.sm,
            border: `1px solid ${color.border}`,
          }}
        />
        <label
          title="大文字と小文字を区別する (中身)"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            whiteSpace: 'nowrap',
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={caseSensitive}
            onChange={(e) => setCaseSensitive(e.target.checked)}
          />
          Aa
        </label>
      </div>

      {names.length > 0 && (
        <section aria-label="名前の当たり">
          <h3 style={sectionTitleStyle}>名前 ({names.length} 件)</h3>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {names.map((hit) => (
              <li key={`${hit.kind}:${hit.fileId}:${hit.sheetId}:${hit.name}`}>
                <button
                  type="button"
                  style={rowStyle}
                  onClick={() => onOpenName(hit)}
                >
                  <span
                    style={{ color: color.textMuted, fontSize: font.caption }}
                  >
                    {hit.kind === 'folder'
                      ? 'Folder'
                      : hit.kind === 'file'
                        ? 'File'
                        : 'Sheet'}
                  </span>
                  <br />
                  {hit.context}
                  <NameHighlight name={hit.name} query={term} />
                  {hit.trailing}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {contentHits !== null && contentHits.hits.length > 0 && (
        <section aria-label="中身の当たり">
          <h3 style={sectionTitleStyle}>
            中身 ({contentHits.hits.length} 件
            {contentHits.truncated && '。多すぎるので途中まで'})
          </h3>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {contentHits.hits.map((hit) => (
              <li key={`${hit.fileId}:${hit.sheetId}:${hitKeyOf(hit)}`}>
                <button
                  type="button"
                  style={rowStyle}
                  onClick={() => onOpenContent(hit)}
                >
                  <span style={{ fontSize: font.caption }}>
                    {hit.fileName} / {hit.sheetName}
                  </span>
                  <br />
                  <HitText hit={hit} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {searching && (
        <p style={{ margin: `${space[3]}px 0 0`, color: color.textMuted }}>
          中身を探しています…
        </p>
      )}
      {nothing && (
        <p style={{ margin: `${space[3]}px 0 0`, color: color.textMuted }}>
          「{term}」に当たるものはありません
        </p>
      )}
    </Dialog>
  );
}
