/**
 * 既定のテーマに、図の拡大を足す。
 *
 * 図の多くは画面全体を撮ったもので、本文の幅に縮めると文字が読めない。押すと拡大する
 * (medium-zoom)。ページを移るたびに付け直す
 */

import mediumZoom from 'medium-zoom';
import { useRoute } from 'vitepress';
import DefaultTheme from 'vitepress/theme';
import { nextTick, onMounted, watch } from 'vue';
import './custom.css';

/** 拡大の対象。原稿の `<figure>` の中の図だけ (ロゴなどは除く) */
const ZOOMABLE = '.vp-doc figure img';

export default {
  extends: DefaultTheme,
  setup() {
    const route = useRoute();
    const attach = () => {
      mediumZoom(ZOOMABLE, { background: 'var(--vp-c-bg)' });
    };
    onMounted(attach);
    watch(
      () => route.path,
      () => nextTick(attach),
    );
  },
};
