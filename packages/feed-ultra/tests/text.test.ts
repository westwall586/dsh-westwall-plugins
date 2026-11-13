import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CJK_RATIO_THRESHOLD, clampText, isChinese } from '../src/translate/text.ts';

test('a Han-majority description is Chinese; a mixed one is not', () => {
  assert.equal(isChinese('这是一个中文简介，介绍一个股票分析工具。'), true);
  assert.equal(
    isChinese(
      '股票分析工具 stock analysis for A-share, Hong Kong and US markets. '.repeat(4),
    ),
    false,
  );
  assert.equal(CJK_RATIO_THRESHOLD, 0.5);
});

test('text without letters is never Chinese', () => {
  assert.equal(isChinese(''), false);
  assert.equal(isChinese('123 !!! 😀 https://example.com'), false);
});

test('clamping never splits a surrogate pair', () => {
  assert.equal(clampText('abc', 5), 'abc');
  assert.equal(clampText('abcdef', 3), 'abc');
  const clamped = clampText('😀😀😀', 2);
  assert.equal([...clamped].length, 2);
  assert.equal(clamped.length, 4);
});
