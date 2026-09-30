/**
 * Docker connection key object
 */
export interface IDockerKeyObject {
    pem: string | Buffer;
    passphrase?: string | undefined;
}
