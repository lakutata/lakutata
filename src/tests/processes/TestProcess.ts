import {Process} from '../../lib/base/Process'

export class TestProcess extends Process {

    public async sayHi() {
        return 'say HI!'
    }
}
