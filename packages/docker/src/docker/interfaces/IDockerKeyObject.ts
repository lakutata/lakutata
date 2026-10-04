/**
 * A private key of the HTTPS connections to the daemon, with its passphrase (the `key` option of {@link Docker}).
 */
export interface IDockerKeyObject {
    /**
     * The private key: its PEM contents, not its file path.
     */
    pem: string | Buffer
    /**
     * The passphrase decrypting the key.
     * @default undefined (an unencrypted key)
     */
    passphrase?: string | undefined
}
