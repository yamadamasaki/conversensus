/**
 * 共有の印 (step2 Phase 2)
 *
 * 「共有している」と「共有が切れている」を**同じ 1 つの絵**で出す。取り消されても
 * File は手元に残るので、何も出さないと「もう同期されない File」が普通の File に見える。
 *
 * **文字で出さない** (2026-09-05 の実機で判断)。「同期していません」の札は File 名の
 * 隣で幅を食い、サイドバーの主目的である**File 名の識別**を潰していた。状態は 2 値なので、
 * 共有の絵に ✕ を添えれば足りる。
 *
 * **✕ は絵の上に大きく重ねず、隅に小さく置く。**15px では、全面に渡した ✕ が下地を
 * 塗り潰してしまい、**「✕」としか読めなくなる** (実際に描いて確かめた)。共有の絵が
 * 残らなければ「何が切れたのか」が言えないので、下地を残す方を採る。
 *
 * **✕ は SVG で描く。**絵文字の合成 (`👥` に `❌` を重ねる、異体字セレクタ、合字) は
 * エンジンごとに位置も大きさも変わる。WebKit を本命に据えている以上 (ANA-125)、
 * ここは決定論的に描けるものを使う。
 */

/** 絵文字の描画幅はエンジンごとに違うので、箱の大きさをこちらで決める */
const ICON_BOX = 15;
/** ✕ の色。警告 (黄) ではなく「届いていない」(赤) を意味する */
const CROSS_COLOR = '#c0392b';

export function ShareStatusIcon({ detached }: { detached: boolean }) {
  return (
    <span
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: ICON_BOX,
        height: ICON_BOX,
        verticalAlign: 'middle',
      }}
    >
      <span style={{ lineHeight: 1 }}>👥</span>
      {detached && (
        <svg
          role="img"
          aria-label="共有が切れている"
          viewBox="0 0 16 16"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            // 箱ごとボタンの一部なので、当たり判定を分けない
            pointerEvents: 'none',
          }}
        >
          {/* 白い縁。下地の絵の上でも印の輪郭が立つようにする */}
          <circle cx="11.3" cy="11.3" r="4.7" fill="#fff" />
          <circle cx="11.3" cy="11.3" r="3.7" fill={CROSS_COLOR} />
          <g stroke="#fff" strokeWidth={1.3} strokeLinecap="round">
            <line x1="9.9" y1="9.9" x2="12.7" y2="12.7" />
            <line x1="12.7" y1="9.9" x2="9.9" y2="12.7" />
          </g>
        </svg>
      )}
    </span>
  );
}
