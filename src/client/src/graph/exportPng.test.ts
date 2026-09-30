import { describe, expect, it } from 'bun:test';
import { pngFileName } from './exportPng';

describe('pngFileName', () => {
  it('<File 名> - <Sheet 名>.png にする', () => {
    expect(pngFileName('議事録', 'Sheet 1')).toBe('議事録 - Sheet 1.png');
  });

  it('ファイル名に使えない文字は _ に置き換える', () => {
    expect(pngFileName('a/b\\c', 'd:e*f?g"h<i>j|k')).toBe(
      'a_b_c - d_e_f_g_h_i_j_k.png',
    );
  });
});
