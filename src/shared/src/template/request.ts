import {
  ADDRESSEE_PROPERTY,
  ANSWER_TARGET_LINKED_NODE,
  ANSWER_TARGET_PROPERTY,
} from '../events/request';
import type { KindPlacement } from './seed';
import { type Template, TemplateSchema } from './types';

/**
 * 依頼・相談の template の種 (agent 段 4 R2, 設計 agent-actor.md D6)。
 *
 * **種類は core に入れず template で定義する** — 他の actor への言語行為の種類はこれから増えうる。
 * core が知るのは種類に依らない「応答を求める node」(`app.conversensus.addressee` を持つ node) だけで、
 * 種類はそれを**既定値として持つ**。この種から作った node は、作った時から応答を求める node になる
 * (宛先は空 = 不特定、まだ送っていない = 下書き)。
 *
 * 依頼と相談の違いは名前と説明だけである。**説明は種類ごとの指示**になる (D13) — 人間にも agent にも
 * 同じ説明を見せる (`read_file` の注釈に出る)。
 *
 * **edge の種類は持たない** (計画 R2)。答えの edge は「答える」の操作だけが作り、
 * `app.conversensus.answers` を付ける。edge の種類「答え」を置くと、人が依頼から普通の node へ引いた
 * edge にも自動で「答え」が付き、答えに見えるのに答えとして数えられない edge ができる。
 */
export const REQUEST_TEMPLATE: Template = TemplateSchema.parse({
  id: 'jp.co.metabolics.request',
  name: '依頼・相談',
  nodeKinds: [
    {
      id: 'request',
      label: '依頼',
      description:
        '宛先に、本文に書いたことをしてもらう。答えは新しい node に書き、依頼からその node へ edge を張る',
      defaults: {
        [ADDRESSEE_PROPERTY]: [],
        [ANSWER_TARGET_PROPERTY]: ANSWER_TARGET_LINKED_NODE,
      },
    },
    {
      id: 'consultation',
      label: '相談',
      description:
        '宛先に、本文に書いたことについて意見を求める。答えは新しい node に書き、相談からその node へ edge を張る',
      defaults: {
        [ADDRESSEE_PROPERTY]: [],
        [ANSWER_TARGET_PROPERTY]: ANSWER_TARGET_LINKED_NODE,
      },
    },
  ],
  edgeKinds: [],
});

/** 並べ方: 2 つの種類を横に */
export const REQUEST_PLACEMENT: KindPlacement = {
  request: { x: 0, y: 0 },
  consultation: { x: 240, y: 0 },
};
