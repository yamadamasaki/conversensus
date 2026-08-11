import { describe, expect, it } from 'bun:test';
import { RF_IMAGE_NODE_TYPE } from '../graphTransform';
import { pickImagePasteTarget } from './pasteTarget';

const image = (id: string, selected = false) => ({
  id,
  type: RF_IMAGE_NODE_TYPE,
  selected,
});
const text = (id: string, selected = false) => ({
  id,
  type: 'editableNode',
  selected,
});

describe('pickImagePasteTarget', () => {
  it('画像ノードが 1 つ選択されていればそれを返す', () => {
    expect(pickImagePasteTarget([image('a', true), text('b')])?.id).toBe('a');
  });

  it('選択が無ければ undefined (呼び出し側は新規ノードを作る)', () => {
    expect(pickImagePasteTarget([image('a'), text('b')])).toBeUndefined();
  });

  it('画像ノードが複数選択されていれば undefined', () => {
    // そのうちの 1 つが差し替わると、どれが変わったか利用者に予測できない
    expect(
      pickImagePasteTarget([image('a', true), image('b', true)]),
    ).toBeUndefined();
  });

  it('選択されているのが画像ノードでなければ undefined', () => {
    expect(pickImagePasteTarget([text('a', true)])).toBeUndefined();
  });

  it('画像ノードと別種を同時に選んでいる場合も画像ノードを選ぶ', () => {
    // 「画像ノードがちょうど 1 つ」が条件であり、選択総数は問わない
    expect(pickImagePasteTarget([image('a', true), text('b', true)])?.id).toBe(
      'a',
    );
  });
});
