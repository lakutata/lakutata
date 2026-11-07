#ifndef _WIN32

#include "Port.h"
#include "Session.h"

#include <cerrno>
#include <chrono>
#include <cstdio>
#include <memory>
#include <cstdlib>
#include <cstring>
#include <future>
#include <fcntl.h>
#include <poll.h>
#include <termios.h>
#include <unistd.h>
#include <sys/file.h>
#include <sys/ioctl.h>
#include <sys/socket.h>

#ifdef __APPLE__
#include <TargetConditionals.h>
#if TARGET_OS_OSX
#include <CoreFoundation/CoreFoundation.h>
#include <IOKit/IOKitLib.h>
#include <IOKit/serial/IOSerialKeys.h>
#include <IOKit/serial/ioss.h>
#endif
#endif

namespace serial {

    namespace {
        //The bytes a drain cannot see once the queue of the system is empty: the FIFO of a USB adapter's chip on Linux
        //(its URBs are counted), the queue of the driver too on macOS (TIOCOUTQ counts the tty's queue only)
#ifdef __APPLE__
        constexpr size_t ALLOWANCE = 4096;
#else
        constexpr size_t ALLOWANCE = 1024;
#endif

        [[noreturn]] void fail(const char *syscall, int code = errno) {
            throw Failure{code, syscall, "", "", false};
        }

        /**
         * A failure of a read or a write: the device gone for the errors of an unplugged adapter, a hang-up, a lost
         * Bluetooth link
         */
        Failure ioFailure(const char *syscall, int code) {
            const bool gone = code == EIO || code == ENXIO || code == ENODEV || code == EBADF || code == ECONNRESET || code == ENOTCONN || code == EPIPE || code == EHOSTDOWN;
            return Failure{code, syscall, gone ? "The device is gone (" + std::string(std::strerror(code)) + ")" : "", "", gone};
        }

        Failure hangUp() {
            return Failure{EIO, "read", "The device is gone (the line hung up)", "", true};
        }

        void nonBlocking(int fd) {
            fcntl(fd, F_SETFL, fcntl(fd, F_GETFL) | O_NONBLOCK);
            fcntl(fd, F_SETFD, fcntl(fd, F_GETFD) | FD_CLOEXEC);
        }

        struct Speed {
            uint32_t rate;
            speed_t constant;
        };

        const Speed SPEEDS[] = {
                {50, B50}, {75, B75}, {110, B110}, {134, B134}, {150, B150}, {200, B200}, {300, B300}, {600, B600},
                {1200, B1200}, {1800, B1800}, {2400, B2400}, {4800, B4800}, {9600, B9600}, {19200, B19200},
                {38400, B38400}, {57600, B57600}, {115200, B115200}, {230400, B230400},
#ifdef B460800
                {460800, B460800},
#endif
#ifdef B500000
                {500000, B500000},
#endif
#ifdef B576000
                {576000, B576000},
#endif
#ifdef B921600
                {921600, B921600},
#endif
#ifdef B1000000
                {1000000, B1000000},
#endif
#ifdef B1152000
                {1152000, B1152000},
#endif
#ifdef B1500000
                {1500000, B1500000},
#endif
#ifdef B2000000
                {2000000, B2000000},
#endif
#ifdef B2500000
                {2500000, B2500000},
#endif
#ifdef B3000000
                {3000000, B3000000},
#endif
#ifdef B3500000
                {3500000, B3500000},
#endif
#ifdef B4000000
                {4000000, B4000000},
#endif
        };

        bool constantOf(uint32_t rate, speed_t &constant) {
            for (const Speed &speed: SPEEDS) {
                if (speed.rate == rate) {
                    constant = speed.constant;
                    return true;
                }
            }
            return false;
        }

        /**
         * A device the thread opens and closes: a terminal, or a Bluetooth socket
         */
        class Endpoint : public Device {
        public:
            virtual void open() = 0;

            virtual void close(bool discard) = 0;
        };

        /**
         * The device of a port on Linux and macOS: a terminal (its settings by termios), opened without waiting for
         * a carrier and kept non-blocking, its waits done by poll
         */
        class UnixDevice : public Endpoint {
        public:
            explicit UnixDevice(Port &port) : port(port), options(port.options) {}

            void open() override {
                //Not waiting for the carrier (O_NONBLOCK), not becoming the terminal of the process (O_NOCTTY)
                int fd;
                do {
                    fd = ::open(port.path.c_str(), O_RDWR | O_NOCTTY | O_NONBLOCK | O_CLOEXEC);
                } while (fd < 0 && errno == EINTR);
                if (fd < 0) fail("open");
                port.fd = fd;
                try {
                    if (!isatty(fd)) fail("open", ENOTTY);
                    if (port.exclusive) {
                        //The lock first, before anything of the terminal changes (the other libraries of serial ports
                        //lock it too), then the exclusive mode of the terminal for the programs that do not lock; a
                        //system without locks for the device (some mounts of /dev) is left to the exclusive mode
                        if (flock(fd, LOCK_EX | LOCK_NB) < 0 && errno == EWOULDBLOCK) fail("flock", EBUSY);
#ifdef TIOCEXCL
                        if (ioctl(fd, TIOCEXCL) == 0) port.locked = true;
                        else if (errno != ENOTTY && errno != EINVAL) fail("ioctl");
#endif
                    }
                    configure(options);
                    //What the adapter still held from before: some hand it over a few milliseconds after the opening
                    std::this_thread::sleep_for(std::chrono::milliseconds(10));
                    tcflush(fd, TCIOFLUSH);
                } catch (...) {
                    release();
                    ::close(fd);
                    port.fd = -1;
                    throw;
                }
            }

            void close(bool discard) override {
                if (port.fd < 0) return;
                //The input left discarded (some drivers of macOS crash on a close with input unread), and the output
                //when it is given up: a close would wait for it (up to 30 seconds on Linux)
                tcflush(port.fd, discard ? TCIOFLUSH : TCIFLUSH);
                release();
                ::close(port.fd);
                port.fd = -1;
            }

            void configure(const LineOptions &next) override {
                struct termios settings;
                if (tcgetattr(port.fd, &settings) < 0) fail("tcgetattr");
                cfmakeraw(&settings);
                //What cfmakeraw leaves of the input processing, and the flow controls by other lines of macOS
                settings.c_iflag &= ~(IGNBRK | BRKINT | PARMRK | ISTRIP | INLCR | IGNCR | ICRNL | IXON | IXOFF | IXANY | INPCK | IGNPAR);
#ifdef IUCLC
                settings.c_iflag &= ~IUCLC;
#endif
#ifdef IMAXBEL
                settings.c_iflag &= ~IMAXBEL;
#endif
                settings.c_cflag |= CLOCAL | CREAD;
                settings.c_cflag &= ~(CSIZE | CSTOPB | PARENB | PARODD);
#ifdef CIBAUD
                //An input speed of its own (left by a custom speed) cleared: the input follows the output
                settings.c_cflag &= ~CIBAUD;
#endif
#ifdef CMSPAR
                settings.c_cflag &= ~CMSPAR;
#endif
#ifdef CRTSCTS
                settings.c_cflag &= ~CRTSCTS;
#endif
#ifdef CDTR_IFLOW
                settings.c_cflag &= ~CDTR_IFLOW;
#endif
#ifdef CDSR_OFLOW
                settings.c_cflag &= ~CDSR_OFLOW;
#endif
#ifdef CCAR_OFLOW
                settings.c_cflag &= ~CCAR_OFLOW;
#endif
                switch (next.dataBits) {
                    case 5:
                        settings.c_cflag |= CS5;
                        break;
                    case 6:
                        settings.c_cflag |= CS6;
                        break;
                    case 7:
                        settings.c_cflag |= CS7;
                        break;
                    default:
                        settings.c_cflag |= CS8;
                }
                if (next.stopBits == 15) throw Failure{EINVAL, "tcsetattr", "1.5 stop bits are offered on Windows only", "", false};
                if (next.stopBits == 2) settings.c_cflag |= CSTOPB;
                switch (next.parity) {
                    case 'e':
                        settings.c_cflag |= PARENB;
                        break;
                    case 'o':
                        settings.c_cflag |= PARENB | PARODD;
                        break;
                    case 'm':
                    case 's':
#ifdef CMSPAR
                        settings.c_cflag |= PARENB | CMSPAR | (next.parity == 'm' ? PARODD : 0);
                        break;
#else
                        throw Failure{EINVAL, "tcsetattr", "The mark and space parities are not offered on this system", "", false};
#endif
                    default:
                        break;
                }
                if (next.flowControl == 1) {
#ifdef CRTSCTS
                    settings.c_cflag |= CRTSCTS;
#else
                    throw Failure{EINVAL, "tcsetattr", "The RTS/CTS flow control is not offered on this system", "", false};
#endif
                } else if (next.flowControl == 2) {
                    settings.c_iflag |= IXON | IXOFF;
                    settings.c_cc[VSTART] = 0x11;
                    settings.c_cc[VSTOP] = 0x13;
                } else if (next.flowControl == 3) {
#if defined(CDSR_OFLOW) && defined(CDTR_IFLOW)
                    settings.c_cflag |= CDSR_OFLOW | CDTR_IFLOW;
#else
                    throw Failure{EINVAL, "tcsetattr", "The DTR/DSR flow control is not offered on this system", "", false};
#endif
                }
                //A read of an empty queue fails with EAGAIN (the descriptor is non-blocking), so that a read of 0 bytes
                //only means a hang-up (with VMIN 0 an emptied queue, by a flush or another reader, reads 0 too)
                settings.c_cc[VMIN] = 1;
                settings.c_cc[VTIME] = 0;
                speed_t constant;
                const bool standard = constantOf(next.baudRate, constant);
                if (standard) {
                    if (cfsetispeed(&settings, constant) < 0 || cfsetospeed(&settings, constant) < 0) fail("cfsetspeed");
                } else {
#if defined(__APPLE__) && TARGET_OS_OSX
                    //The driver refuses a speed outside its table in tcsetattr, the custom one set by IOSSIOSPEED
                    //included (tcgetattr reads it back): a speed of the table first, the custom one after
                    if (cfsetispeed(&settings, B9600) < 0 || cfsetospeed(&settings, B9600) < 0) fail("cfsetspeed");
#elif !defined(__linux__)
                    throw Failure{EINVAL, "tcsetattr", "The speed is not one of the system", "", false};
#endif
                }
                if (tcsetattr(port.fd, TCSANOW, &settings) < 0) fail("tcsetattr");
                if (!standard) {
#if defined(__APPLE__) && TARGET_OS_OSX
                    speed_t speed = next.baudRate;
                    if (ioctl(port.fd, IOSSIOSPEED, &speed) < 0) fail("ioctl");
#elif defined(__linux__)
                    if (setLinuxSpeed(port.fd, next.baudRate) < 0) fail("ioctl");
#endif
                }
                verify(settings, next.baudRate, standard);
                options = next;
            }

            void flush(bool input, bool output) override {
                if (!input && !output) return;
                if (tcflush(port.fd, input && output ? TCIOFLUSH : input ? TCIFLUSH : TCOFLUSH) < 0) fail("tcflush");
            }

            void signals(Event &event) override {
                int lines = 0;
                if (ioctl(port.fd, TIOCMGET, &lines) < 0) fail("ioctl");
                event.cts = (lines & TIOCM_CTS) != 0;
                event.dsr = (lines & TIOCM_DSR) != 0;
                event.dcd = (lines & TIOCM_CAR) != 0;
                event.ri = (lines & TIOCM_RNG) != 0;
            }

            void setSignals(int dtr, int rts, int brk) override {
                if (rts >= 0 && options.flowControl == 1) throw Failure{EINVAL, "ioctl", "RTS is driven by the RTS/CTS flow control", "", false};
                if (dtr >= 0 && options.flowControl == 3) throw Failure{EINVAL, "ioctl", "DTR is driven by the DTR/DSR flow control", "", false};
                int set = 0;
                int clear = 0;
                if (dtr >= 0) (dtr ? set : clear) |= TIOCM_DTR;
                if (rts >= 0) (rts ? set : clear) |= TIOCM_RTS;
                if (set && ioctl(port.fd, TIOCMBIS, &set) < 0) fail("ioctl");
                if (clear && ioctl(port.fd, TIOCMBIC, &clear) < 0) fail("ioctl");
                if (brk >= 0) breakLine(brk != 0);
            }

            long queued() override {
#ifdef TIOCOUTQ
                int count = 0;
                if (ioctl(port.fd, TIOCOUTQ, &count) == 0) return count;
#endif
                return 0;
            }

        private:
            /**
             * A break set or cleared on a thread of its own, on a copy of the descriptor: the system waits for the
             * output to be sent first, without end when the flow control holds it (Linux), so the port's thread waits
             * two seconds at most and leaves that thread to finish whenever the output moves
             */
            void breakLine(bool on) {
                const int copy = fcntl(port.fd, F_DUPFD_CLOEXEC, 0);
                if (copy < 0) fail("fcntl");
                auto done = std::make_shared<std::promise<int>>();
                std::future<int> result = done->get_future();
                std::thread([copy, on, done]() -> void {
                    const int code = ioctl(copy, on ? TIOCSBRK : TIOCCBRK) < 0 ? errno : 0;
                    ::close(copy);
                    done->set_value(code);
                }).detach();
                if (result.wait_for(std::chrono::seconds(2)) != std::future_status::ready)
                    throw Failure{ETIMEDOUT, "ioctl", "The break waits for the output to be sent, held by the flow control", "ETIMEDOUT", false};
                const int code = result.get();
                if (code) fail("ioctl", code);
            }

            /**
             * The settings read back: tcsetattr succeeds when any of them was taken, a driver may drop the others or
             * run at another speed
             */
            void verify(const struct termios &wanted, uint32_t baudRate, bool standard) {
                struct termios actual;
                if (tcgetattr(port.fd, &actual) < 0) fail("tcgetattr");
                //The speed: the one the kernel holds on Linux (the custom ones included), the one of termios elsewhere
                //(a custom speed of macOS reads back unreliably); a driver may round it a little
                uint32_t speed = 0;
#ifdef __linux__
                speed = linuxSpeed(port.fd);
                (void) standard;
#else
                if (standard) {
                    const speed_t constant = cfgetospeed(&actual);
                    for (const Speed &entry: SPEEDS) {
                        if (entry.constant == constant) speed = entry.rate;
                    }
                }
#endif
                if (speed && std::llabs(static_cast<long long>(speed) - static_cast<long long>(baudRate)) * 100 > static_cast<long long>(baudRate) * 3)
                    throw Failure{EINVAL, "tcsetattr", "The device runs at " + std::to_string(speed) + " bits a second, not " + std::to_string(baudRate), "", false};
                tcflag_t control = CSIZE | CSTOPB | PARENB | PARODD;
#ifdef CMSPAR
                control |= CMSPAR;
#endif
#if defined(__linux__) && defined(CRTSCTS)
                control |= CRTSCTS;
#endif
                const tcflag_t input = IXON | IXOFF;
                if ((actual.c_cflag & control) != (wanted.c_cflag & control) || (actual.c_iflag & input) != (wanted.c_iflag & input))
                    throw Failure{EINVAL, "tcsetattr", "The device did not take all the settings of the line", "", false};
            }

            void release() {
#ifdef TIOCNXCL
                if (port.locked) ioctl(port.fd, TIOCNXCL);
#endif
                port.locked = false;
            }

            Port &port;
            LineOptions options;
        };

#ifdef __linux__
        /**
         * Whether JavaScript asked for the closing (while the thread still opens the device)
         */
        bool closeAsked(Port &port) {
            std::lock_guard<std::mutex> lock(port.mutex);
            for (const Command &command: port.commands) {
                if (command.kind == CommandKind::Close) return true;
            }
            return false;
        }

        //The socket address of RFCOMM (as <bluetooth/rfcomm.h> declares it, without needing BlueZ's headers)
        constexpr int RFCOMM_PROTOCOL = 3;

        struct RfcommAddress {
            sa_family_t family;
            uint8_t address[6];
            uint8_t channel;
        };

        /**
         * A Bluetooth device on Linux: a socket of RFCOMM (its serial port profile), connected without blocking, then
         * read and written by the same loop as a terminal; it has no line settings and no modem lines
         */
        class RfcommDevice : public Endpoint {
        public:
            explicit RfcommDevice(Port &port) : port(port) {}

            void open() override {
                RfcommAddress target = {};
                target.family = AF_BLUETOOTH;
                target.channel = static_cast<uint8_t>(port.channel);
                unsigned int bytes[6];
                if (std::sscanf(port.address.c_str(), "%2x:%2x:%2x:%2x:%2x:%2x", &bytes[0], &bytes[1], &bytes[2], &bytes[3], &bytes[4], &bytes[5]) != 6)
                    throw Failure{EINVAL, "connect", "The Bluetooth address is not six bytes like 00:11:22:33:44:55", "", false};
                //The address in the order of the radio (the last byte first)
                for (int index = 0; index < 6; index++) target.address[index] = static_cast<uint8_t>(bytes[5 - index]);
                const int fd = socket(AF_BLUETOOTH, SOCK_STREAM | SOCK_NONBLOCK | SOCK_CLOEXEC, RFCOMM_PROTOCOL);
                if (fd < 0) fail("socket");
                port.fd = fd;
                try {
                    if (connect(fd, reinterpret_cast<const sockaddr *>(&target), sizeof(target)) < 0) {
                        if (errno != EINPROGRESS) fail("connect");
                        //Connecting takes seconds: waited for in slices, given up when JavaScript closes the port
                        for (;;) {
                            if (closeAsked(port)) throw Failure{0, "connect", "The port is closed", "ECANCELED", false};
                            struct pollfd entry = {fd, POLLOUT, 0};
                            const int ready = poll(&entry, 1, 100);
                            if (ready < 0 && errno != EINTR) fail("poll");
                            if (ready > 0) break;
                        }
                        int code = 0;
                        socklen_t length = sizeof(code);
                        if (getsockopt(fd, SOL_SOCKET, SO_ERROR, &code, &length) < 0) fail("getsockopt");
                        if (code) fail("connect", code);
                    }
                } catch (...) {
                    ::close(fd);
                    port.fd = -1;
                    throw;
                }
            }

            void close(bool) override {
                if (port.fd < 0) return;
                ::close(port.fd);
                port.fd = -1;
            }

            void configure(const LineOptions &) override {}

            void flush(bool, bool) override {}

            void signals(Event &) override {
                throw Failure{ENOTSUP, "ioctl", "A Bluetooth link has no modem lines", "", false};
            }

            void setSignals(int, int, int) override {
                throw Failure{ENOTSUP, "ioctl", "A Bluetooth link has no modem lines", "", false};
            }

            long queued() override {
                //The socket reports its free space, not what is queued: the drains rely on the time of the bytes
                return 0;
            }

        private:
            Port &port;
        };
#endif

        std::unique_ptr<Endpoint> endpointOf(Port &port) {
#ifdef __linux__
            if (port.rfcomm) return std::make_unique<RfcommDevice>(port);
#endif
            return std::make_unique<UnixDevice>(port);
        }
    }

    Port::Port() {
        int pipes[2];
        if (pipe(pipes) == 0) {
            wakeRead = pipes[0];
            wakeWrite = pipes[1];
            nonBlocking(wakeRead);
            nonBlocking(wakeWrite);
        }
    }

    Port::~Port() {
        if (thread.joinable()) {
            if (thread.get_id() == std::this_thread::get_id()) thread.detach();
            else thread.join();
        }
        if (fd >= 0) ::close(fd);
        if (wakeRead >= 0) ::close(wakeRead);
        if (wakeWrite >= 0) ::close(wakeWrite);
    }

    void Port::push(Command command) {
        {
            std::lock_guard<std::mutex> lock(mutex);
            commands.push_back(std::move(command));
        }
        wake();
    }

    void Port::wake() {
        const char byte = 1;
        if (wakeWrite >= 0) {
            ssize_t result;
            do {
                result = ::write(wakeWrite, &byte, 1);
            } while (result < 0 && errno == EINTR);
        }
    }

    void run(Port &port) {
#ifndef __linux__
        if (port.rfcomm) {
            auto *failed = new Event();
            failed->kind = EventKind::Failed;
            failed->failure = Failure{ENOTSUP, "socket", "Bluetooth sockets are offered on Linux only; elsewhere the paired device is a serial port", "", false};
            port.post(failed);
            auto *closed = new Event();
            closed->kind = EventKind::Closed;
            port.post(closed);
            port.finished = true;
            return;
        }
#endif
        std::unique_ptr<Endpoint> endpoint = endpointOf(port);
        Endpoint &device = *endpoint;
        try {
            device.open();
        } catch (const Failure &failure) {
            auto *failed = new Event();
            failed->kind = EventKind::Failed;
            failed->id = 0;
            failed->failure = failure;
            port.post(failed);
            auto *closed = new Event();
            closed->kind = EventKind::Closed;
            port.post(closed);
            port.finished = true;
            return;
        }
        auto *opened = new Event();
        opened->kind = EventKind::Opened;
        port.post(opened);
        Session session(port, device, ALLOWANCE);
        std::vector<uint8_t> buffer(65536);
        //Writes that took nothing although the port was writable: a device that takes no data
        int emptyWrites = 0;
        //Data came while no read is wanted: not watched (it would wake the loop again and again) but checked every
        //second for a hang-up, which macOS reports only to a watch for input
        bool parked = false;
        for (;;) {
            session.process();
            if (session.finished()) break;
            const bool reading = session.reading();
            if (reading) parked = false;
            short events = 0;
            size_t length = 0;
            const uint8_t *pending = session.pending(length);
            if (reading || !parked) events |= POLLIN;
            if (pending) events |= POLLOUT;
            int timeout = session.timeout();
            if (parked && !session.dead() && (timeout < 0 || timeout > 1000)) timeout = 1000;
            struct pollfd entries[2] = {{session.dead() ? -1 : port.fd, events, 0}, {port.wakeRead, POLLIN, 0}};
            const int ready = poll(entries, 2, timeout);
            if (ready < 0) {
                if (errno == EINTR) continue;
                session.fatal(ioFailure("poll", errno));
                continue;
            }
            if (ready == 0 && parked && !session.dead()) {
                struct pollfd probe = {port.fd, POLLIN, 0};
                if (poll(&probe, 1, 0) > 0 && (probe.revents & (POLLHUP | POLLERR | POLLNVAL))) session.fatal(hangUp());
            }
            if (entries[1].revents) {
                char drained[64];
                while (::read(port.wakeRead, drained, sizeof(drained)) > 0) {}
            }
            const short revents = entries[0].revents;
            if (!session.dead() && revents) {
                if (revents & POLLNVAL) {
                    session.fatal(ioFailure("poll", EBADF));
                } else if ((revents & POLLIN) && !reading) {
                    if (revents & (POLLHUP | POLLERR)) session.fatal(hangUp());
                    else parked = true;
                } else if (revents & POLLIN) {
                    const ssize_t count = ::read(port.fd, buffer.data(), buffer.size());
                    if (count > 0) session.received(buffer.data(), static_cast<size_t>(count));
                    else if (count == 0) session.fatal(hangUp());
                    else if (errno != EAGAIN && errno != EINTR) session.fatal(ioFailure("read", errno));
                } else if (revents & (POLLHUP | POLLERR)) {
                    //A hang-up with nothing left to read, seen even while no read is wanted (an adapter unplugged)
                    session.fatal(hangUp());
                }
                if (!session.dead() && (revents & POLLOUT)) {
                    pending = session.pending(length);
                    if (pending) {
                        const ssize_t count = ::write(port.fd, pending, length);
                        if (count > 0) {
                            emptyWrites = 0;
                            session.wrote(static_cast<size_t>(count));
                        } else if (count == 0) {
                            if (++emptyWrites > 1000) session.fatal(Failure{EIO, "write", "The device is gone (it takes no data)", "", true});
                        } else if (errno != EAGAIN && errno != EINTR) {
                            session.fatal(ioFailure("write", errno));
                        }
                    }
                }
            }
            session.tick();
        }
        device.close(session.discard());
        session.closed();
        port.finished = true;
    }

#if defined(__APPLE__) && TARGET_OS_OSX
    namespace {
        std::string stringOf(CFTypeRef value) {
            if (!value || CFGetTypeID(value) != CFStringGetTypeID()) return "";
            const auto string = static_cast<CFStringRef>(value);
            const CFIndex size = CFStringGetMaximumSizeForEncoding(CFStringGetLength(string), kCFStringEncodingUTF8) + 1;
            std::string result(static_cast<size_t>(size), '\0');
            if (!CFStringGetCString(string, &result[0], size, kCFStringEncodingUTF8)) return "";
            result.resize(std::strlen(result.c_str()));
            return result;
        }

        int numberOf(CFTypeRef value) {
            int result = -1;
            if (value && CFGetTypeID(value) == CFNumberGetTypeID()) CFNumberGetValue(static_cast<CFNumberRef>(value), kCFNumberIntType, &result);
            return result;
        }

        std::string propertyString(io_object_t entry, const char *key) {
            const CFStringRef name = CFStringCreateWithCString(kCFAllocatorDefault, key, kCFStringEncodingUTF8);
            const CFTypeRef value = IORegistryEntryCreateCFProperty(entry, name, kCFAllocatorDefault, 0);
            CFRelease(name);
            std::string result = stringOf(value);
            if (value) CFRelease(value);
            return result;
        }

        int propertyNumber(io_object_t entry, const char *key) {
            const CFStringRef name = CFStringCreateWithCString(kCFAllocatorDefault, key, kCFStringEncodingUTF8);
            const CFTypeRef value = IORegistryEntryCreateCFProperty(entry, name, kCFAllocatorDefault, 0);
            CFRelease(name);
            const int result = numberOf(value);
            if (value) CFRelease(value);
            return result;
        }

        /**
         * The USB device above a port (its nearest ancestor with a vendor id), every property read from it alone, so
         * that a device without a serial number does not take the one of a hub
         */
        io_object_t usbDeviceOf(io_object_t service) {
            io_object_t current = service;
            IOObjectRetain(current);
            for (int depth = 0; depth < 16; depth++) {
                io_object_t parent = 0;
                if (IORegistryEntryGetParentEntry(current, kIOServicePlane, &parent) != KERN_SUCCESS) break;
                IOObjectRelease(current);
                current = parent;
                if (propertyNumber(current, "idVendor") >= 0) return current;
            }
            IOObjectRelease(current);
            return 0;
        }
    }

    bool listPorts(std::vector<PortInfo> &ports) {
        CFMutableDictionaryRef matching = IOServiceMatching(kIOSerialBSDServiceValue);
        if (!matching) return true;
        CFDictionarySetValue(matching, CFSTR(kIOSerialBSDTypeKey), CFSTR(kIOSerialBSDAllTypes));
        io_iterator_t iterator = 0;
        if (IOServiceGetMatchingServices(MACH_PORT_NULL, matching, &iterator) != KERN_SUCCESS) return true;
        io_object_t service;
        while ((service = IOIteratorNext(iterator))) {
            PortInfo info;
            info.path = propertyString(service, kIOCalloutDeviceKey);
            //A port of a paired Bluetooth device: the name and the address its serial client holds
            const CFTypeRef bluetoothName = IORegistryEntrySearchCFProperty(service, kIOServicePlane, CFSTR("BTName"), kCFAllocatorDefault, kIORegistryIterateRecursively | kIORegistryIterateParents);
            if (bluetoothName) {
                info.product = stringOf(bluetoothName);
                CFRelease(bluetoothName);
                const CFTypeRef address = IORegistryEntrySearchCFProperty(service, kIOServicePlane, CFSTR("BTAddress"), kCFAllocatorDefault, kIORegistryIterateRecursively | kIORegistryIterateParents);
                if (address && CFGetTypeID(address) == CFDataGetTypeID() && CFDataGetLength(static_cast<CFDataRef>(address)) == 6) {
                    const UInt8 *bytes = CFDataGetBytePtr(static_cast<CFDataRef>(address));
                    char text[18];
                    std::snprintf(text, sizeof(text), "%02X:%02X:%02X:%02X:%02X:%02X", bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5]);
                    info.bluetoothAddress = text;
                } else if (address) {
                    info.bluetoothAddress = stringOf(address);
                }
                if (address) CFRelease(address);
            }
            const io_object_t usb = usbDeviceOf(service);
            if (usb) {
                info.vendorId = propertyNumber(usb, "idVendor");
                info.productId = propertyNumber(usb, "idProduct");
                //The strings of the device as it reports them; the older keys hold copies with - turned into _
                const char *keys[3][2] = {{"kUSBSerialNumberString", "USB Serial Number"}, {"kUSBVendorString", "USB Vendor Name"}, {"kUSBProductString", "USB Product Name"}};
                std::string *targets[] = {&info.serialNumber, &info.manufacturer, &info.product};
                for (int index = 0; index < 3; index++) {
                    *targets[index] = propertyString(usb, keys[index][0]);
                    if (targets[index]->empty()) *targets[index] = propertyString(usb, keys[index][1]);
                }
                IOObjectRelease(usb);
            }
            IOObjectRelease(service);
            if (!info.path.empty()) ports.push_back(info);
        }
        IOObjectRelease(iterator);
        return true;
    }
#else

    bool listPorts(std::vector<PortInfo> &) {
        return false;
    }

#endif

    std::string nameOf(long code) {
        switch (code) {
            case ENOENT:
                return "ENOENT";
            case EACCES:
                return "EACCES";
            case EPERM:
                return "EPERM";
            case EBUSY:
                return "EBUSY";
            case ENOTTY:
                return "ENOTTY";
            case EIO:
                return "EIO";
            case EINVAL:
                return "EINVAL";
            case ENXIO:
                return "ENXIO";
            case ENODEV:
                return "ENODEV";
            case EAGAIN:
                return "EAGAIN";
            case EBADF:
                return "EBADF";
            case ETIMEDOUT:
                return "ETIMEDOUT";
            case ECANCELED:
                return "ECANCELED";
            case EISDIR:
                return "EISDIR";
            case ENOTDIR:
                return "ENOTDIR";
            case EMFILE:
                return "EMFILE";
            case ENOMEM:
                return "ENOMEM";
            case EPIPE:
                return "EPIPE";
            case ENOTSUP:
                return "ENOTSUP";
#if defined(EOPNOTSUPP) && EOPNOTSUPP != ENOTSUP
            case EOPNOTSUPP:
                return "EOPNOTSUPP";
#endif
            case EAFNOSUPPORT:
                return "EAFNOSUPPORT";
            case EHOSTDOWN:
                return "EHOSTDOWN";
            case EHOSTUNREACH:
                return "EHOSTUNREACH";
            case ECONNREFUSED:
                return "ECONNREFUSED";
            case ECONNRESET:
                return "ECONNRESET";
            case ENOTCONN:
                return "ENOTCONN";
            default:
                return "EUNKNOWN";
        }
    }

    std::string messageOf(long code) {
        return std::strerror(static_cast<int>(code));
    }
}

#endif
