import {describe, it, expect} from '../support/vitest.js'
import {Event} from '../../../lib/common/event.js'

describe('Event', () => {
    it('calls the subscribers in their order, after many were unsubscribed', () => {
        const event = new Event<[number]>()
        const called: number[] = []
        const offs = Array.from({length: 100}, (_, index: number) => event.subscribe(() => void called.push(index)).unSubscribe)
        //Enough removed for the list to be compacted
        for (let index = 0; index < 100; index++) {
            if (index % 10 !== 0) offs[index]()
        }
        event.execute(1)
        expect(called).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90])
        expect(event.length).toBe(10)
    })

    it('skips a subscriber unsubscribed while the event is executed, and calls one subscribed meanwhile', () => {
        const event = new Event<[]>()
        const called: string[] = []
        const second: {unSubscribe?: () => void} = {}
        event.subscribe(() => {
            called.push('first')
            second.unSubscribe?.()
            event.subscribe(() => void called.push('added'))
        })
        second.unSubscribe = event.subscribe(() => void called.push('second')).unSubscribe
        event.execute()
        expect(called).toEqual(['first', 'added'])
    })

    it('tells the changes of its subscribers, an unsubscribe repeated once', () => {
        const event = new Event<[]>()
        const lengths: number[] = []
        event.onsubscriberschange = () => void lengths.push(event.length)
        const {unSubscribe} = event.subscribe(() => undefined)
        event.subscribe(() => undefined)
        unSubscribe()
        unSubscribe()
        event.allUnsubscribe()
        expect(lengths).toEqual([1, 2, 1, 0])
    })

    it('calls none of its subscribers once they are all unsubscribed while it is executed', () => {
        const event = new Event<[]>()
        const called: string[] = []
        event.subscribe(() => {
            called.push('first')
            event.allUnsubscribe()
        })
        event.subscribe(() => void called.push('second'))
        event.execute()
        event.execute()
        expect(called).toEqual(['first'])
    })

    it('runs its queued subscribers one after the other, without the ones unsubscribed', async () => {
        const event = new Event<[number]>()
        const called: number[] = []
        const first = event.queuingSubscribe(async (value: number) => void called.push(value))
        event.queuingSubscribe(async (value: number) => void called.push(value * 10))
        event.execute(1)
        await new Promise((resolve) => setImmediate(resolve))
        first.unSubscribe()
        event.execute(2)
        await new Promise((resolve) => setImmediate(resolve))
        expect(called).toEqual([1, 10, 20])
    })
})
