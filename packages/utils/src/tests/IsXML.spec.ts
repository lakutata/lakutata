import {describe, it} from 'node:test'
import assert from 'node:assert'
import {XMLValidator} from 'fast-xml-parser'
import {isXML} from '../exports/Utils.js'

/**
 * The validation of the upstream (fast-xml-parser 4.5.3), the reference of the port
 * @param xml
 */
function Upstream(xml: string): boolean {
    return XMLValidator.validate(xml, {allowBooleanAttributes: true}) === true
}

/**
 * The validation with the bugs of the upstream fixed, from the upstream:
 * - it accepts a text or an element after a self closing root element (<a/>text): the reference is the upstream on the
 *   document with its self closing tags written as an opening and a closing tag, which it validates correctly
 * - it detects an XML declaration out of the start of the document before the first element only: the reference
 *   rejects the XML declarations after it
 * @param xml
 */
function Reference(xml: string): boolean {
    if (/<\?xml[ ?]/.test(xml.substring(xml.indexOf('<', xml.indexOf('<') + 1)))) return false
    return Upstream(xml.replace(/<([^\s<>/!?"'=]+)((?:\s(?:[^<>"']|"[^"]*"|'[^']*')*?)?)\/>/g, '<$1$2></$1>'))
}

/**
 * A pseudo random generator with a seed (mulberry32), so the generated documents are the same on every run
 * @param seed
 */
function Random(seed: number): () => number {
    return (): number => {
        seed = (seed + 0x6D2B79F5) | 0
        let t: number = Math.imul(seed ^ (seed >>> 15), 1 | seed)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

/**
 * The pieces of the generated documents
 */
const PIECES: string[] = [
    '<a>', '</a>', '<b>', '</b>', '<a/>', '<b />', '<c x="1">', '<c x=\'1\' y>', '</c>', '<d x="1"y="2">', '<e x=>',
    '<f x="1" x="2">', '<1a>', '< a>', '</a x>', '<g a="<>">', '<h a="\'">', '<!-- comment -->', '<!-- -- -->',
    '<![CDATA[ <a> & ]]>', '<!DOCTYPE note [<!ENTITY e "v">]>', '<?pi data?>', '<?xml version="1.0"?>', '&amp;', '&#65;',
    '&#x41;', '&#xZ;', '&;', '&unknown', 'text', ' ', '\n', '\t', '"', '\'', '>', '<', '/', '=', '﻿', 'é', '<é>', '</é>'
]

describe('isXML', (): void => {

    it('accepts the well formed XML documents', (): void => {
        for (const xml of [
            '<a/>',
            '<a><b>x</b></a>',
            '<?xml version="1.0" encoding="UTF-8"?>\n<note lang="en"><to>Tove</to><body>a &amp; b &#65; &#x41;</body></note>',
            '<a checked x=\'1\'><![CDATA[<not a tag>]]><!-- comment --></a>',
            '<!DOCTYPE note [<!ELEMENT note (#PCDATA)>]><note>x</note>',
            '﻿<a/>',
            '<a><?xml-stylesheet href="style.css"?><?pi data?></a>'
        ]) assert.strictEqual(isXML(xml), true, xml)
    })

    it('rejects the strings which are not well formed XML documents', (): void => {
        for (const xml of [
            '', 'not xml at all', '{"json": true}', '<a><b></a>', '<a>', '</a>', '<a></a><b></b>', '<a></a>text',
            '<a x="1"y="2"/>', '<a x=/>', '<a x="1" x="2"/>', '<1a/>', '<a>&;</a>', '<a>&#xZ;</a>', '<a x="1/>',
            '<a/>text', '<a/><b/>', '<a x="1"/><b></b>', '<a><?xml version="1.0"?></a>', '<a></a><?xml version="1.0"?>',
            '      <?xml version="1.0"?><a/>'
        ]) assert.strictEqual(isXML(xml), false, xml)
        assert.strictEqual(isXML(undefined as unknown as string), false)
    })

    it('validates as the upstream validator, with its bugs fixed', (): void => {
        const random: () => number = Random(20261001)
        let valid: number = 0
        //The documents the fix changes: the upstream accepts them
        let fixed: number = 0
        for (let run: number = 0; run < 20000; run++) {
            const length: number = 1 + Math.floor(random() * 12)
            let xml: string = ''
            for (let piece: number = 0; piece < length; piece++) xml += PIECES[Math.floor(random() * PIECES.length)]
            const expected: boolean = Reference(xml)
            if (expected) valid++
            if (expected !== Upstream(xml)) fixed++
            assert.strictEqual(isXML(xml), expected, JSON.stringify(xml))
        }
        //The generated documents are valid and invalid
        assert.ok(valid > 100, `${valid} valid documents`)
        assert.ok(fixed > 0, `${fixed} documents changed by the fix`)
    })
})
