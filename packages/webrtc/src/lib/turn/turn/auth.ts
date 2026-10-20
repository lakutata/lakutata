import {createHash} from 'node:crypto'

export function makeTurnIntegrityKey(
    username: string,
    realm: string,
    password: string
) {
    return createHash('md5')
        .update(Buffer.from([username, realm, password].join(':')))
        .digest()
}
