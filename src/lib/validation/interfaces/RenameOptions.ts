export interface RenameOptions {
    /**
     * if true, does not delete the old key name, keeping both the new and old keys in place.
     *
     * @default false
     */
    alias?: boolean;
    /**
     * if true, allows renaming multiple keys to the same destination where the last rename wins.
     *
     * @default false
     */
    multiple?: boolean;
    /**
     * if true, allows renaming a key over an existing key.
     *
     * @default false
     */
    override?: boolean;
    /**
     * if true, skip renaming of a key if it's undefined.
     *
     * @default false
     */
    ignoreUndefined?: boolean;
}
