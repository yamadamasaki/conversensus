import { describe, expect, test } from 'bun:test';
import { GENESIS_ACTOR } from '../events/unified';
import type { SheetId, TemplateId } from '../schemas';
import { templateIdOf } from '../template/fromSheet';
import { kindPropertyOf } from '../template/kind';
import {
  type ImportIdMaps,
  remapKindProperties,
  remapTemplateRefs,
} from './importTemplateRefs';

const OLD = 'old-sheet';
const NEW = 'new-sheet' as SheetId;
const ids: ImportIdMaps = {
  sheet: new Map([[OLD, NEW]]),
  element: (sheetId, elementId) =>
    sheetId === OLD && elementId === 'old-claim' ? 'new-claim' : undefined,
};
const kindOf = (sheetId: string) => kindPropertyOf(templateIdOf(sheetId));

describe('remapKindProperties', () => {
  test('template graph の種別は、名前も値も新しい Sheet の要素へ付け替える', () => {
    expect(remapKindProperties({ [kindOf(OLD)]: 'old-claim' }, ids)).toEqual({
      [kindOf(NEW)]: 'new-claim',
    });
  });

  test('種別でない property と、取り込んだ File に無い Sheet の種別はそのまま', () => {
    const properties = {
      章: 1,
      [kindOf('elsewhere')]: 'old-claim',
      // 作り込みの template (逆順ドメイン) の種別も、Sheet を指さないので触らない
      [kindPropertyOf('jp.co.metabolics.toulmin' as TemplateId)]: 'claim',
    };
    expect(remapKindProperties(properties, ids)).toEqual(properties);
  });

  test('値が要素の id に当たらなければ、名前だけ付け替える', () => {
    expect(remapKindProperties({ [kindOf(OLD)]: 'gone' }, ids)).toEqual({
      [kindOf(NEW)]: 'gone',
    });
  });
});

describe('remapTemplateRefs', () => {
  test('template graph の参照は新しい Sheet を指し、切断面は genesis の指定の番まで', () => {
    expect(
      remapTemplateRefs(
        [{ sheet: OLD as SheetId, at: { 'did:plc:alice#dev': 4 } }],
        ids,
        7,
      ),
    ).toEqual([{ sheet: NEW, at: { [GENESIS_ACTOR]: 7 } }]);
  });

  test('作り込みの id はそのまま (解決されないが、書かれたものは消さない)', () => {
    const builtIn = 'jp.co.metabolics.toulmin' as TemplateId;
    expect(remapTemplateRefs([builtIn], ids, 7)).toEqual([builtIn]);
  });
});
