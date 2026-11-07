#ifndef _WIN32

#include "Port.h"

#include <cerrno>
#include <chrono>
#include <cstring>
#include <thread>
#include <fcntl.h>
#include <poll.h>
#include <termios.h>
#include <unistd.h>
#include <sys/file.h>
#include <sys/ioctl.h>

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
        //The slice of the reads and the writes: an operation returns within it, then its next one is queued
        constexpr int SLICE = 100;

        [[noreturn]] void fail(const char *syscall, int code = errno) {
            throw Failure{code, syscall, ""};
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
         * Wait for the port to be readable or writable within a time, ending early when it is closed
         */
        bool ready(Port &port, short events, int timeout) {
            struct pollfd entry = {port.fd, events, 0};
            int result;
            do {
                result = poll(&entry, 1, timeout);
            } while (result < 0 && errno == EINTR);
            if (result < 0) fail("poll");
            if (result == 0) return false;
            if (entry.revents & POLLNVAL) fail("poll", EBADF);
            //A hang-up with data still to read: read them first
            if ((entry.revents & (POLLERR | POLLHUP)) && !(entry.revents & events)) fail("poll", EIO);
            return true;
        }
    }

    void openPort(Port &port, const LineOptions &options, bool exclusive) {
        //Not waiting for the carrier (O_NONBLOCK), not becoming the terminal of the process (O_NOCTTY); the descriptor
        //stays non-blocking, its reads and writes waited for by poll
        int fd;
        do {
            fd = open(port.path.c_str(), O_RDWR | O_NOCTTY | O_NONBLOCK | O_CLOEXEC);
        } while (fd < 0 && errno == EINTR);
        if (fd < 0) fail("open");
        port.fd = fd;
        try {
            if (!isatty(fd)) fail("open", ENOTTY);
            if (exclusive) {
                //Exclusive for the openings of the other programs (TIOCEXCL, which macOS ignores on pseudo-terminals)
                //and for the ones that lock it too (flock: this package, the other libraries of serial ports)
#ifdef TIOCEXCL
                if (ioctl(fd, TIOCEXCL) < 0) fail("ioctl");
#endif
                if (flock(fd, LOCK_EX | LOCK_NB) < 0) fail("flock", errno == EWOULDBLOCK ? EBUSY : errno);
            }
            configurePort(port, options);
            tcflush(fd, TCIOFLUSH);
        } catch (...) {
            close(fd);
            port.fd = -1;
            throw;
        }
    }

    void configurePort(Port &port, const LineOptions &options) {
        struct termios settings;
        if (tcgetattr(port.fd, &settings) < 0) fail("tcgetattr");
        cfmakeraw(&settings);
        settings.c_cflag |= CLOCAL | CREAD;
        settings.c_cflag &= ~(CSIZE | CSTOPB | PARENB | PARODD);
#ifdef CMSPAR
        settings.c_cflag &= ~CMSPAR;
#endif
        switch (options.dataBits) {
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
        if (options.stopBits == 15) throw Failure{EINVAL, "tcsetattr", "1.5 stop bits are offered on Windows only"};
        if (options.stopBits == 2) settings.c_cflag |= CSTOPB;
        switch (options.parity) {
            case 'e':
                settings.c_cflag |= PARENB;
                break;
            case 'o':
                settings.c_cflag |= PARENB | PARODD;
                break;
            case 'm':
            case 's':
#ifdef CMSPAR
                settings.c_cflag |= PARENB | CMSPAR | (options.parity == 'm' ? PARODD : 0);
                break;
#else
                throw Failure{EINVAL, "tcsetattr", "the mark and space parities are not offered on this system"};
#endif
            default:
                break;
        }
        settings.c_iflag &= ~(IXON | IXOFF | IXANY);
#ifdef CRTSCTS
        settings.c_cflag &= ~CRTSCTS;
#endif
        if (options.flowControl == 1) {
#ifdef CRTSCTS
            settings.c_cflag |= CRTSCTS;
#else
            throw Failure{EINVAL, "tcsetattr", "the RTS/CTS flow control is not offered on this system"};
#endif
        } else if (options.flowControl == 2) {
            settings.c_iflag |= IXON | IXOFF;
            settings.c_cc[VSTART] = 0x11;
            settings.c_cc[VSTOP] = 0x13;
        }
        settings.c_cc[VMIN] = 0;
        settings.c_cc[VTIME] = 0;
        speed_t constant;
        const bool standard = constantOf(options.baudRate, constant);
        if (standard) {
            cfsetispeed(&settings, constant);
            cfsetospeed(&settings, constant);
        } else {
#if !defined(__linux__) && !(defined(__APPLE__) && TARGET_OS_OSX)
            throw Failure{EINVAL, "tcsetattr", "the speed is not one of the system"};
#endif
        }
        if (tcsetattr(port.fd, TCSANOW, &settings) < 0) fail("tcsetattr");
        if (!standard) {
#if defined(__APPLE__) && TARGET_OS_OSX
            speed_t speed = options.baudRate;
            if (ioctl(port.fd, IOSSIOSPEED, &speed) < 0) fail("ioctl");
#elif defined(__linux__)
            if (setLinuxSpeed(port.fd, options.baudRate) < 0) fail("ioctl");
#endif
        }
    }

    size_t writeSlice(Port &port, const uint8_t *data, size_t length) {
        const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(SLICE);
        size_t written = 0;
        while (written < length && !port.closing) {
            const auto left = std::chrono::duration_cast<std::chrono::milliseconds>(deadline - std::chrono::steady_clock::now()).count();
            if (left <= 0) break;
            if (!ready(port, POLLOUT, static_cast<int>(left))) break;
            const ssize_t result = write(port.fd, data + written, length - written);
            if (result < 0) {
                if (errno == EINTR || errno == EAGAIN) continue;
                fail("write");
            }
            written += static_cast<size_t>(result);
        }
        return written;
    }

    size_t readSlice(Port &port, uint8_t *data, size_t length) {
        if (port.closing || !ready(port, POLLIN, SLICE)) return 0;
        ssize_t result;
        do {
            result = read(port.fd, data, length);
        } while (result < 0 && errno == EINTR);
        if (result < 0) {
            if (errno == EAGAIN) return 0;
            fail("read");
        }
        //Readable, yet nothing to read: the other end is gone (a pseudo-terminal closed, a device unplugged)
        if (result == 0) fail("read", EIO);
        return static_cast<size_t>(result);
    }

    void drainPort(Port &port) {
#ifdef TIOCOUTQ
        //The output queue watched until empty, so that a closing ends the wait (tcdrain cannot be stopped)
        while (!port.closing) {
            int queued = 0;
            if (ioctl(port.fd, TIOCOUTQ, &queued) < 0) break;
            if (queued <= 0) break;
            std::this_thread::sleep_for(std::chrono::milliseconds(5));
        }
#endif
        if (port.closing) return;
        if (tcdrain(port.fd) < 0 && errno != EINTR && errno != ENOTTY && errno != EINVAL) fail("tcdrain");
    }

    void flushPort(Port &port, bool input, bool output) {
        if (!input && !output) return;
        if (tcflush(port.fd, input && output ? TCIOFLUSH : input ? TCIFLUSH : TCOFLUSH) < 0) fail("tcflush");
    }

    void closePort(Port &port, bool discard) {
        if (port.fd < 0) return;
        //The output left discarded: a close would wait for it to be sent (up to 30 seconds on Linux)
        if (discard) tcflush(port.fd, TCIOFLUSH);
        close(port.fd);
        port.fd = -1;
    }

    void signalsOf(Port &port, bool &cts, bool &dsr, bool &dcd, bool &ri) {
        int lines = 0;
        if (ioctl(port.fd, TIOCMGET, &lines) < 0) fail("ioctl");
        cts = (lines & TIOCM_CTS) != 0;
        dsr = (lines & TIOCM_DSR) != 0;
        dcd = (lines & TIOCM_CAR) != 0;
        ri = (lines & TIOCM_RNG) != 0;
    }

    void setSignals(Port &port, int dtr, int rts, int brk) {
        int set = 0;
        int clear = 0;
        if (dtr >= 0) (dtr ? set : clear) |= TIOCM_DTR;
        if (rts >= 0) (rts ? set : clear) |= TIOCM_RTS;
        if (set && ioctl(port.fd, TIOCMBIS, &set) < 0) fail("ioctl");
        if (clear && ioctl(port.fd, TIOCMBIC, &clear) < 0) fail("ioctl");
        if (brk >= 0 && ioctl(port.fd, brk ? TIOCSBRK : TIOCCBRK) < 0) fail("ioctl");
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

        /**
         * A property of the port or of the devices above it (the USB device of an adapter)
         */
        CFTypeRef searched(io_object_t service, const char *key) {
            const CFStringRef name = CFStringCreateWithCString(kCFAllocatorDefault, key, kCFStringEncodingUTF8);
            const CFTypeRef value = IORegistryEntrySearchCFProperty(service, kIOServicePlane, name, kCFAllocatorDefault, kIORegistryIterateRecursively | kIORegistryIterateParents);
            CFRelease(name);
            return value;
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
            const CFTypeRef path = IORegistryEntryCreateCFProperty(service, CFSTR(kIOCalloutDeviceKey), kCFAllocatorDefault, 0);
            info.path = stringOf(path);
            if (path) CFRelease(path);
            const char *strings[] = {"USB Serial Number", "USB Vendor Name", "USB Product Name"};
            std::string *targets[] = {&info.serialNumber, &info.manufacturer, &info.product};
            for (int index = 0; index < 3; index++) {
                const CFTypeRef value = searched(service, strings[index]);
                *targets[index] = stringOf(value);
                if (value) CFRelease(value);
            }
            const CFTypeRef vendor = searched(service, "idVendor");
            const CFTypeRef product = searched(service, "idProduct");
            info.vendorId = numberOf(vendor);
            info.productId = numberOf(product);
            if (vendor) CFRelease(vendor);
            if (product) CFRelease(product);
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
            default:
                return "EUNKNOWN";
        }
    }

    std::string messageOf(long code) {
        return std::strerror(static_cast<int>(code));
    }
}

#endif
