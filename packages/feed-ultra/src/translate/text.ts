const HAN = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/u;
const LETTER = /\p{L}/u;

/**
 * A description is "already Chinese" only when Han characters are the clear
 * majority of its letters. Mixed rows still get translated so the English half
 * becomes readable; the fixture's 0.22 row is the calibration case.
 */
export const CJK_RATIO_THRESHOLD = 0.5;

export function isChinese(description: string): boolean {
  let han = 0;
  let letters = 0;
  for (const char of description) {
    if (!LETTER.test(char)) continue;
    letters += 1;
    if (HAN.test(char)) han += 1;
  }
  return letters > 0 && han / letters > CJK_RATIO_THRESHOLD;
}

/** Cut by code points so a surrogate pair cannot be split into an invalid string. */
export function clampText(text: string, max: number): string {
  const chars = [...text];
  return chars.length <= max ? text : chars.slice(0, max).join('');
}
