import type {Address, Transport} from '../imports/common.js'

export class TransportContext {
    constructor(public socket: Transport) {}

    readonly send = (buf: Buffer, addr?: Address) => {
        return this.socket.send(buf, addr)
    }
}
