export interface HexOptions {
    /**
     * hex decoded representation must be byte aligned.
     * @default false
     */
    byteAligned?: boolean;
    /**
     * controls whether the prefix `0x` or `0X` is allowed (or required) on hex strings.
     * When `true`, the prefix must be provided.
     * When `false`, the prefix is forbidden.
     * When `optional`, the prefix is allowed but not required.
     *
     * @default false
     */
    prefix?: boolean | 'optional';
}
