import {DomainOptions} from './DomainOptions.js'

export interface UriOptions {
    /**
     * Specifies one or more acceptable Schemes, should only include the scheme name.
     * Can be an Array or String (strings are automatically escaped for use in a Regular Expression).
     */
    scheme?: string | RegExp | Array<string | RegExp>;
    /**
     * Allow relative URIs.
     *
     * @default false
     */
    allowRelative?: boolean;
    /**
     * Restrict only relative URIs.
     *
     * @default false
     */
    relativeOnly?: boolean;
    /**
     * Allows unencoded square brackets inside the query string.
     * This is NOT RFC 3986 compliant but query strings like abc[]=123&abc[]=456 are very common these days.
     *
     * @default false
     */
    allowQuerySquareBrackets?: boolean;
    /**
     * Validate the domain component using the options specified in `string.domain()`.
     */
    domain?: DomainOptions;
}
