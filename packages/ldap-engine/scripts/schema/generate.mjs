//Generate the LDIF of the bundled schema (scripts/schema/source/, which scripts/schema/documents.mjs turns into the
//documents of src/lib/schema/bundled/) from the texts of the RFCs that define it; openssh-lpk.ldif and extensions.ldif
//are written by hand.
//
//   node scripts/schema/generate.mjs <directory of rfcNNNN.txt files> [output directory]
//
//The texts come from https://www.rfc-editor.org/rfc/rfcNNNN.txt and are not kept in the repository. Each definition is
//written on one line, after a comment naming its RFC and section; the definitions of an OID already written by an
//earlier module are left out (RFC 2798 repeats those of RFC 4519 and RFC 4524). The names an RFC registers with IANA
//for the OID of a definition are added after its own ('commonName' after 'cn'), as the comment says.
import {readFileSync, writeFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'

const directory = process.argv[2]
if (!directory) {
    console.error('usage: node scripts/schema/generate.mjs <directory of rfcNNNN.txt files>')
    process.exit(1)
}
const output = process.argv[3] ?? join(dirname(fileURLToPath(import.meta.url)), 'source')

//The modules, in order: a definition belongs to the first module whose RFCs define it
const MODULES = [
    {
        name: 'system',
        description: 'The operational attributes and the object classes of the directory itself: RFC 4512 (the models), RFC 3045 (vendorName, vendorVersion), RFC 4530 (entryUUID), RFC 5020 (entryDN), RFC 3296 (referrals), RFC 3672 (subentries)',
        rfcs: [4512, 3045, 4530, 5020, 3296, 3672],
        //name and cn of RFC 4519, which subentry requires and the subschema subentry the engine gives holds: the system
        //schema is whole by itself
        borrow: {rfc: 4519, oids: ['2.5.4.41', '2.5.4.3']}
    },
    {
        name: 'core',
        description: 'The schema for user applications: RFC 4519, the certificates of RFC 4523, labeledURI of RFC 2079',
        rfcs: [4519, 4523, 2079]
    },
    {
        name: 'cosine',
        description: 'The COSINE schema: RFC 4524',
        rfcs: [4524]
    },
    {
        name: 'inetorgperson',
        description: 'The inetOrgPerson object class: RFC 2798',
        rfcs: [2798]
    },
    {
        name: 'rfc2307bis',
        description: 'The accounts, groups and other entities of the name services (POSIX accounts, shadow, hosts, netgroups, automount): draft-howard-rfc2307bis-02, with authPassword of RFC 3112 that it refers to',
        rfcs: ['draft-howard-rfc2307bis-02', 3112]
    },
    {
        name: 'ppolicy',
        description: 'The password policy: draft-behera-ldap-password-policy-11',
        rfcs: ['draft-behera-ldap-password-policy-11']
    }
]

//The matching rules the RFCs define: built into the engine (as code, or as definitions)
const MATCHING_RULES = /^(2\.5\.13\.|1\.3\.6\.1\.1\.16\.[23]$|1\.3\.6\.1\.4\.1\.4203\.1\.2\.)/

//RFC 2079 writes its definitions as tables; these are the same definitions in the form of RFC 4512
const RFC2079 = [
    {section: 'Schema Definition of the labeledURI Attribute Type', text: '( 1.3.6.1.4.1.250.1.57 NAME \'labeledURI\' DESC \'Uniform Resource Identifier with optional label\' EQUALITY caseExactMatch SYNTAX 1.3.6.1.4.1.1466.115.121.1.15 )'},
    {section: 'Schema Definition of the labeledURIObject Object Class', text: '( 1.3.6.1.4.1.250.3.15 NAME \'labeledURIObject\' DESC \'object that contains the URI attribute type\' SUP top AUXILIARY MAY labeledURI )'}
]

//The amendments, each with its reason, written in the comment of the definition
const AMENDMENTS = {
    //RFC 2798 lists photo without a syntax, which RFC 4512 does not allow; RFC 1274 §9.3.7 gives G3 fax
    '0.9.2342.19200300.100.1.7': {
        text: '( 0.9.2342.19200300.100.1.7 NAME \'photo\' SYNTAX 1.3.6.1.4.1.1466.115.121.1.23 )',
        note: 'SYNTAX added: Fax (G3 fax, RFC 1274 §9.3.7)'
    }
}

/**
 * The lines of an RFC without its page breaks, headers and footers
 */
function pageLines(text) {
    return text.split('\n').filter((line) => !line.includes('\f') && !/^(RFC \d+|Internet-Draft)\s.*\d{4}\s*$/.test(line) && !/\[Page \d+\]\s*$/.test(line))
}

/**
 * The file of a source: an RFC by its number, a draft by its name
 */
function fileOf(source) {
    return join(directory, typeof source === 'number' ? `rfc${source}.txt` : `${source}.txt`)
}

/**
 * The name of a source in the comments
 */
function labelOf(source) {
    return typeof source === 'number' ? `RFC ${source}` : source
}

/**
 * The definitions of an RFC, each with the section it is in
 */
function definitionsOf(number) {
    if (number === 2079) return RFC2079.map((definition) => ({...definition, rfc: number}))
    const lines = pageLines(readFileSync(fileOf(number), 'utf8'))
    const definitions = []
    let section = ''
    let index = 0
    while (index < lines.length) {
        const line = lines[index]
        const heading = /^(\d+(?:\.\d+)*\.?)\s+(\S.*)$/.exec(line)
        if (heading) section = `§${heading[1].replace(/\.$/, '')} ${heading[2].trim()}`
        const start = /^\s*\(\s*\d+(?:\.\d+)+(\s|$)/.exec(line)
        if (!start) {
            index++
            continue
        }
        //Read to the parenthesis closing the definition, the quoted strings skipped; a definition still open when the
        //next one starts is closed (draft-howard-rfc2307bis-02 leaves out the parenthesis closing nisObject)
        let text = ''
        let depth = 0
        let quoted = false
        let done = false
        let closed = false
        while (index < lines.length && !done) {
            const current = lines[index].trim()
            if (text && depth > 0 && !quoted && /^\(\s*\d+(?:\.\d+)+(\s|$)/.test(current)) {
                text += ' )'.repeat(depth)
                closed = true
                break
            }
            for (let position = 0; position < current.length && !done; position++) {
                const character = current[position]
                text += character
                if (character === '\'') quoted = !quoted
                else if (!quoted && character === '(') depth++
                else if (!quoted && character === ')' && --depth === 0) done = true
            }
            text += ' '
            index++
        }
        text = text.replace(/\s+/g, ' ').replace(/\(\s+/g, '( ').replace(/\s+\)/g, ' )').trim()
        if (/\bNAME\b/.test(text)) definitions.push({rfc: number, section: section, text: text, ...closed ? {note: 'the closing parenthesis the text leaves out added'} : {}})
    }
    return definitions
}

/**
 * The names an RFC registers with IANA for its attribute types and object classes, by OID: the RFCs of the user
 * schema define 'cn' and register 'commonName' for the same OID, as X.500 calls it
 */
function registeredNames(number) {
    if (number === 2079) return new Map()
    const lines = pageLines(readFileSync(fileOf(number), 'utf8'))
    const start = lines.findIndex((line) => /^\d+(\.\d+)*\.?\s+IANA Considerations/.test(line))
    const names = new Map()
    if (start < 0) return names
    for (const line of lines.slice(start)) {
        //A* in RFC 4524: an X.500 name kept for the implementations recognizing it
        const row = /^\s+([A-Za-z][A-Za-z0-9-]*)\s+[AO]\*?\s+(\d+(?:\.\d+)+)\s*$/.exec(line)
        if (!row) continue
        if (!names.has(row[2])) names.set(row[2], [])
        names.get(row[2]).push(row[1])
    }
    return names
}

/**
 * A definition with the names registered for its OID added after its own
 */
function withRegisteredNames(text, registered) {
    const match = /\bNAME\s+(\(\s*((?:'[^']*'\s*)+)\)|'[^']*')/.exec(text)
    if (!match || !registered) return {text: text, added: []}
    const own = [...(match[2] ?? match[1]).matchAll(/'([^']*)'/g)].map((name) => name[1])
    const added = registered.filter((name) => !own.some((ownName) => ownName.toLowerCase() === name.toLowerCase()))
    if (!added.length) return {text: text, added: []}
    const names = [...own, ...added].map((name) => `'${name}'`).join(' ')
    return {text: text.slice(0, match.index) + `NAME ( ${names} )` + text.slice(match.index + match[0].length), added: added}
}

/**
 * Whether a definition is an object class (or an attribute type)
 */
function isObjectClass(text) {
    return /\b(STRUCTURAL|AUXILIARY|ABSTRACT|MUST|MAY)\b/.test(text)
}

const written = new Set()
for (const module of MODULES) {
    const entries = []
    const sources = [...module.rfcs.map((rfc) => ({rfc: rfc})), ...module.borrow ? [{rfc: module.borrow.rfc, only: module.borrow.oids}] : []]
    for (const {rfc, only} of sources) {
        const registered = registeredNames(rfc)
        const definitions = definitionsOf(rfc).filter((definition) => !only || only.includes(/^\(\s*([\d.]+)/.exec(definition.text)[1]))
        if (only) definitions.sort((first, second) => only.indexOf(/^\(\s*([\d.]+)/.exec(first.text)[1]) - only.indexOf(/^\(\s*([\d.]+)/.exec(second.text)[1]))
        for (const definition of definitions) {
            const oid = /^\(\s*([\d.]+)/.exec(definition.text)[1]
            if (MATCHING_RULES.test(oid) || written.has(oid)) continue
            written.add(oid)
            const amendment = AMENDMENTS[oid]
            const named = withRegisteredNames(amendment ? amendment.text : definition.text, registered.get(oid))
            const text = named.text
            const notes = [amendment?.note, definition.note, named.added.length ? `${named.added.map((name) => `'${name}'`).join(', ')} from the IANA registrations of ${labelOf(rfc)}` : undefined].filter(Boolean)
            const comment = `# ${labelOf(definition.rfc)}${definition.section ? ` ${definition.section}` : ''}${notes.length ? `; ${notes.join('; ')}` : ''}`
            entries.push({kind: isObjectClass(text) ? 'objectClasses' : 'attributeTypes', comment: comment, text: text})
        }
    }
    //The attribute types first: the object classes refer to them
    const ordered = [...entries.filter((entry) => entry.kind === 'attributeTypes'), ...entries.filter((entry) => entry.kind === 'objectClasses')]
    const ldif = [`# ${module.description}`, `dn: cn=${module.name},cn=schema`, `cn: ${module.name}`, 'objectClass: subschema', ...ordered.flatMap((entry) => [entry.comment, `${entry.kind}: ${entry.text}`])].join('\n')
    writeFileSync(join(output, `${module.name}.ldif`), ldif + '\n')
    console.log(`${module.name}: ${ordered.length} definitions`)
}
