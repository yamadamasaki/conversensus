/**
 * 入門の場面: 読書会で J. S. ミル『自由論』(1859) を読む (step4)
 *
 * 入門全体を 1 つの話で通す (`deepse/architecture/step4/intro-guide-figures.md` §1)。
 * 図に写らない下ごしらえ (node を並べること) をここで組み立てて import する。
 * 図に写る操作 (ダイアログ、メニュー、差分) は各章のスクリプトが画面で行う。
 *
 * 題材は public domain の古典を選んだ。中身は本の要約であって引用ではない。
 */

import { computeBlobCid } from '../../../src/shared/src/blob';
import {
  FileBuilder,
  type SheetBuilder,
} from '../../../src/shared/src/scenario/fileBuilder';
import type { ConversensusFile, NodeId } from '../../../src/shared/src/schemas';
import { LOCALE } from './support';

const TEXT = {
  ja: {
    file: '『自由論』を読む',
    folder: '読書会',
    ch1: '第 1 章 序論',
    ch2: '第 2 章 思想と言論の自由',
    index: 'index',
    cover: { title: '自由論', author: 'J. S. ミル', year: '1859' },
    simpleFile: '主張と出典',
    simpleSheet: '危害原理',
    coverLabel: '表紙',
    publishedProperty: '刊行',
    claimLabel: '主張',
    claim: '社会が個人に干渉してよいのは, **他者への危害**を防ぐときだけである',
    sourceLabel: '出典',
    chapterProperty: '章',
    harmGroup: '危害原理',
    selfRegarding: '自分だけに関わる行為\n\n干渉してはならない',
    otherRegarding: '他者に関わる行為\n\n干渉してよいことがある',
    exceptionLabel: '例外',
    exception: '子どもには当てはまらない',
    tyranny: '**多数者の専制**\n\n法律だけでなく, 世論も個人を縛る',
    tyrannyEdge: 'への備え',
    silenced: '沈黙させられた意見は, 真理かもしれない',
    partial: '誤った意見も, 真理の一部を含みうる',
    deadDogma: '真理も, 論争されなければ死んだ教義になる',
    freeSpeech: '意見の表明を禁じてはならない',
    supports: '根拠',
    indexNote: '第 2 章は, 第 1 章の原理を思想と言論に当てはめている',
    branch: '別の読み',
    branchClaim:
      '個人の自由を制限してよい理由は, **他者への危害**を防ぐことだけである',
    branchNote: '「危害」とは何かが, この原理の要になる',
    commitMessage: '主張を「制限してよい理由」として言い直した',
    trunkClaim:
      '社会が個人に強制してよいのは, **他者への危害**を防ぐときだけである',
    mergeReason: '読書会で「別の読み」の言い方を採ることにした',
    taroNote: '世論による縛りは, 法律より逃れにくいのではないか',
    hanakoClaim:
      '社会が個人に干渉してよいのは, **他者への危害**を防ぐときに限られる',
    taroClaim:
      '社会が個人に干渉してよいのは, **他者への危害**を防ぐ場合だけである',
    applies: '当てはめる',
  },
  en: {
    file: 'Reading On Liberty',
    folder: 'Book club',
    ch1: 'Ch. 1 Introductory',
    ch2: 'Ch. 2 Of the Liberty of Thought and Discussion',
    index: 'index',
    cover: { title: 'On Liberty', author: 'J. S. Mill', year: '1859' },
    simpleFile: 'Claim and source',
    simpleSheet: 'The harm principle',
    coverLabel: 'cover',
    publishedProperty: 'published',
    claimLabel: 'claim',
    claim:
      'Society may interfere with an individual only to prevent **harm to others**',
    sourceLabel: 'source',
    chapterProperty: 'chapter',
    harmGroup: 'The harm principle',
    selfRegarding: 'Self-regarding conduct\n\nNo interference',
    otherRegarding: 'Conduct affecting others\n\nInterference may be justified',
    exceptionLabel: 'exception',
    exception: 'Does not apply to children',
    tyranny:
      '**Tyranny of the majority**\n\nNot only laws but public opinion constrains individuals',
    tyrannyEdge: 'guards against',
    silenced: 'A silenced opinion may be true',
    partial: 'A false opinion may contain part of the truth',
    deadDogma: 'Even truth becomes dead dogma if never contested',
    freeSpeech: 'Expression of opinion must not be prohibited',
    supports: 'grounds',
    indexNote: 'Ch. 2 applies the principle of Ch. 1 to thought and discussion',
    branch: 'another reading',
    branchClaim:
      'The only reason to limit individual liberty is to prevent **harm to others**',
    branchNote: 'What counts as "harm" is the crux of this principle',
    commitMessage: 'Restated the claim as the reason for limiting liberty',
    trunkClaim:
      'Society may compel an individual only to prevent **harm to others**',
    mergeReason: 'The book club adopted the wording of "another reading"',
    taroNote: 'Is public opinion harder to escape than law?',
    hanakoClaim:
      'Society may interfere with an individual solely to prevent **harm to others**',
    taroClaim:
      'Society may interfere with an individual only in order to prevent **harm to others**',
    applies: 'applies',
  },
} as const;

/** 撮る言語の場面の文言 */
export const S = TEXT[LOCALE];

/** markdown の node の大きさ (本文が収まる程度) */
const WIDE = { width: 240, height: 90 };
const TALL = { width: 200, height: 110 };
/** 表紙の画像 node (画像の上に掴む所の帯があるので、その分だけ高い) */
const COVER_SIZE = { width: 150, height: 232 };

/** 第 1 章: 危害原理の周り。1 章の「単純なグラフ」と 4 章の「グラフの画面」に写る */
function chapter1(sheet: SheetBuilder, cover: CoverBlob): { claim: NodeId } {
  const claim = sheet.note(S.claim, {
    at: { x: 0, y: 0 },
    size: WIDE,
    label: S.claimLabel,
    properties: { [S.chapterProperty]: 1 },
  });
  const coverNode = sheet.image(cover, {
    at: { x: 360, y: -70 },
    size: COVER_SIZE,
  });
  sheet.connect(claim, coverNode, S.sourceLabel);

  const group = sheet.group(S.harmGroup, {
    at: { x: -40, y: 200 },
    size: { width: 520, height: 180 },
  });
  sheet.note(S.selfRegarding, {
    at: { x: 20, y: 50 },
    size: TALL,
    parent: group,
  });
  sheet.note(S.otherRegarding, {
    at: { x: 280, y: 50 },
    size: TALL,
    parent: group,
  });

  const exception = sheet.note(S.exception, {
    at: { x: -340, y: 0 },
    size: { width: 200, height: 70 },
  });
  sheet.connect(exception, claim, S.exceptionLabel);

  const tyranny = sheet.note(S.tyranny, {
    at: { x: -340, y: -200 },
    size: WIDE,
  });
  sheet.connect(claim, tyranny, S.tyrannyEdge);
  return { claim };
}

/** 第 2 章: 言論の自由を支える 3 つの根拠 */
function chapter2(sheet: SheetBuilder) {
  const conclusion = sheet.note(S.freeSpeech, {
    at: { x: 220, y: 0 },
    size: WIDE,
  });
  const grounds = [S.silenced, S.partial, S.deadDogma];
  grounds.forEach((text, i) => {
    const node = sheet.note(text, {
      at: { x: i * 260, y: 220 },
      size: WIDE,
    });
    sheet.connect(node, conclusion, S.supports);
  });
}

export type CoverBlob = {
  cid: string;
  mimeType: string;
  data: string;
  size: number;
};

/** 表紙の PNG を、場面に同梱できる形にする */
export async function coverBlob(png: Uint8Array): Promise<CoverBlob> {
  return {
    cid: await computeBlobCid(png),
    mimeType: 'image/png',
    data: Buffer.from(png).toString('base64'),
    size: png.byteLength,
  };
}

/**
 * 1 章の「単純なグラフ」だけの File。markdown の node と画像の node、その間の edge。
 * どれにも label と property を付ける (図の注文どおり)
 */
export function buildSimpleScene(cover: CoverBlob): ConversensusFile {
  const file = new FileBuilder(S.simpleFile);
  const sheet = file.sheet(S.simpleSheet);
  const claim = sheet.note(S.claim, {
    at: { x: 0, y: 70 },
    size: WIDE,
    label: S.claimLabel,
    properties: { [S.chapterProperty]: 1 },
  });
  const coverNode = sheet.image(cover, {
    at: { x: 380, y: 0 },
    size: COVER_SIZE,
    label: S.coverLabel,
    properties: { [S.publishedProperty]: 1859 },
  });
  sheet.connect(claim, coverNode, S.sourceLabel);
  return file.build();
}

/**
 * 場面の File。
 *
 * @param withIndexNotes index にメモと edge を書き足すか (7 章の「書き加えた例」)。
 *   既定の index (graph node だけ) を見せる図では書き足さない
 */
export function buildScene(
  cover: CoverBlob,
  options: { withIndexNotes?: boolean } = {},
): ConversensusFile {
  const file = new FileBuilder(S.file);
  const ch1 = file.sheet(S.ch1);
  chapter1(ch1, cover);
  const ch2 = file.sheet(S.ch2);
  chapter2(ch2);
  const index = file.metagraph(S.index);
  const g1 = index.placeGraphNode(ch1, { x: 0, y: 0 });
  const g2 = index.placeGraphNode(ch2, { x: 360, y: 0 });
  index.placeGraphNode(index, { x: 180, y: -160 });
  if (options.withIndexNotes) {
    const note = index.note(S.indexNote, {
      at: { x: 140, y: 180 },
      size: WIDE,
    });
    index.connect(g2, g1, S.applies);
    index.connect(note, g2);
  }
  return file.build();
}
