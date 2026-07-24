//Self-contained HTML tag list (replaces the `html-tags` package dependency).
const HTML_TAGS: readonly string[] = ['a','abbr','address','area','article','aside','audio','b','base','bdi','bdo','blockquote','body','br','button','canvas','caption','cite','code','col','colgroup','data','datalist','dd','del','details','dfn','dialog','div','dl','dt','em','embed','fieldset','figcaption','figure','footer','form','h1','h2','h3','h4','h5','h6','head','header','hgroup','hr','html','i','iframe','img','input','ins','kbd','label','legend','li','link','main','map','mark','math','menu','meta','meter','nav','noscript','object','ol','optgroup','option','output','p','picture','pre','progress','q','rp','rt','ruby','s','samp','script','search','section','select','selectedcontent','slot','small','source','span','strong','style','sub','summary','sup','svg','table','tbody','td','template','textarea','tfoot','th','thead','time','title','tr','track','u','ul','var','video','wbr']

const basic: RegExp = /\s?<!doctype html>|(<html\b[^>]*>|<body\b[^>]*>|<x-[^>]+>)+/i
const full: RegExp = new RegExp(HTML_TAGS.map((tag: string) => `<${tag}\\b[^>]*>`).join('|'), 'i')

/**
 * Whether string is html
 * @param string
 * @constructor
 */
export function IsHtml(string: string): boolean {
    string = string.trim().slice(0, 1000)
    return basic.test(string) || full.test(string)
}
