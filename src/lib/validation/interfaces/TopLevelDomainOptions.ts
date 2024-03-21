export interface TopLevelDomainOptions {
    /**
     * - `true` to use the IANA list of registered TLDs. This is the default value.
     * - `false` to allow any TLD not listed in the `deny` list, if present.
     * - A `Set` or array of the allowed TLDs. Cannot be used together with `deny`.
     */
    allow?: Set<string> | string[] | boolean;
    /**
     * - A `Set` or array of the forbidden TLDs. Cannot be used together with a custom `allow` list.
     */
    deny?: Set<string> | string[];
}
