import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { assert, isNil, isString } from '../../../util/index.js'

/* eslint-disable*/

const WHITESPACE_CHARS = [
  0x0000, // '\0' Null character
  0x0020, // ' ', Space
  0x0009, // '\t' Horizontal tab
  0x000a, // '\n' Line feed/new line
  0x000b, // '\v' Vertical tab
  0x000c, // '\f' Form feed
  0x000d, // '\r' Carriage return
  0x00a0, // Non-breaking space
  0x1680, // Ogham space mark
  0x2000, // En quad
  0x2001, // Em quad
  0x2002, // En space
  0x2003, // Em space
  0x2004, // Three-per-em space
  0x2005, // Four-per-em space
  0x2006, // Six-per-em space
  0x2007, // Figure space
  0x2008, // Punctuation space
  0x2009, // Thin space
  0x200a // Hair space
];

/** Trims the resolved string */
export function trimString(
  obj: AnyObject,
  expr: Any,
  options: Options,
  trimOpts: { left: boolean; right: boolean }
): string | null {
  const val = evalExpr(obj, expr, options) as {
    input: string;
    chars: string;
  };
  const s = val.input;
  if (isNil(s)) return null;

  const codepoints = isNil(val.chars)
    ? WHITESPACE_CHARS
    : (val.chars as string).split("").map((c: string) => c.codePointAt(0));

  let i = 0;
  let j = s.length - 1;

  while (
    trimOpts.left &&
    i <= j &&
    codepoints.indexOf(s[i].codePointAt(0)) !== -1
  )
    i++;
  while (
    trimOpts.right &&
    i <= j &&
    codepoints.indexOf(s[j].codePointAt(0)) !== -1
  )
    j--;

  return s.substring(i, j + 1);
}

export function regexSearch(
  obj: AnyObject,
  expr: Any,
  options: Options,
  reOpts: { global: boolean }
): Any[] | undefined {
  const val = evalExpr(obj, expr, options) as {
    input: string;
    regex: string;
    options: string;
  };

  if (!isString(val.input)) return [];

  const regexOptions = val.options;

  if (regexOptions) {
    assert(
      regexOptions.indexOf("x") === -1,
      "extended capability option 'x' not supported"
    );
    assert(regexOptions.indexOf("g") === -1, "global option 'g' not supported");
  }

  let input = val.input;
  const re = new RegExp(val.regex, regexOptions);

  let m: RegExpMatchArray | null;
  const matches = new Array<Any>();
  let offset = 0;
  while ((m = re.exec(input))) {
    const result: {
      match: string;
      idx: number;
      captures: Array<string | null>;
    } = {
      match: m[0],
      idx: (m.index as number) + offset,
      captures: []
    };
    for (let i = 1; i < m.length; i++) result.captures.push(m[i] || null);
    matches.push(result);
    if (!reOpts.global) break;

    offset = (m.index as number) + m[0].length;
    input = input.substring(offset);
  }

  return matches;
}

/*eslint-enable*/
