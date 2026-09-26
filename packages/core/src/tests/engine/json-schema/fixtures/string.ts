/**
 * Ported from joi-to-json 5.0.0 fixtures-baseline/string.js (MIT, see THIRD_PARTY_NOTICES.md)
 * The schemas whose descriptions are the baseline of the parser tests. Not type-checked.
 */
// @ts-nocheck
export default function (engine) {
    return {
        alphanum: engine.string().alphanum(),
        case_lower: engine.string().case('lower'),
        case_upper: engine.string().case('upper'),
        email: engine.string().email(),
        guid: engine.string().guid({ version: ['uuidv2', 'uuidv4'] }),
        hostname: engine.string().hostname().insensitive(),
        ip: engine.string().ip({ version: ['ipv4', 'ipv6'] }),
        isoDate: engine.string().isoDate(),
        isoDuration: engine.string().isoDuration(),
        lowercase: engine.string().lowercase(),
        minMax: engine.string().min(3).max(20),
        regex: engine.string().regex(/^[a-z]+$/, { name: 'alpha', invert: true }),
        uppercase: engine.string().uppercase(),
        uri: engine.string().uri(),
        uuid: engine.string().uuid({ version: ['uuidv3', 'uuidv5'] })
    }
}
