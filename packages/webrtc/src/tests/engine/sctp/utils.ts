import {readFixture} from '../support/fixture.js'

export function load(name: string) {
    return readFixture('sctp/data/' + name)
}
