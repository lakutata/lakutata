/**
 * The progress of a blob transfer (a layer, a configuration, a manifest) during a pull or a push, given to a
 * {@link ContainerdProgressCallback}.
 */
export type ContainerdProgress = {
    /**
     * The digest of the blob (`'sha256:…'`).
     */
    digest: string
    /**
     * Its media type (`'application/vnd.oci.image.layer.v1.tar+gzip'`).
     */
    mediaType: string
    /**
     * The bytes transferred so far.
     */
    current: number
    /**
     * The size of the blob in bytes; `current` equals it once it is transferred.
     */
    total: number
}

/**
 * Receive the progress of a pull ({@link ImagePullOptions.progressCallback}) or a push
 * ({@link ImagePushOptions.progressCallback}). A pull calls it as each blob's bytes arrive, and once with `current`
 * equal to `total` for a blob the content store has already; a push calls it once per blob, after its upload, with
 * `current` equal to `total`.
 */
export type ContainerdProgressCallback = (progress: ContainerdProgress) => void
