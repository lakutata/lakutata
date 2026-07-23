export interface StringRegexOptions {
    /**
     * optional pattern name.
     */
    name?: string;

    /**
     * when true, the provided pattern will be disallowed instead of required.
     *
     * @default false
     */
    invert?: boolean;
}
