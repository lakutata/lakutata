export interface CompileOptions {
    /**
     * If true and the provided schema is (or contains parts) using an older version of the validation engine, will
     * return a compiled schema that is compatible with the older version.
     * If false, the schema is always compiled using the current version and if older schema components are found, an
     * error is thrown.
     */
    legacy: boolean
}
