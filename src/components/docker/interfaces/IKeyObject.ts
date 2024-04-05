/**
 * Docker connection key object
 */
export interface IKeyObject {
    pem: string | Buffer;
    passphrase?: string | undefined;
}
