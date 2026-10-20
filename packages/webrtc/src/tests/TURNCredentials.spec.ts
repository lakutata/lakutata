import {describe, it} from 'node:test'
import assert from 'node:assert'
import {createHmac} from 'node:crypto'
import {createTURNCredentials, turnPasswordIfValid} from '../turn/TURNCredentials.js'

describe('TURN credentials', (): void => {

    it('are the ones of the REST API of coturn: <expiry>:<user>, HMAC-SHA1 of the secret', (): void => {
        const now: number = 1_700_000_000_000
        const credentials = createTURNCredentials('secret', 'alice', 3600, now)
        assert.strictEqual(credentials.username, '1700003600:alice')
        assert.strictEqual(credentials.credential, createHmac('sha1', 'secret').update('1700003600:alice').digest('base64'))
        assert.strictEqual(credentials.ttl, 3600)
        //A colon of the user would break the username
        assert.strictEqual(createTURNCredentials('secret', 'a:b', 60, now).username, '1700000060:a_b')
    })

    it('are accepted until they expire, with the secret only', (): void => {
        const now: number = 1_700_000_000_000
        const {username, credential} = createTURNCredentials('secret', 'alice', 60, now)
        assert.strictEqual(turnPasswordIfValid('secret', username, now + 59_000), credential)
        assert.strictEqual(turnPasswordIfValid('secret', username, now + 61_000), undefined)
        assert.notStrictEqual(turnPasswordIfValid('other', username, now), credential)
        assert.strictEqual(turnPasswordIfValid('secret', 'alice', now), undefined)
        assert.strictEqual(turnPasswordIfValid('secret', 'soon:alice', now), undefined)
    })
})
