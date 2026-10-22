//The application of the end-to-end test in k3s, one image for three roles: the signaling (ROLE=signaling, a
//Deployment), a TURN server (ROLE=turn, a DaemonSet on the network of the node) or a media server (ROLE=sfu, a
//DaemonSet on the network of the node, with a signaling of its own but no entrypoint: the members join through the
//signaling, which gives them a media server of the cluster), the nodes of one cluster on NATS. The signaling also
//answers GET on port 8080 with its rooms and the nodes of the cluster, for the client of the test.
import {createServer} from 'node:http'
import {Application} from 'lakutata'
import {buildEntrypoints} from 'lakutata/com/entrypoint'
import {socketIOServiceEntrypoint} from 'lakutata/adapter/socket.io'
import {buildClusterOptions, buildSFUOptions, buildSignalingOptions, buildTURNServerOptions, SignalingController} from '@lakutata/webrtc'

const cluster = buildClusterOptions({
    transport: {type: 'nats', servers: process.env.NATS_URL},
    nodeId: process.env.POD_NAME,
    labels: {node: process.env.NODE_NAME ?? ''}
})
const roles = {
    turn: {
        cluster: cluster,
        turn: buildTURNServerOptions({
            cluster: 'cluster',
            publicAddress: process.env.PUBLIC_ADDRESS,
            secret: process.env.TURN_SECRET,
            relayPortRange: [49160, 49200]
        })
    },
    //The rooms sfu-*, one member at most on each node (the members of a room on two nodes are forwarded between
    //them), in two worker threads
    sfu: {
        cluster: cluster,
        signaling: buildSignalingOptions({cluster: 'cluster', turnSecret: process.env.TURN_SECRET}),
        sfu: buildSFUOptions({
            cluster: 'cluster',
            serves: (room) => room.startsWith('sfu-'),
            maxMembers: 1,
            workers: 2,
            icePortRange: [40000, 40099]
        })
    }
}
const components = roles[process.env.ROLE] ?? {
    cluster: cluster,
    signaling: buildSignalingOptions({cluster: 'cluster', turnSecret: process.env.TURN_SECRET}),
    entrypoint: buildEntrypoints({
        controllers: [SignalingController],
        service: socketIOServiceEntrypoint({port: 3000})
    })
}

Application
    .run(() => ({
        id: 'webrtc-e2e.app',
        name: 'WebRTCE2E',
        components: components,
        bootstrap: Object.keys(components)
    }))
    .onLaunched(async (app) => {
        if (process.env.ROLE !== 'signaling') return
        const signaling = await app.getObject('signaling')
        const nodes = await app.getObject('cluster')
        createServer((request, response) => {
            response.setHeader('Content-Type', 'application/json')
            response.end(JSON.stringify({rooms: signaling.rooms(), nodes: nodes.nodes()}))
        }).listen(8080)
    })
