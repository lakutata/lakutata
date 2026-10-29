//A client of test-env/linux/listen.sh: sends a datagram to host:8081 (from eth0, broadcasts and multicast allowed) and
//prints the answer, or "no answer" after 2 seconds
import {createSocket} from 'node:dgram'
import {isIP} from 'node:net'

const [host, text] = process.argv.slice(2)
const socket = createSocket(isIP(host) === 6 ? 'udp6' : 'udp4')
socket.bind(0, () => {
    if (isIP(host) === 4) socket.setBroadcast(true)
    if (isIP(host) === 6) socket.setMulticastInterface('::%eth0')
    const timer = setTimeout(() => {
        console.log('no answer')
        socket.close()
    }, 2000)
    socket.once('message', message => {
        clearTimeout(timer)
        console.log(String(message))
        socket.close()
    })
    socket.send(text, 8081, host)
})
