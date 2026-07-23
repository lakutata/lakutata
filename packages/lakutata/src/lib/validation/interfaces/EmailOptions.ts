import {TopLevelDomainOptions} from './TopLevelDomainOptions.js'

export interface EmailOptions {
    /**
     * if `true`, domains ending with a `.` character are permitted
     *
     * @default false
     */
    allowFullyQualified?: boolean;
    /**
     * If `true`, Unicode characters are permitted
     *
     * @default true
     */
    allowUnicode?: boolean;
    /**
     * if `true`, ignore invalid email length errors.
     *
     * @default false
     */
    ignoreLength?: boolean;
    /**
     * if true, allows multiple email addresses in a single string, separated by , or the separator characters.
     *
     * @default false
     */
    multiple?: boolean;
    /**
     * when multiple is true, overrides the default , separator. String can be a single character or multiple separator characters.
     *
     * @default ','
     */
    separator?: string | string[];
    /**
     * Options for TLD (top level domain) validation. By default, the TLD must be a valid name listed on the [IANA registry](http://data.iana.org/TLD/tlds-alpha-by-domain.txt)
     *
     * @default { allow: true }
     */
    tlds?: TopLevelDomainOptions | false;
    /**
     * Number of segments required for the domain. Be careful since some domains, such as `io`, directly allow email.
     *
     * @default 2
     */
    minDomainSegments?: number;
    /**
     * The maximum number of domain segments (e.g. `x.y.z` has 3 segments) allowed. Defaults to no limit.
     *
     * @default Infinity
     */
    maxDomainSegments?: number;
}
