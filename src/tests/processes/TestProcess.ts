import {Process} from '../../lib/base/Process'

export class TestProcess extends Process {

    public testProp: string

    public async sayHi() {
        return 'say HI!'
    }

    public nothing() {

    }
}
