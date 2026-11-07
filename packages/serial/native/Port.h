#ifndef LAKUTATA_SERIAL_PORT_H
#define LAKUTATA_SERIAL_PORT_H

#include <atomic>
#include <cstdint>
#include <string>
#include <vector>

#ifdef _WIN32
#include <windows.h>
#endif

namespace serial {

    /**
     * A failure of the system: its error (errno, or the error of Windows) and the call that failed
     */
    struct Failure {
        long code = 0;
        std::string syscall;
        std::string detail;
    };

    /**
     * The settings of the line
     */
    struct LineOptions {
        uint32_t baudRate = 9600;
        int dataBits = 8;
        //1, 15 (1.5, Windows only) or 2
        int stopBits = 1;
        //'n'one, 'e'ven, 'o'dd, 'm'ark, 's'pace
        char parity = 'n';
        //0 none, 1 RTS/CTS, 2 XON/XOFF
        int flowControl = 0;
    };

    /**
     * An open port: its descriptor (its handle on Windows), closed once its operations are done
     */
    struct Port {
#ifdef _WIN32
        HANDLE handle = INVALID_HANDLE_VALUE;
#else
        int fd = -1;
#endif
        std::string path;
        //Set by the closing: the operations running end at their next slice
        std::atomic<bool> closing{false};
        //The operations queued or running, which the closing waits for
        std::atomic<int> busy{0};
        std::atomic<bool> closed{false};
    };

    /**
     * A port of the system, as listed
     */
    struct PortInfo {
        std::string path;
        int vendorId = -1;
        int productId = -1;
        std::string serialNumber;
        std::string manufacturer;
        std::string product;
    };

    //The operations of the platform: each throws a Failure

    void openPort(Port &port, const LineOptions &options, bool exclusive);

    void configurePort(Port &port, const LineOptions &options);

    /**
     * Write within a slice of about 100 ms: the bytes written (0 when the port takes none in that time)
     */
    size_t writeSlice(Port &port, const uint8_t *data, size_t length);

    /**
     * Read within a slice of about 100 ms: the bytes read (0 when none came in that time)
     */
    size_t readSlice(Port &port, uint8_t *data, size_t length);

    /**
     * Wait for the output to be sent, ending early when the port is closed
     */
    void drainPort(Port &port);

    void flushPort(Port &port, bool input, bool output);

    void closePort(Port &port, bool discard);

    /**
     * The modem lines: cts, dsr, dcd, ri
     */
    void signalsOf(Port &port, bool &cts, bool &dsr, bool &dcd, bool &ri);

    /**
     * Set the lines given (-1 leaves one as it is)
     */
    void setSignals(Port &port, int dtr, int rts, int brk);

    /**
     * The ports of the system (macOS and Windows; Linux lists them in JavaScript)
     */
    bool listPorts(std::vector<PortInfo> &ports);

    /**
     * The name of an error (ENOENT…) and its message
     */
    std::string nameOf(long code);

    std::string messageOf(long code);

#ifdef __linux__
    /**
     * A speed termios has no constant for: termios2 (BOTHER), in a file of its own (its headers clash with termios.h)
     */
    int setLinuxSpeed(int fd, uint32_t speed);
#endif
}

#endif
