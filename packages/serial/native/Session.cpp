#include "Session.h"

#include <algorithm>
#include <chrono>

namespace serial {

    int64_t steadyMs() {
        return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch()).count();
    }

    Failure cancelledFailure() {
        return Failure{0, "", "The port is closed", "ECANCELED", false};
    }

    namespace {
        Failure timedOut(int64_t stall) {
            return Failure{0, "", "The output did not move for " + std::to_string(stall) + " ms", "ETIMEDOUT", false};
        }

        Failure overdue() {
            return Failure{0, "", "The output was not sent within the time limit", "ETIMEDOUT", false};
        }
    }

    Session::Session(Port &port, Device &device, size_t allowance) : port(port), device(device), allowance(allowance), options(port.options) {}

    void Session::process() {
        std::deque<Command> taken;
        {
            std::lock_guard<std::mutex> lock(port.mutex);
            taken.swap(port.commands);
        }
        for (Command &command: taken) handle(command);
        advance();
    }

    void Session::handle(Command &command) {
        switch (command.kind) {
            case CommandKind::Read:
                wantRead = command.wanted;
                return;
            case CommandKind::Close:
                closing = true;
                closeIds.push_back(command.id);
                if (command.discard && !discarding) {
                    discarding = true;
                    cancelOrdered(cancelledFailure());
                    if (!isDead) {
                        try {
                            device.flush(true, true);
                        } catch (...) {
                        }
                    }
                }
                return;
            case CommandKind::SetSignals:
                //A break goes out after the writes before it (the system waits for the output before a break)
                if (command.brk >= 0) {
                    if (isDead) return fail(command.id, deadFailure);
                    if (discarding) return fail(command.id, cancelledFailure());
                    ordered.push_back(Ordered{std::move(command), 0});
                    return;
                }
                [[fallthrough]];
            case CommandKind::Flush:
            case CommandKind::Signals: {
                if (isDead) return fail(command.id, deadFailure);
                try {
                    if (command.kind == CommandKind::Flush) {
                        device.flush(command.input, command.output);
                    } else if (command.kind == CommandKind::SetSignals) {
                        device.setSignals(command.dtr, command.rts, command.brk);
                    } else {
                        auto *event = new Event();
                        event->kind = EventKind::Result;
                        event->id = command.id;
                        try {
                            device.signals(*event);
                        } catch (...) {
                            delete event;
                            throw;
                        }
                        event->hasSignals = true;
                        port.post(event);
                        return;
                    }
                    result(command.id);
                } catch (const Failure &failure) {
                    fail(command.id, failure);
                }
                return;
            }
            default:
                if (isDead) return fail(command.id, deadFailure);
                if (discarding) return fail(command.id, cancelledFailure());
                ordered.push_back(Ordered{std::move(command), 0});
        }
    }

    void Session::advance() {
        while (!ordered.empty()) {
            Ordered &head = ordered.front();
            if (head.command.kind == CommandKind::Configure || head.command.kind == CommandKind::SetSignals) {
                try {
                    if (head.command.kind == CommandKind::Configure) {
                        device.configure(head.command.options);
                        options = head.command.options;
                    } else {
                        device.setSignals(head.command.dtr, head.command.rts, head.command.brk);
                    }
                    result(head.command.id);
                } catch (const Failure &failure) {
                    fail(head.command.id, failure);
                }
                ordered.pop_front();
                continue;
            }
            if (head.command.kind == CommandKind::Write && head.command.data.empty()) {
                result(head.command.id);
                ordered.pop_front();
                continue;
            }
            break;
        }
        //A new head starts its clock
        if (ordered.empty()) {
            headSet = false;
        } else if (!headSet || ordered.front().command.id != headId) {
            headSet = true;
            headId = ordered.front().command.id;
            lastProgress = steadyMs();
            lastQueued = -1;
            tailEnd = 0;
        }
    }

    bool Session::reading() const {
        return wantRead && !isDead && !closing;
    }

    const uint8_t *Session::pending(size_t &length) const {
        if (isDead || ordered.empty() || ordered.front().command.kind != CommandKind::Write) return nullptr;
        const Ordered &head = ordered.front();
        length = head.command.data.size() - head.offset;
        return head.command.data.data() + head.offset;
    }

    void Session::wrote(size_t count) {
        if (count == 0 || ordered.empty() || ordered.front().command.kind != CommandKind::Write) return;
        Ordered &head = ordered.front();
        head.offset += count;
        sinceIdle += count;
        tailEnd = 0;
        lastProgress = steadyMs();
        if (head.offset >= head.command.data.size()) {
            result(head.command.id);
            ordered.pop_front();
            advance();
        }
    }

    void Session::received(const uint8_t *data, size_t length) {
        auto *event = new Event();
        event->kind = EventKind::Data;
        event->data.assign(data, data + length);
        port.post(event);
    }

    void Session::fatal(const Failure &failure) {
        if (isDead) return;
        isDead = true;
        deadFailure = failure;
        auto *event = new Event();
        event->kind = EventKind::Fatal;
        event->failure = failure;
        port.post(event);
        cancelOrdered(failure);
    }

    bool Session::dead() const {
        return isDead;
    }

    int64_t Session::tailMs() const {
        if (!sinceIdle || !options.baudRate) return 0;
        const int64_t bits = 1 + options.dataBits + (options.parity == 'n' ? 0 : 1) + (options.stopBits == 1 ? 1 : 2);
        const int64_t bytes = static_cast<int64_t>(std::min(sinceIdle, allowance));
        return (bytes * bits * 1000 + options.baudRate - 1) / options.baudRate + 1;
    }

    int64_t Session::stallOfHead() const {
        const Ordered &head = ordered.front();
        if (head.command.kind == CommandKind::Drain) return head.command.stall;
        //A write takes the stall of the port, or the shorter one of the drain behind it (a closing that bounds it)
        int64_t stall = options.stallTimeout;
        for (size_t index = 1; index < ordered.size(); index++) {
            const Command &next = ordered[index].command;
            if (next.kind != CommandKind::Drain) continue;
            if (next.stall > 0) stall = stall > 0 ? std::min(stall, next.stall) : next.stall;
            break;
        }
        return stall;
    }

    int Session::timeout() const {
        if (isDead || ordered.empty()) return -1;
        const Ordered &head = ordered.front();
        const int64_t now = steadyMs();
        int64_t wait = -1;
        const auto bound = [&wait](int64_t value) -> void {
            const int64_t clamped = std::max<int64_t>(value, 0);
            wait = wait < 0 ? clamped : std::min(wait, clamped);
        };
        const int64_t stall = stallOfHead();
        if (stall > 0) bound(lastProgress + stall - now);
        if (head.command.kind == CommandKind::Drain) {
            if (head.command.deadline > 0) bound(head.command.deadline - now);
            //The queue of the system watched until empty, then the bytes it cannot see waited for
            bound(tailEnd > 0 ? tailEnd - now : 5);
        }
        return static_cast<int>(std::min<int64_t>(wait, 60000));
    }

    void Session::tick() {
        if (isDead || ordered.empty()) return;
        Ordered &head = ordered.front();
        const int64_t now = steadyMs();
        if (head.command.kind == CommandKind::Write) {
            const int64_t stall = stallOfHead();
            if (stall > 0 && now - lastProgress >= stall) {
                fail(head.command.id, timedOut(stall));
                ordered.pop_front();
                advance();
            }
            return;
        }
        if (head.command.kind != CommandKind::Drain) return;
        long queued = 0;
        try {
            queued = device.queued();
        } catch (const Failure &failure) {
            fatal(failure);
            return;
        }
        if (queued > 0) {
            if (lastQueued < 0 || queued < lastQueued) lastProgress = now;
            lastQueued = queued;
            tailEnd = 0;
        } else {
            if (lastQueued > 0) lastProgress = now;
            lastQueued = 0;
            if (tailEnd == 0) tailEnd = now + tailMs();
            if (now >= tailEnd) {
                sinceIdle = 0;
                tailEnd = 0;
                result(head.command.id);
                ordered.pop_front();
                advance();
                return;
            }
        }
        if (head.command.stall > 0 && now - lastProgress >= head.command.stall) {
            fail(head.command.id, timedOut(head.command.stall));
            ordered.pop_front();
            advance();
        } else if (head.command.deadline > 0 && now >= head.command.deadline) {
            fail(head.command.id, overdue());
            ordered.pop_front();
            advance();
        }
    }

    bool Session::finished() const {
        return closing && (discarding || isDead || ordered.empty());
    }

    bool Session::discard() const {
        return discarding || isDead;
    }

    void Session::closed() {
        for (uint32_t id: closeIds) {
            auto *event = new Event();
            event->kind = EventKind::Closed;
            event->id = id;
            port.post(event);
        }
        closeIds.clear();
    }

    void Session::result(uint32_t id) {
        auto *event = new Event();
        event->kind = EventKind::Result;
        event->id = id;
        port.post(event);
    }

    void Session::fail(uint32_t id, const Failure &failure) {
        auto *event = new Event();
        event->kind = EventKind::Failed;
        event->id = id;
        event->failure = failure;
        port.post(event);
    }

    void Session::cancelOrdered(const Failure &failure) {
        for (const Ordered &entry: ordered) fail(entry.command.id, failure);
        ordered.clear();
    }
}
