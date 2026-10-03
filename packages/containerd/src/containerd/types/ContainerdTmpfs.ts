export type ContainerdTmpfs = {
    containerPath: string
    /**
     * Its size in bytes
     */
    size?: number
    /**
     * Its mode (1777)
     */
    mode?: string
}
