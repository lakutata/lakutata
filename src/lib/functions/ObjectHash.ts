import hash from 'object-hash'

type HashName =
    | 'md4'
    | 'md4WithRSAEncryption'
    | 'md5'
    | 'md5WithRSAEncryption'
    | 'ripemd'
    | 'ripemd160'
    | 'ripemd160WithRSA'
    | 'rmd160'
    | 'rsa-md4'
    | 'rsa-md5'
    | 'rsa-ripemd160'
    | 'rsa-sha1'
    | 'rsa-sha1-2'
    | 'rsa-sha224'
    | 'rsa-sha256'
    | 'rsa-sha3-224'
    | 'rsa-sha3-256'
    | 'rsa-sha3-384'
    | 'rsa-sha3-512'
    | 'rsa-sha384'
    | 'rsa-sha512'
    | 'sha1'
    | 'sha1WithRSAEncryption'
    | 'sha224'
    | 'sha224WithRSAEncryption'
    | 'sha256'
    | 'sha256WithRSAEncryption'
    | 'sha3-224'
    | 'sha3-256'
    | 'sha3-384'
    | 'sha3-512'
    | 'sha384'
    | 'sha384WithRSAEncryption'
    | 'sha512'
    | 'sha512WithRSAEncryption';

export type ObjectHashOptions = {
    /**
     * @default 'hex'
     */
    encoding?: 'hex' | 'binary' | 'base64' | undefined
    /**
     * @default 'sha1'
     */
    algorithm?: HashName | 'passthrough' | undefined;

    excludeKeys?: ((key: string) => boolean) | undefined;
    /**
     * @default false
     */
    excludeValues?: boolean | undefined;
    /**
     * @default false
     */
    ignoreUnknown?: boolean | undefined;

    replacer?: ((value: any) => any) | undefined;
    /**
     * @default true
     */
    respectFunctionNames?: boolean | undefined;
    /**
     * @default true
     */
    respectFunctionProperties?: boolean | undefined;
    /**
     * @default true
     */
    respectType?: boolean | undefined;
    /**
     * @default false
     */
    unorderedArrays?: boolean | undefined;
    /**
     * @default true
     */
    unorderedObjects?: boolean | undefined;
    /**
     * @default true
     */
    unorderedSets?: boolean | undefined;
}

/**
 * Generate an object hash
 * @param value
 * @param options
 * @constructor
 */
export function ObjectHash(value: any, options?: ObjectHashOptions): string {
    return hash(value, options)
}
