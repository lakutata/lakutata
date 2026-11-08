//The hashes are test vectors of passlib 1.7.4 (passlib/tests/test_handlers*.py, BSD license), which takes many of them
//from John the Ripper and from the hashes of the systems themselves
import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {PasswordSchemes} from '../exports/LDAPEngine.js'
import {md5Crypt, shaCrypt} from '../lib/server/Crypt.js'
import {argon2Function} from '../lib/server/Passwords.js'

const schemes: PasswordSchemes = new PasswordSchemes({iterations: 1000})

const VECTORS: [string, string][] = [
    ['password', '{PBKDF2}1212$OB.dtnSEXZK8U5cgxU/GYQ$y5LKPOplRmok7CZp/aqVDVg8zGI'],
    ['password', '{PBKDF2-SHA256}1212$4vjV83LKPjQzk31VI4E0Vw$hsYF68OiOUPdDZ1Fg.fJPeq1h/gXXY7acBp9/6c.tmQ'],
    ['password', '{PBKDF2-SHA512}1212$RHY0Fr3IDMSVO/RSZyb5ow$eNLfBK.eVozomMr.1gYa17k9B7KIK25NOEshvhrSX.esqY3s.FvWZViXz4KoLlQI.BzY/YTNJOiKc5gBYFYGww'],
    ['helloworld', '{SHA}at+xg6SiyUovktq1redipHiJpaE='],
    ['testing1234', '{SMD5}UjFY34os/pnZQ3oQOzjqGu4yeXE='],
    ['test', '{SMD5}XRlncfRzvGi0FDzgR98tUgBg7B3jXOs9p9S615qTkg=='],
    ['testing123', '{SSHA}0c0blFTXXNuAMHECS4uxrj3ZieMoWImr'],
    ['secret', '{SSHA}0H+zTv8o4MR4H43n03eCsvw1luG8LdB7'],
    ['test', '{SSHA}P90+qijSp8MJ1tN25j5o1PflUvlqjXHOGeOckw=='],
    ['password', '{SSHA256}x1tymSTVjozxQ2PtT46ysrzhZxbcskK0o2f8hEFx7fAQQmhtDSEkJA=='],
    ['toomanysecrets', '{SSHA512}wExp4xjiCHS0zidJDC4UJq9EEeIebAQPJ1PWSwfhxWjfutI9XiiKuHm2AE41cEFfK+8HyI8bh+ztbczUGsvVFIgICWWPt7qu'],
    ['password', '{SSHA512}f/lFQskkl7PdMsTGJxHZq8LDt/l+UqRMm6/pj4pV7/xZkcOaKCgvQqp+KCeXc/Vd4RY6vEHWn4y0DnFcQ6wgyv9fyxk='],
    ['U*U*U*U*', '{CRYPT}$1$dXc3I7Rw$ctlgjDdWJLMT.qwHsWhXR1'],
    ['*U*U*U*U', '{CRYPT}$1$eQT9Hwbt$XtuElNJD.eW5MN5UCWyTQ0'],
    ['', '{CRYPT}$1$Eu.GHtia$CFkL/nE1BYTlEPiVx1VWX0'],
    ['U*U*U*U*', '{CRYPT}$5$LKO/Ute40T3FNF95$U0prpBQd4PloSGU0pnpM4z9wKn4vZ1.jsrzQfPqxph9'],
    ['', '{CRYPT}$5$rounds=10428$uy/jIAhCetNCTtb0$YWvUOXbkqlqhyoPMpN8BMe.ZGsGx2aBvxTvDFI613c3'],
    ['test', '{CRYPT}$5$rounds=11858$WH1ABM5sKhxbkgCK$aTQsjPkz0rBsH3lQlJxw9HDTDXPKBxC0LlVeV69P.t1'],
    ['U*U*U*U*', '{CRYPT}$6$LKO/Ute40T3FNF95$6S/6T2YuOIHY0N3XpLKABJ3soYcXD9mB7uVbtEZDj/LNscVhZoZ9DEH.sBciDrMsHOWOoASbNLTypH/5X26gN0'],
    ['test', '{CRYPT}$6$rounds=11531$G/gkPn17kHYo0gTF$Kq.uZBHlSBXyzsOJXtxJruOOH4yc0Is13uY7yK0PvAvXxbvc1w8DO1RzREMhKsc82K/Jh8OquV8FZUlreYPJk1'],
    ['U*U*U*U*', '{CRYPT}$2a$05$c92SVSfjeiCD6F2nAD6y0uBpJDjdRkt0EgeC4/31Rf2LUZbDRDE.O'],
    ['', '{CRYPT}$2a$05$Otz9agnajgrAe0.kFVF9V.tzaStZ2s1s4ZWi/LY4sw2k/MTVFj/IO']
]

describe('the password schemes', () => {
    it('verify the hashes of the other implementations, and refuse a wrong password', async () => {
        for (const [password, stored] of VECTORS) {
            assert.equal(await schemes.verify(stored, password), true, stored)
            assert.equal(await schemes.verify(stored, password + 'x'), false, stored)
        }
    })

    it('compute the crypts byte for byte', () => {
        assert.equal(md5Crypt(Buffer.from('U*U***U'), '$1$dXc3I7Rw$'), '$1$dXc3I7Rw$94JPyQc/eAgQ3MFMCoMF.0')
        assert.equal(shaCrypt(Buffer.from(' '), '$5$rounds=10376$I5lNtXtRmf.OoMd8$'), '$5$rounds=10376$I5lNtXtRmf.OoMd8$Ko3AI1VvTANdyKhBPavaRjJzNpSatKU6QVN9uwS9MH.')
        assert.equal(shaCrypt(Buffer.from(''), '$6$ojWH1AiTee9x1peC$'), '$6$ojWH1AiTee9x1peC$QVEnTvRVlPRhcLQCk/HnHaZmlGAAjCfrAN0FtOsOnUk5K5Bn/9eLHHiRzrTzaIKjW9NTLNIBUCtNVOowWS2mN.')
    })

    it('hash in PBKDF2-SHA512 with a fresh salt, and verify what they wrote', async () => {
        const first: string = await schemes.hash('pässwörd')
        const second: string = await schemes.hash('pässwörd')
        assert.match(first, /^\{PBKDF2-SHA512\}1000\$[A-Za-z0-9./]{22}\$[A-Za-z0-9./]{86}$/)
        assert.notEqual(first, second)
        assert.equal(await schemes.verify(first, 'pässwörd'), true)
        assert.equal(await schemes.verify(first, 'passwörd'), false)
        for (const scheme of ['SSHA', 'SSHA512', 'SHA256', 'PBKDF2-SHA256']) assert.equal(await schemes.verify(await schemes.hash('secret', scheme), 'secret'), true, scheme)
        await assert.rejects(schemes.hash('secret', 'CRYPT'), /cannot hash/)
    })

    it('compare a password in clear, and say what to hash again', async () => {
        assert.equal(await schemes.verify('secret', 'secret'), true)
        assert.equal(await schemes.verify('secret', 'secre'), false)
        assert.equal(await schemes.verify('{UNKNOWN}x', '{UNKNOWN}x'), true)
        assert.equal(schemes.isHashed('{ssha}abc'), true)
        assert.equal(schemes.isHashed('secret'), false)
        assert.deepEqual(['secret', '{SSHA}0H+zTv8o4MR4H43n03eCsvw1luG8LdB7', '{PBKDF2-SHA512}999$a$b', await schemes.hash('x')].map((value) => schemes.needsRehash(value)), [true, true, true, false])
        assert.equal(await schemes.verify('{PBKDF2-SHA512}abc', 'x'), false)
        assert.equal(await schemes.verify('{CRYPT}$9$x', 'x'), false)
    })

    it('verify argon2 where node:crypto has it', {skip: argon2Function() ? false : 'node:crypto has no argon2 here'}, async () => {
        //From the reference implementation of argon2 (argon2id, the test of its README)
        const stored: string = '{ARGON2}$argon2id$v=19$m=65536,t=2,p=1$c29tZXNhbHQ$CTFhFdXPJO1aFaMaO6Mm5c8y7cJHAph8ArZWb2GRPPc'
        assert.equal(await schemes.verify(stored, 'password'), true)
        assert.equal(await schemes.verify(stored, 'passw0rd'), false)
    })
})
