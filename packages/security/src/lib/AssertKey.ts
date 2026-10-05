/**
 * Refuse an empty key: HMAC and HKDF accept it, but data signed or encrypted with it is open to anyone
 * @param key
 */
export function assertKey(key: string | Uint8Array): void {
    if (key.length === 0) throw new RangeError('The key is empty')
}
