import {AnySchema} from './AnySchema.js'
import {Base64Options} from './Base64Options.js'
import {DataUriOptions} from './DataUriOptions.js'
import {Reference} from './Reference.js'
import {DomainOptions} from './DomainOptions.js'
import {EmailOptions} from './EmailOptions.js'
import {GuidOptions} from './GuidOptions.js'
import {HexOptions} from './HexOptions.js'
import {IpOptions} from './IpOptions.js'
import {UriOptions} from './UriOptions.js'
import {StringRegexOptions} from './StringRegexOptions.js'

/**
 * A schema of strings, built by `DTO.String()` (and `DTO.Glob()`, `DTO.Cron()`, `DTO.HttpDocument()`): length,
 * patterns, formats (email, URI, UUID…) and case.
 *
 * The empty string is rejected unless allowed (`allow('')`). The rules changing the string (`trim()`, `lowercase()`,
 * `uppercase()`, `case()`, `normalize()`, `replace()`, `truncate()`) only change it with conversion enabled
 * (`strict(false)`): the schemas built by `DTO` are strict, so these rules only check the string.
 * @typeParam TSchema The type of the strings the schema validates.
 */
export interface StringSchema<TSchema = string> extends AnySchema<TSchema> {
    /**
     * Require the string to only contain the characters a-z, A-Z and 0-9.
     * @returns A new schema.
     */
    alphanum(): this

    /**
     * Require the string to be valid base64; the decoded value is not checked.
     * @param options `paddingRequired`: whether the `=` padding is required (default true); `urlSafe`: whether the
     * URL-safe alphabet (`-` and `_`) is used instead of `+` and `/` (default false).
     * @returns A new schema.
     */
    base64(options?: Base64Options): this

    /**
     * Require the string to be all upper case or all lower case; with conversion enabled (`strict(false)`), it is
     * converted instead.
     * @param direction The case required.
     * @returns A new schema.
     */
    case(direction: 'upper' | 'lower'): this

    /**
     * Require the string to be a credit card number (digits passing the Luhn checksum).
     * @returns A new schema.
     */
    creditCard(): this

    /**
     * Require the string to be a data URI (`data:<media type>;base64,<data>`).
     * @param options `paddingRequired`: whether the base64 data requires its `=` padding (default true).
     * @returns A new schema.
     */
    dataUri(options?: DataUriOptions): this

    /**
     * Require the string to be a domain name, like `example.com`.
     * @param options The domain rules: `minDomainSegments` (default 2), `maxDomainSegments`, `tlds` (the allowed and
     * denied top-level domains, the IANA list by default; false allows any), `allowFullyQualified` (a trailing `.`,
     * default false), `allowUnicode` (default true).
     * @returns A new schema.
     */
    domain(options?: DomainOptions): this

    /**
     * Require the string to be an email address. Its domain must have at least 2 segments and, by default, a top-level
     * domain of the IANA list.
     * @param options The address rules: `multiple` (a list of addresses split by `separator`, default `,`), `tlds`
     * (the allowed and denied top-level domains; false allows any), `minDomainSegments`, `maxDomainSegments`,
     * `allowUnicode` (default true), `ignoreLength`, `allowFullyQualified`.
     * @returns A new schema.
     */
    email(options?: EmailOptions): this

    /**
     * Require the string to be valid in a JSON Schema format, checked like the full formats of ajv-formats.
     * @param name The format: `date`, `time`, `date-time`, `duration`, `email`, `idn-email`, `hostname`, `ipv4`,
     * `ipv6`, `uri`, `uri-reference`, `uri-template`, `uuid`, `regex`, `json-pointer`, `relative-json-pointer` or
     * `byte` (base64).
     * @returns A new schema.
     * @throws {SchemaDefinitionException} When the format is not one of these.
     */
    format(name: string): this

    /**
     * Require the string to be a GUID (a UUID), optionally wrapped in `{}`, `()` or `[]`.
     * @param options `version`: the UUID versions allowed (`'uuidv4'`, or a list), any by default; `separator`: the
     * separator required between the groups (`-` or `:`), true for either, false for none; optional by default.
     * @returns A new schema.
     */
    guid(options?: GuidOptions): this

    /**
     * Require the string to be hexadecimal.
     * @param options `byteAligned`: whether the length must be even (default false); `prefix`: whether the `0x`
     * prefix is required (true), forbidden (false, the default) or allowed (`'optional'`).
     * @returns A new schema.
     */
    hex(options?: HexOptions): this

    /**
     * Require the string to be a host name (RFC 1123), or an IP address.
     * @returns A new schema.
     */
    hostname(): this

    /**
     * Compare the string with the values of `valid()`, `allow()` and `invalid()` case-insensitively.
     * @returns A new schema.
     */
    insensitive(): this

    /**
     * Require the string to be an IP address.
     * @param options `version`: the versions allowed (`'ipv4'`, `'ipv6'`, `'ipvfuture'`, or a list), all by default;
     * `cidr`: whether a CIDR suffix (`/24`) is `optional` (the default), `required` or `forbidden`.
     * @returns A new schema.
     */
    ip(options?: IpOptions): this

    /**
     * Require the string to be an ISO 8601 date (`2024-01-31`, `2024-01-31T12:00:00Z`); with conversion enabled
     * (`strict(false)`), it is converted to the full ISO format (`2024-01-31T00:00:00.000Z`).
     * @returns A new schema.
     */
    isoDate(): this

    /**
     * Require the string to be an ISO 8601 duration, like `P1DT2H`.
     * @returns A new schema.
     */
    isoDuration(): this

    /**
     * Require an exact length.
     * @param limit The length, in characters (UTF-16 code units), or a reference to another value holding it.
     * @param encoding An encoding (`'utf8'`): the length is then counted in bytes in that encoding.
     * @returns A new schema.
     */
    length(limit: number | Reference, encoding?: string): this

    /**
     * Require the string to be all lower case; with conversion enabled (`strict(false)`), it is converted instead.
     * @returns A new schema.
     */
    lowercase(): this

    /**
     * Require a maximum length (see `truncate()` to cut longer strings instead).
     * @param limit The maximum length (inclusive), in characters (UTF-16 code units), or a reference to another value
     * holding it.
     * @param encoding An encoding (`'utf8'`): the length is then counted in bytes in that encoding.
     * @returns A new schema.
     */
    max(limit: number | Reference, encoding?: string): this

    /**
     * Require a minimum length.
     * @param limit The minimum length (inclusive), in characters (UTF-16 code units), or a reference to another value
     * holding it.
     * @param encoding An encoding (`'utf8'`): the length is then counted in bytes in that encoding.
     * @returns A new schema.
     */
    min(limit: number | Reference, encoding?: string): this

    /**
     * Require the string to be in a Unicode normalization form; with conversion enabled (`strict(false)`), it is
     * normalized instead.
     * @param form The normalization form. Defaults to `NFC`.
     * @returns A new schema.
     */
    normalize(form?: 'NFC' | 'NFD' | 'NFKC' | 'NFKD'): this

    /**
     * Require the string to match a regular expression.
     * @param pattern The regular expression (its `g` and `y` flags are not allowed).
     * @param options The name of the pattern in the error messages, or an object: `name`, and `invert` (true: the
     * string must not match; default false).
     * @returns A new schema.
     */
    pattern(pattern: RegExp, options?: string | StringRegexOptions): this

    /**
     * Require the string to match a regular expression (an alias of `pattern()`).
     * @param pattern The regular expression (its `g` and `y` flags are not allowed).
     * @param options The name of the pattern in the error messages, or an object: `name`, and `invert` (true: the
     * string must not match; default false).
     * @returns A new schema.
     */
    regex(pattern: RegExp, options?: string | StringRegexOptions): this

    /**
     * Replace the parts of the string matching a pattern, before the other rules; only with conversion enabled
     * (`strict(false)`), otherwise the rule does nothing.
     * @param pattern A regular expression (add its `g` flag to replace every match), or a string whose occurrences are
     * all replaced.
     * @param replacement The replacement, which may use the groups of a regular expression (`$1`).
     * @returns A new schema.
     */
    replace(pattern: RegExp | string, replacement: string): this

    /**
     * Require the string to only contain the characters a-z, A-Z, 0-9 and `_`.
     * @returns A new schema.
     */
    token(): this

    /**
     * Require the string to have no leading or trailing whitespace; with conversion enabled (`strict(false)`), it is
     * trimmed instead.
     * @param enabled Whether the rule applies: a falsy value removes it. Defaults to true.
     * @returns A new schema.
     */
    trim(enabled?: any): this

    /**
     * Cut the strings longer than the `max()` limit to it, instead of rejecting them; only with conversion enabled
     * (`strict(false)`).
     * @param enabled Whether to truncate: false restores the rejection. Defaults to true.
     * @returns A new schema.
     */
    truncate(enabled?: boolean): this

    /**
     * Require the string to be all upper case; with conversion enabled (`strict(false)`), it is converted instead.
     * @returns A new schema.
     */
    uppercase(): this

    /**
     * Require the string to be a URI (RFC 3986), absolute by default.
     * @param options `scheme`: the schemes allowed (`'https'`, a regular expression, or a list), any by default;
     * `allowRelative`: whether relative URIs are allowed too (default false); `relativeOnly`: whether only relative
     * URIs are (default false); `allowQuerySquareBrackets` (default false); `domain`: the rules of the host name, as in
     * `domain()`.
     * @returns A new schema.
     */
    uri(options?: UriOptions): this

    /**
     * Require the string to be a UUID (an alias of `guid()`).
     * @param options `version`: the UUID versions allowed (`'uuidv4'`, or a list), any by default; `separator`: the
     * separator required between the groups (`-` or `:`), true for either, false for none; optional by default.
     * @returns A new schema.
     */
    uuid(options?: GuidOptions): this
}
