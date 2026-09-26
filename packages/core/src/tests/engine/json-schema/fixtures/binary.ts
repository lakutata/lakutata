/**
 * Ported from joi-to-json 5.0.0 fixtures-baseline/binary.js (MIT, see THIRD_PARTY_NOTICES.md)
 * The schemas whose descriptions are the baseline of the parser tests. Not type-checked.
 */
// @ts-nocheck
export default function (engine) {
    return {
        encoding: engine.binary().encoding('base64'),
        length: engine.binary().length(64),
        minMax: engine.binary().min(64).max(128)
    }
}
