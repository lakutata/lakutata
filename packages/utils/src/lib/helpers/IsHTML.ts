//Self-contained HTML tag list (replaces the `html-tags` package dependency).
const HTML_TAGS: readonly string[] = ['a','abbr','address','area','article','aside','audio','b','base','bdi','bdo','blockquote','body','br','button','canvas','caption','cite','code','col','colgroup','data','datalist','dd','del','details','dfn','dialog','div','dl','dt','em','embed','fieldset','figcaption','figure','footer','form','h1','h2','h3','h4','h5','h6','head','header','hgroup','hr','html','i','iframe','img','input','ins','kbd','label','legend','li','link','main','map','mark','math','menu','meta','meter','nav','noscript','object','ol','optgroup','option','output','p','picture','pre','progress','q','rp','rt','ruby','s','samp','script','search','section','select','selectedcontent','slot','small','source','span','strong','style','sub','summary','sup','svg','table','tbody','td','template','textarea','tfoot','th','thead','time','title','tr','track','u','ul','var','video','wbr']

const basic: RegExp = /\s?<!doctype html>|(<html\b[^>]*>|<body\b[^>]*>|<x-[^>]+>)+/i
const full: RegExp = new RegExp(HTML_TAGS.map((tag: string) => `<${tag}\\b[^>]*>`).join('|'), 'i')

/**
 * Tell whether a string looks like HTML: whether its first 1000 characters (after its leading and trailing spaces are
 * trimmed) contain a `<!doctype html>`, or an opening tag of a standard HTML element (`<p>`, `<div class="a">`) or of a
 * custom element named `x-…`. The markup is not validated (`'<p>'` alone is HTML, `'<foo>bar</foo>'` is not), and a tag
 * anywhere in the head counts (`'text <b>bold</b>'` is HTML).
 * @param value The string to test; a value which is not a string (`undefined`, a number) gives `false`.
 * @returns `true` when an HTML tag is found, `false` otherwise.
 * @example
 * ```typescript
 * import {isHTML} from 'lakutata/utils'
 *
 * console.log(isHTML('<!doctype html><html></html>'), isHTML('<p>Hello</p>'))
 * //true true
 * console.log(isHTML('<note>Hello</note>'), isHTML('1 < 2'))
 * //false false
 * ```
 */
export function isHTML(value: string): boolean {
    if (typeof value !== 'string') return false
    const head: string = value.trim().slice(0, 1000)
    return basic.test(head) || full.test(head)
}
