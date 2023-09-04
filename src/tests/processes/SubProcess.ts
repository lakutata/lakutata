import {Configurable, Process} from '../../Lakutata'

export class SubProcess extends Process {

    @Configurable()
    public text: string

    public echoText() {
        this.log.info('Echo text: %s', this.text)
    }
}
