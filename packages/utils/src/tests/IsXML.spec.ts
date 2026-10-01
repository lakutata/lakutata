import {describe, it} from 'node:test'
import assert from 'node:assert'
import {XMLValidator} from 'fast-xml-parser'
import {IsXML} from '../exports/Helpers.js'

/**
 * The validation of the upstream (fast-xml-parser 4.5.3), the reference of the port
 * @param xml
 */
function Upstream(xml: string): boolean {
    return XMLValidator.validate(xml, {allowBooleanAttributes: true}) === true
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

describe('IsXML', (): void => {

    it('accepts the well formed XML documents', (): void => {
        for (const xml of [
            '<a/>',
            '<a><b>x</b></a>',
            '<?xml version="1.0" encoding="UTF-8"?>\n<note lang="en"><to>Tove</to><body>a &amp; b &#65; &#x41;</body></note>',
            '<a checked x=\'1\'><![CDATA[<not a tag>]]><!-- comment --></a>',
            '<!DOCTYPE note [<!ELEMENT note (#PCDATA)>]><note>x</note>',
            '﻿<a/>'
        ]) assert.strictEqual(IsXML(xml), true, xml)
    })

    it('rejects the strings which are not well formed XML documents', (): void => {
        for (const xml of [
            '', 'not xml at all', '{"json": true}', '<a><b></a>', '<a>', '</a>', '<a></a><b></b>', '<a></a>text',
            '<a x="1"y="2"/>', '<a x=/>', '<a x="1" x="2"/>', '<1a/>', '<a>&;</a>', '<a>&#xZ;</a>', '<a x="1/>',
            '      <?xml version="1.0"?><a/>'
        ]) assert.strictEqual(IsXML(xml), false, xml)
        assert.strictEqual(IsXML(undefined as unknown as string), false)
    })

    it('validates as the upstream validator', (): void => {
        const random: () => number = Random(20261001)
        let valid: number = 0
        for (let run: number = 0; run < 20000; run++) {
            const length: number = 1 + Math.floor(random() * 12)
            let xml: string = ''
            for (let piece: number = 0; piece < length; piece++) xml += PIECES[Math.floor(random() * PIECES.length)]
            const expected: boolean = Upstream(xml)
            if (expected) valid++
            assert.strictEqual(IsXML(xml), expected, JSON.stringify(xml))
        }
        //The generated documents are valid and invalid
        assert.ok(valid > 100, `${valid} valid documents`)
    })
})
