import htmlTags from 'html-tags'

const basic = /\s?<!doctype html>|(<html\b[^>]*>|<body\b[^>]*>|<x-[^>]+>)+/i
const full = new RegExp(htmlTags.map(tag => `<${tag}\\b[^>]*>`).join('|'), 'i')

/**
 * Whether string is html
 * @param string
 * @constructor
 */
export function IsHtml(string: string): boolean {
    string = string.trim().slice(0, 1000)
    return basic.test(string) || full.test(string)
}
