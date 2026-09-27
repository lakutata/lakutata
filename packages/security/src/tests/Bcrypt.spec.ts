/**
 * Ported from the upstream tests/index.js (see UPSTREAM.md; BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 * Adapted: the callbacks are promises; the compatibility tests compare with fixed hashes (the OpenBSD test vectors,
 * and hashes of the upstream implementation, which upstream checks against the native implementation) instead of the
 * native bcrypt package; the UMD build test is dropped (there is no UMD build).
 */
import {describe, it} from 'node:test'
import assert from 'node:assert'
import * as bcrypt from '../lib/bcrypt/index.js'

//Hashes of the passwords of the upstream compatibility test, with a fixed salt
const COMPATIBILITY_HASHES: [string, string][] = [
    ['', '$2b$06$abcdefghijklmnopqrstuuDqVCX9YSxXQXEJE1On1Ptib/W28qLxG'],
    [' ', '$2b$06$abcdefghijklmnopqrstuuYjRfX8gARztloBeXlwm3RvLKlxuM0u2'],
    [' a ', '$2b$06$abcdefghijklmnopqrstuu1m8Y8avr/utz7kk2BqI1ptJwbpLQtIu'],
    ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '$2b$06$abcdefghijklmnopqrstuuIBuNj.FHUDJuljpq724SoPkEleOzHW2'],
    ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '$2b$06$abcdefghijklmnopqrstuuIBuNj.FHUDJuljpq724SoPkEleOzHW2'],
    ['Heizölrückstoßabdämpfung', '$2b$06$abcdefghijklmnopqrstuu5QOH1tmjbNVG5wu4vqwFaVIxrG5mioq'],
    ['Ξεσκεπάζω τὴν ψυχοφθόρα βδελυγμία', '$2b$06$abcdefghijklmnopqrstuuh86CJoJhEImx/bZ4DsKz1xHsJm/7tfu'],
    ['El pingüino Wenceslao hizo kilómetros bajo exhaustiva lluvia y ', '$2b$06$abcdefghijklmnopqrstuu7EMSEMHVR3xCNe3vtZ4ARY0eCrtKtE6'],
    ['Où l\'obèse jury mûr', '$2b$06$abcdefghijklmnopqrstuuPkGjmWWKDKFYLdE6INyjYOV7L8b/5Hm'],
    ['Úrmhac na hÓighe Beannaithe', '$2b$06$abcdefghijklmnopqrstuu21JuV.uHCa2gu6XmBbfarlq/2nOBZeO'],
    ['Árvíztűrő tükörfúrógép', '$2b$06$abcdefghijklmnopqrstuuQL04VX1OIfxcH/FkA0F47hCtns9Lr8K'],
    ['Sævör grét áðan því úlpan var ónýt', '$2b$06$abcdefghijklmnopqrstuushetT7NZ9gQUjfj8PX3ed3IoezTGYWO'],
    ['わかよたれそつねならむ', '$2b$06$abcdefghijklmnopqrstuuCy6gJJaV7oKuTbyNVnSIFMLBHUL/Y4K'],
    ['ケフコエテ アサキユメミシ', '$2b$06$abcdefghijklmnopqrstuuBH7QufE.2g.YR3I6clWW9jpYdcx6gCO'],
    ['דג סקרן שט בים מאוכזב ולפתע מצא לו חברה איך הקליטה', '$2b$06$abcdefghijklmnopqrstuucJ1crl54GuVgGs.R3p/uo4NP9kiUDOy'],
    ['Pchnąć w tę łódź jeża lub ośm skrzyń fig', '$2b$06$abcdefghijklmnopqrstuu7NMzXOqTzpZXC5E1psjh4UfKYtwIxim'],
    ['В чащах юга жил бы цитрус? Да, но фальшивый экземпляр!', '$2b$06$abcdefghijklmnopqrstuu2BZ8WR2s/p9mUIiL3hvZQTaPQ115jY6'],
    ['๏ เป็นมนุษย์สุดประเสริฐเลิศคุณค่า', '$2b$06$abcdefghijklmnopqrstuuFO/w07ITiSTaDH5Hm/jXTHMpuQfsqn.'],
    ['Pijamalı hasta, yağız şoföre çabucak güvendi.', '$2b$06$abcdefghijklmnopqrstuuqhkAqyQsCizfkB51Yn4.6FlygU2BneS']
]

//The OpenBSD test vectors
const OPENBSD_VECTORS: [string, string][] = [
    ['', '$2a$06$DCq7YPn5Rq63x1Lad4cll.TV4S6ytwfsfvkgY8jIucDrjc8deX1s.'],
    ['a', '$2a$06$m0CrhHm10qJ3lXRY.5zDGO3rS2KdeeWLuGmsfGlMfOxih58VYVfxe'],
    ['abc', '$2a$06$If6bvum7DFjUnE9p2uDeDu0YHzrHM6tf.iqN8.yx.jNN1ILEf7h0i'],
    ['abcdefghijklmnopqrstuvwxyz', '$2a$06$.rCVZVOThsIa97pEDOxvGuRRgzG64bvtJ0938xuqzv18d3ZpQhstC'],
    ['~!@#$%^&*()      ~!@#$%^&*()PNBFRD', '$2a$06$fPIsBO8qRqkjj273rfaOI.HtSV9jLDpTbZn782DC6/t7qT67P6FfO']
]

describe('bcrypt', (): void => {

    it('encodeBase64', (): void => {
        const str: string = bcrypt.encodeBase64([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10], 16)
        assert.strictEqual(str, '..CA.uOD/eaGAOmJB.yMBu')
    })

    it('decodeBase64', (): void => {
        const bytes: number[] = bcrypt.decodeBase64('..CA.uOD/eaGAOmJB.yMBv.', 16)
        assert.deepEqual(bytes, [0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f])
    })

    it('genSaltSync', (): void => {
        const salt: string = bcrypt.genSaltSync(10)
        assert(salt)
        assert(typeof salt === 'string')
        assert(salt.length > 0)
    })

    it('genSalt', async (): Promise<void> => {
        const salt: string = await bcrypt.genSalt(10)
        assert(salt)
        assert(typeof salt === 'string')
        assert(salt.length > 0)
    })

    it('hashSync', (): void => {
        assert.doesNotThrow((): void => {
            bcrypt.hashSync('hello', 10)
        })
        assert.notEqual(bcrypt.hashSync('hello', 10), bcrypt.hashSync('hello', 10))
    })

    it('hash', async (): Promise<void> => {
        const hash: string = await bcrypt.hash('hello', 10)
        assert(hash)
    })

    it('compareSync', (): void => {
        const salt1: string = bcrypt.genSaltSync()
        const hash1: string = bcrypt.hashSync('hello', salt1) //$2b$
        const salt2: string = bcrypt.genSaltSync().replace(/\$2b\$/, '$2y$')
        const hash2: string = bcrypt.hashSync('world', salt2)
        const salt3: string = bcrypt.genSaltSync().replace(/\$2b\$/, '$2a$')
        const hash3: string = bcrypt.hashSync('hello world', salt3)

        assert.strictEqual(hash1.substring(0, 4), '$2b$')
        assert(bcrypt.compareSync('hello', hash1))
        assert(!bcrypt.compareSync('hello', hash2))
        assert(!bcrypt.compareSync('hello', hash3))

        assert.strictEqual(hash2.substring(0, 4), '$2y$')
        assert(bcrypt.compareSync('world', hash2))
        assert(!bcrypt.compareSync('world', hash1))
        assert(!bcrypt.compareSync('world', hash3))

        assert.strictEqual(hash3.substring(0, 4), '$2a$')
        assert(bcrypt.compareSync('hello world', hash3))
        assert(!bcrypt.compareSync('hello world', hash1))
        assert(!bcrypt.compareSync('hello world', hash2))
    })

    it('compare', async (): Promise<void> => {
        const salt1: string = bcrypt.genSaltSync()
        const hash1: string = bcrypt.hashSync('hello', salt1) //$2a$
        let salt2: string = bcrypt.genSaltSync()
        salt2 = salt2.substring(0, 2) + 'y' + salt2.substring(3) //$2y$
        const hash2: string = bcrypt.hashSync('world', salt2)
        assert(await bcrypt.compare('hello', hash1))
        assert(!(await bcrypt.compare('hello', hash2)))
        assert(await bcrypt.compare('world', hash2))
        assert(!(await bcrypt.compare('world', hash1)))
    })

    it('getSalt', (): void => {
        const hash1: string = bcrypt.hashSync('hello', bcrypt.genSaltSync())
        const salt: string = bcrypt.getSalt(hash1)
        const hash2: string = bcrypt.hashSync('hello', salt)
        assert.equal(hash1, hash2)
    })

    it('getRounds', (): void => {
        const hash1: string = bcrypt.hashSync('hello', bcrypt.genSaltSync())
        assert.equal(bcrypt.getRounds(hash1), 10)
    })

    it('truncates', (): void => {
        assert(!bcrypt.truncates(''))
        assert(!bcrypt.truncates('a'.repeat(72)))
        assert(bcrypt.truncates('a'.repeat(73)))
        assert(bcrypt.truncates('๏ เป็นมนุษย์สุดประเสริฐเลิศคุณค่า'))
    })

    it('progress', async (): Promise<void> => {
        const salt: string = await bcrypt.genSalt(12)
        const progress: number[] = []
        const hash: string = await bcrypt.hash('hello world', salt, (n: number): void => {
            progress.push(n)
        })
        assert(typeof hash === 'string')
        assert(progress.length >= 2)
        assert.strictEqual(progress[0], 0)
        assert.strictEqual(progress[progress.length - 1], 1)
    })

    it('promise', async (): Promise<void> => {
        const salt: string = await bcrypt.genSalt(10)
        const hash: string = await bcrypt.hash('hello', salt)
        assert(hash)
        assert(await bcrypt.compare('hello', hash))
        assert(await bcrypt.genSalt(/* no args */))
    })

    it('compat_hash', (): void => {
        for (const [password, hash] of [...COMPATIBILITY_HASHES, ...OPENBSD_VECTORS]) {
            assert.equal(bcrypt.hashSync(password, hash.substring(0, 29)), hash, password)
            assert(bcrypt.compareSync(password, hash))
        }
    })

    it('compat_rounds', (): void => {
        //$10$ like not set
        assert.strictEqual(bcrypt.genSaltSync(0).substring(0, 7), '$2b$10$')
        //$04$ is lower cap
        assert.strictEqual(bcrypt.genSaltSync(3).substring(0, 7), '$2b$04$')
        //$31$ is upper cap
        assert.strictEqual(bcrypt.genSaltSync(32).substring(0, 7), '$2b$31$')
    })

    it('rejects illegal arguments (added, not in upstream)', async (): Promise<void> => {
        assert.throws((): unknown => bcrypt.hashSync('hello', '$3$10$abcdefghijklmnopqrstuu'), /Invalid salt version/)
        await assert.rejects(bcrypt.hash('hello', '$2c$10$abcdefghijklmnopqrstuu'), /Invalid salt revision/)
        await assert.rejects(bcrypt.hash('hello', '$2b$03$abcdefghijklmnopqrstuu'), /Illegal number of rounds/)
        assert.strictEqual(await bcrypt.compare('hello', 'not a hash'), false)
        assert.throws((): unknown => bcrypt.getSalt('short'), /Illegal hash length/)
    })
})
