import { describe, expect, test } from 'bun:test';
import { jsonToLex } from '@atproto/api';
import { repairBrokenBlobRefs } from '@conversensus/shared';
import { IMAGE_PROPERTY_KEY, readImageBlobLocation } from './imageBlob';

const CID = 'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku';
const original = {
  $type: 'blob',
  ref: { $link: CID },
  mimeType: 'image/png',
  size: 3,
};

/**
 * v1.0.0 の直前まで受け手の保存で起きていたこと (#264): @atproto/api が blob を BlobRef に変え、
 * Worker へ structured clone で渡り、JSON として保存された
 */
function asBrokenlyStored(value: unknown): unknown {
  return JSON.parse(JSON.stringify(structuredClone(jsonToLex(value))));
}

describe('壊れて保存された画像の参照を直す (#264)', () => {
  test('壊れた形では画像の場所が読めない (「画像 URL を入力」になる)', () => {
    const stored = asBrokenlyStored({
      [IMAGE_PROPERTY_KEY]: original,
    }) as Record<string, unknown>;
    expect(readImageBlobLocation(stored)).toBeUndefined();
  });

  test('直すと元の参照に戻り、画像の場所が読める', () => {
    const stored = asBrokenlyStored({ [IMAGE_PROPERTY_KEY]: original });
    const repaired = repairBrokenBlobRefs(stored) as Record<string, unknown>;
    expect(repaired).toEqual({ [IMAGE_PROPERTY_KEY]: original });
    expect(readImageBlobLocation(repaired)).toEqual({
      cid: CID,
      mimeType: 'image/png',
    });
  });
});
