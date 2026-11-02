import {describe, it} from 'node:test'
import assert from 'node:assert'
import {Component, Container} from '@lakutata/core'
import {Inject} from '@lakutata/core/decorator/di'
import {
    Barcode,
    BarcodeCancelledException,
    BarcodeTimeoutException,
    buildBarcodeOptions,
    type RawImage
} from '../exports/Barcode.js'

/**
 * Noise to read: a read of it lasts long enough to be cancelled (about 100 ms)
 */
const NOISE: RawImage = ((): RawImage => {
    const size: number = 3000
    let seed: number = 1
    const data: Uint8Array = Uint8Array.from({length: size * size}, (): number => (seed = (seed * 1103515245 + 12345) % 2147483648) % 256)
    return {data: data, width: size, height: size, channels: 1}
})()

class Labels extends Component {
    @Inject(Barcode)
    public readonly barcode: Barcode
}

describe('The barcode component', (): void => {

    it('is injected without being registered', async (): Promise<void> => {
        const container: Container = new Container()
        try {
            await container.set(Labels)
            const labels: Labels = await container.get(Labels)
            assert.ok(labels.barcode instanceof Barcode)
            assert.strictEqual((await labels.barcode.read(await labels.barcode.generate('QRCode', 'injected')))[0].text, 'injected')
        } finally {
            await container.destroy()
        }
    })

    it('takes its defaults from its options, the ones of a call first', async (): Promise<void> => {
        const container: Container = new Container()
        try {
            const {class: type, ...options} = buildBarcodeOptions({defaults: {generate: {output: 'raw', scale: 2, quietZone: false}, read: {formats: ['EAN13']}}})
            await container.setNamed('labels', type, options)
            const labels: Barcode = await container.get<Barcode>('labels')
            const qr = await labels.generate('QRCode', 'lakutata') as unknown as RawImage
            assert.strictEqual(qr.width, 42)
            assert.strictEqual((await labels.generate('QRCode', 'lakutata', {output: 'raw', scale: 3})).width, 63)
            //Its read looks for EAN-13 only
            assert.deepStrictEqual(await labels.read(qr), [])
            assert.strictEqual((await labels.read(qr, {formats: ['QRCode']}))[0].text, 'lakutata')
        } finally {
            await container.destroy()
        }
    })

    it('fails an operation past its time limit, the one of the call or the one of the component', async (): Promise<void> => {
        const container: Container = new Container()
        try {
            await container.setNamed('slow', Barcode, {timeout: 5})
            const slow: Barcode = await container.get<Barcode>('slow')
            await assert.rejects(slow.read(NOISE), BarcodeTimeoutException)
            assert.deepStrictEqual(await slow.read(NOISE, {timeout: 0}), [])
            const barcode: Barcode = await container.get(Barcode)
            await assert.rejects(barcode.read(NOISE, {timeout: 5}), BarcodeTimeoutException)
        } finally {
            await container.destroy()
        }
    })

    it('cancels an operation by its signal, before it starts and while it runs', async (): Promise<void> => {
        const container: Container = new Container()
        try {
            const barcode: Barcode = await container.get(Barcode)
            await assert.rejects(barcode.read(NOISE, {signal: AbortSignal.abort()}), BarcodeCancelledException)
            const controller: AbortController = new AbortController()
            const reading: Promise<unknown> = barcode.read(NOISE, {signal: controller.signal})
            setTimeout((): void => controller.abort(), 5)
            const started: number = Date.now()
            await assert.rejects(reading, BarcodeCancelledException)
            assert.ok(Date.now() - started < 80, 'rejected at once, not when the read ended')
        } finally {
            await container.destroy()
        }
    })

    it('runs as many operations at once as its concurrency, the others waiting, cancelled and timed out in their wait', async (): Promise<void> => {
        const container: Container = new Container()
        try {
            await container.setNamed('single', Barcode, {concurrency: 1})
            const single: Barcode = await container.get<Barcode>('single')
            const first: Promise<unknown> = single.read(NOISE)
            const controller: AbortController = new AbortController()
            const cancelled: Promise<unknown> = single.read(NOISE, {signal: controller.signal})
            const timedOut: Promise<unknown> = single.read(NOISE, {timeout: 10})
            const last: Promise<unknown> = single.read(NOISE)
            controller.abort()
            await assert.rejects(cancelled, BarcodeCancelledException)
            await assert.rejects(timedOut, BarcodeTimeoutException)
            assert.deepStrictEqual(await first, [])
            assert.deepStrictEqual(await last, [])
        } finally {
            await container.destroy()
        }
    })

    it('waits for its operations running when it is destroyed, then refuses the new ones', async (): Promise<void> => {
        const container: Container = new Container()
        const barcode: Barcode = await container.get(Barcode)
        const reading: Promise<unknown> = barcode.read(NOISE)
        await container.destroy()
        assert.deepStrictEqual(await reading, [])
        await assert.rejects(barcode.generate('QRCode', 'late'), BarcodeCancelledException)
    })

    it('refuses the arguments of the wrong types', async (): Promise<void> => {
        const container: Container = new Container()
        try {
            const barcode: Barcode = await container.get(Barcode)
            const refused = async (run: () => Promise<unknown>): Promise<void> => {
                await assert.rejects(run, (error: unknown): boolean => (error as {errno?: string}).errno === 'E_INVALID_METHOD_ACCEPT')
            }
            await refused(() => barcode.generate('Nope' as 'QRCode', 'x'))
            await refused(() => barcode.generate('QRCode', 42 as unknown as string))
            await refused(() => barcode.generate('QRCode', 'x', {foreground: 'red'}))
            await refused(() => barcode.generate('QRCode', 'x', {scale: 0}))
            await refused(() => barcode.generate('EAN13', '590123412345', {addOn: '123'}))
            await refused(() => barcode.read({data: new Uint8Array(4), width: 2, height: 2, channels: 2 as 1}))
            await refused(() => barcode.read(new Uint8Array(4), {formats: ['Nope' as 'QRCode']}))
        } finally {
            await container.destroy()
        }
    })
})
