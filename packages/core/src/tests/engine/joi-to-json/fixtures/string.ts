/**
 * Ported from joi-to-json 5.0.0 fixtures-baseline/string.js (MIT, see THIRD_PARTY_NOTICES.md)
 * The schemas whose descriptions are the baseline of the parser tests. Not type-checked.
 */
// @ts-nocheck
export default function (joi) {
    return {
        alphanum: joi.string().alphanum(),
        case_lower: joi.string().case('lower'),
        case_upper: joi.string().case('upper'),
        email: joi.string().email(),
        guid: joi.string().guid({ version: ['uuidv2', 'uuidv4'] }),
        hostname: joi.string().hostname().insensitive(),
        ip: joi.string().ip({ version: ['ipv4', 'ipv6'] }),
        isoDate: joi.string().isoDate(),
        isoDuration: joi.string().isoDuration(),
        lowercase: joi.string().lowercase(),
        minMax: joi.string().min(3).max(20),
        regex: joi.string().regex(/^[a-z]+$/, { name: 'alpha', invert: true }),
        uppercase: joi.string().uppercase(),
        uri: joi.string().uri(),
        uuid: joi.string().uuid({ version: ['uuidv3', 'uuidv5'] })
    }
}
