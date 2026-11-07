#ifndef LAKUTATA_SERIAL_SESSION_H
#define LAKUTATA_SERIAL_SESSION_H

#include <cstdint>
#include <deque>
#include <vector>
#include "Port.h"

namespace serial {

    /**
     * The device of a port, for the session: the calls that run on the thread of the port
     */
    class Device {
    public:
        virtual ~Device() = default;

        virtual void configure(const LineOptions &options) = 0;

        virtual void flush(bool input, bool output) = 0;

        virtual void signals(Event &event) = 0;

        virtual void setSignals(int dtr, int rts, int brk) = 0;

        /**
         * The bytes waiting in the output queue of the system (0 when it cannot tell)
         */
        virtual long queued() = 0;
    };

    /**
     * The commands of a port on its thread, the same on every platform: the ordered ones (writes, drains,
     * configurations) one after the other, the others at once; a write or a drain fails when the output stops moving
     * for longer than allowed; a drain ends once the queue of the system is empty and the bytes it cannot see (in the
     * driver or the chip, at most `allowance`) had the time to go out at the speed of the line
     */
    class Session {
    public:
        Session(Port &port, Device &device, size_t allowance);

        /**
         * Take the commands queued by JavaScript
         */
        void process();

        bool reading() const;

        /**
         * The bytes the current write still has to send (nullptr when no write is due)
         */
        const uint8_t *pending(size_t &length) const;

        void wrote(size_t count);

        void received(const uint8_t *data, size_t length);

        /**
         * The device failed for good (gone): the requests waiting fail, the port waits for its closing
         */
        void fatal(const Failure &failure);

        bool dead() const;

        /**
         * How long the thread may wait for its device before the session needs it again (-1: until something happens)
         */
        int timeout() const;

        /**
         * The checks of time: the drains, the stalls, the limits
         */
        void tick();

        /**
         * A closing was asked and nothing has to be sent first
         */
        bool finished() const;

        bool discard() const;

        void closed();

    private:
        struct Ordered {
            Command command;
            size_t offset = 0;
        };

        void handle(Command &command);

        void advance();

        void result(uint32_t id);

        void fail(uint32_t id, const Failure &failure);

        void cancelOrdered(const Failure &failure);

        int64_t tailMs() const;

        /**
         * How long the output may stop while the head runs (0: no limit)
         */
        int64_t stallOfHead() const;

        Port &port;
        Device &device;
        size_t allowance;
        LineOptions options;
        std::deque<Ordered> ordered;
        std::vector<uint32_t> closeIds;
        bool wantRead = false;
        bool closing = false;
        bool discarding = false;
        bool isDead = false;
        Failure deadFailure;
        //The last time the output moved, the queue of the system then, the end of the wait for the bytes it cannot see
        int64_t lastProgress = 0;
        long lastQueued = -1;
        int64_t tailEnd = 0;
        //The bytes written since the output was last known to be empty
        size_t sinceIdle = 0;
        //The ordered command at the head, whose clock runs
        bool headSet = false;
        uint32_t headId = 0;
    };

    int64_t steadyMs();

    Failure cancelledFailure();
}

#endif
