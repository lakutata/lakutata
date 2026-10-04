/**
 * An image reference split into its repository and its tag, as {@link ParseRepositoryTag} returns it.
 */
export type RepositoryTag = {
    /**
     * The repository, with its registry when the reference has one (`alpine`,
     * `registry.example.com:5000/team/app`).
     */
    repo: string
    /**
     * The tag (`3.20`), or the digest when the reference has one (`sha256:…` for `alpine@sha256:…`); absent when the
     * reference has neither.
     */
    tag?: string
}
