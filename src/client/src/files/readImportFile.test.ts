import { describe, expect, it } from 'bun:test';
import { CONVERSENSUS_FILE_VERSION } from '@conversensus/shared';
import { IMPORT_READ_FAILED, readImportFile } from './readImportFile';

const FILE_ID = '11111111-1111-4111-8111-111111111111';
const SHEET_ID = '22222222-2222-4222-8222-222222222222';

const asBlob = (text: string) => new Blob([text]);

const validFile = {
  version: CONVERSENSUS_FILE_VERSION,
  id: FILE_ID,
  name: 'テスト',
  description: '',
  sheets: [{ id: SHEET_ID, name: 'Sheet 1', nodes: [], edges: [] }],
};

describe('readImportFile', () => {
  it('最新形式の .conversensus を読める', async () => {
    const result = await readImportFile(asBlob(JSON.stringify(validFile)));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.name).toBe('テスト');
  });

  it('JSON でなければ「読み込みに失敗」と言う', async () => {
    const result = await readImportFile(asBlob('{ 壊れている'));
    expect(result).toEqual({ ok: false, message: IMPORT_READ_FAILED });
  });

  it('JSON でも形が違えば、どこが違うかを添えて言う', async () => {
    const result = await readImportFile(asBlob(JSON.stringify({ foo: 1 })));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toStartWith('ファイル形式が不正です:\n');
      // 理由の行が 1 つ以上ある (空の説明で済ませない)
      expect(result.message.split('\n').length).toBeGreaterThan(1);
    }
  });
});
