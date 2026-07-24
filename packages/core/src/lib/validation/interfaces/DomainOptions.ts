import {TopLevelDomainOptions} from './TopLevelDomainOptions.js'

export interface DomainOptions {
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
     * Options for TLD (top level domain) validation. By default, the TLD must be a valid name listed on the [IANA registry](http://data.iana.org/TLD/tlds-alpha-by-domain.txt)
     *
     * @default { allow: true }
     */
    tlds?: TopLevelDomainOptions | false;
    /**
     * Number of segments required for the domain.
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
