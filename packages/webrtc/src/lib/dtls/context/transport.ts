import type {Address, Transport} from '../imports/common.js'

export class TransportContext {
    //Aborted when the DTLS socket closes: the flights being sent again stop
    readonly closing = new AbortController()

    constructor(public socket: Transport) {}

    readonly send = (buf: Buffer, addr?: Address) => {
        return this.socket.send(buf, addr)
    }

    close() {
        this.closing.abort()
    }
}
