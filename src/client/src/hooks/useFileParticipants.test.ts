import { describe, expect, test } from 'bun:test';
import { type Did, type FileId, FileIdSchema } from '@conversensus/shared';
import { renderHook, waitFor } from '@testing-library/react';
import {
  type ParticipatingDids,
  useFileParticipants,
} from './useFileParticipants';

const FILE = FileIdSchema.parse('00000000-0000-4000-8000-0000000000f1');
const OTHER = FileIdSchema.parse('00000000-0000-4000-8000-0000000000f2');
const HANAKO: Did = 'did:plc:hanako';
const TARO: Did = 'did:plc:taro';

const HANDLES: Record<string, string> = {
  [HANAKO]: 'hanako.test',
  [TARO]: 'taro.test',
};
/** ハンドル名を引く口の代わり。表に無い DID は DID のまま */
const resolveLabels = async () => (did: string) => HANDLES[did] ?? did;

function render(
  fileId: FileId | null,
  participating: ParticipatingDids | null,
) {
  return renderHook(
    ({ fileId, participating }) =>
      useFileParticipants(fileId, participating, resolveLabels),
    { initialProps: { fileId, participating } },
  );
}

describe('useFileParticipants', () => {
  test('同期サイクルの名簿をハンドル名の順に並べて候補にする', async () => {
    const { result } = render(FILE, { fileId: FILE, dids: [TARO, HANAKO] });
    await waitFor(() => expect(result.current).toHaveLength(2));
    expect(result.current).toEqual([
      { did: HANAKO, label: 'hanako.test' },
      { did: TARO, label: 'taro.test' },
    ]);
  });

  test('開いた後で参加した人も、次の名簿で候補に出る (#381)', async () => {
    const { result, rerender } = render(FILE, { fileId: FILE, dids: [HANAKO] });
    await waitFor(() => expect(result.current).toHaveLength(1));

    rerender({
      fileId: FILE,
      participating: { fileId: FILE, dids: [HANAKO, TARO] },
    });
    await waitFor(() => expect(result.current).toHaveLength(2));
    expect(result.current.map((p) => p.did)).toContain(TARO);
  });

  test('名簿が届く前は候補が無い', () => {
    const { result } = render(FILE, null);
    expect(result.current).toEqual([]);
  });

  test('別の File の名簿は候補にしない', async () => {
    const { result, rerender } = render(FILE, { fileId: FILE, dids: [HANAKO] });
    await waitFor(() => expect(result.current).toHaveLength(1));

    // File を替えた直後、新しい File の名簿はまだ届いていない
    rerender({
      fileId: OTHER,
      participating: { fileId: FILE, dids: [HANAKO] },
    });
    expect(result.current).toEqual([]);
  });
});
