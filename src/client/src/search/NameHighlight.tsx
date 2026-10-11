import { color } from '../theme';
import { findNameMatch } from './nameFilter';

/**
 * 名前の中の当たりに色を付ける (#249)。当たらなければ名前をそのまま出す。
 * 色は Sheet 内検索の結果一覧と同じ (`SearchPanel`)
 */
export function NameHighlight({
  name,
  query,
}: {
  name: string;
  query: string;
}) {
  const match = findNameMatch(name, query);
  if (match === null) return <>{name}</>;
  const end = match.start + match.length;
  return (
    <>
      {name.slice(0, match.start)}
      {/*
        display を明示する。既定の表示が inline でないと見なす環境 (happy-dom) では、名前の
        計算で前後に空白が入り、「議事 録」という名前のボタンになった
      */}
      <mark
        style={{
          display: 'inline',
          background: color.warningBg,
          color: 'inherit',
        }}
      >
        {name.slice(match.start, end)}
      </mark>
      {name.slice(end)}
    </>
  );
}
