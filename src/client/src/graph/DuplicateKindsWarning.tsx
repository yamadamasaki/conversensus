import { duplicateKindLabels, type Sheet } from '@conversensus/shared';
import { useMessages } from '../i18n/messages';
import { color, font, radius } from '../theme';

/**
 * template graph の中で名前の重なった種類を知らせる (template-update K6)
 *
 * 名前の重なった種類は、読み替えのときに両方とも無効になる (`templateFromSheet`)。共同編集では書き込みの
 * 時点で一意を強制できないので、黙って片方を採る代わりに、定義している人に見える所で知らせる。
 * 重なりが無ければ何も出さない。押す操作を邪魔しないよう、ポインタは下の pane へ通す
 */
export function DuplicateKindsWarning({
  sheet,
}: {
  sheet: Pick<Sheet, 'nodes'>;
}) {
  const t = useMessages();
  const labels = duplicateKindLabels(sheet);
  if (labels.length === 0) return null;
  return (
    <div
      role="status"
      style={{
        position: 'absolute',
        top: 8,
        left: '50%',
        transform: 'translateX(-50%)',
        maxWidth: 'calc(100% - 32px)',
        background: color.warningBg,
        border: `1px solid ${color.warning}`,
        borderRadius: radius.sm,
        color: color.warningText,
        fontSize: font.caption,
        lineHeight: 1.5,
        padding: '4px 8px',
        pointerEvents: 'none',
        zIndex: 5,
      }}
    >
      {t.graph.duplicateKinds(labels.map((l) => `「${l}」`).join(' '))}
    </div>
  );
}
