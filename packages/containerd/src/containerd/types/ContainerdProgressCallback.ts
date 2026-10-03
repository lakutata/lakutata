/**
 * The progress of the transfer of a blob (a layer, a configuration)
 */
export type ContainerdProgress = {
    digest: string
    mediaType: string
    current: number
    total: number
}

export type ContainerdProgressCallback = (progress: ContainerdProgress) => void
