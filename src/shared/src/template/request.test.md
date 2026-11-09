# request.test.ts (template) — 依頼・相談の種のテスト仕様

## 何を

作り込みの種「依頼・相談」(`REQUEST_TEMPLATE`、agent 段 4 R2、設計 agent-actor.md D6) を検証する。

## なぜ

依頼・相談の種類は core に入れず template で定義し、core が知る「応答を求める node」の印
(`app.conversensus.request.addressee`) を**種類の既定値**として持たせる。種は「シートを追加 ▾」で File の template graph に
複製され、当てたシートはその複製から template を読み直す。**この道のどこかで既定値が落ちると、依頼 node を
作っても応答を求める node にならない** (送る・状態・通知がすべて効かない)。

## どのように

- 種類は依頼と相談の 2 つ。edge の種類は持たない — 答えの edge は「答える」の操作だけが作り、
  `answers` を付ける (edge の種類「答え」を置くと、人が引いた普通の edge にも「答え」が付き、答えに
  見えるのに答えとして数えられない)
- 種を template graph に複製し (`templateGraphOf`)、そこから読み直しても (`templateFromSheet`)、
  種類の既定値に宛先 (空) と答えの場所 (`linkedNode`) が残る
- その種類で作った node (既定値 + 種別プロパティ、画面と同じ作り方) は、作った時から応答を求める node で、
  状態は下書き
- en に訳すと名前と種類名が英語になり、既定値は変わらない (訳すのは表示だけ)
