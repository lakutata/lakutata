#ifndef LAKUTATA_SERIAL_PORT_H
#define LAKUTATA_SERIAL_PORT_H

#include <atomic>
#include <cstdint>
#include <deque>
#include <functional>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#ifdef _WIN32
#include <windows.h>
#endif

namespace serial {

    /**
     * A failure: the error of the system (errno, or the error of Windows), the call that failed, a message in place of
     * the system's, a name in place of the one of the code, and whether the device is gone
     */
    struct Failure {
        long code = 0;
        std::string syscall;
        std::string detail;
        std::string name;
        bool disconnected = false;
    };

    /**
     * The settings of the line, and how long the output may stop before the writes and the drains fail
     */
    struct LineOptions {
        uint32_t baudRate = 9600;
        int dataBits = 8;
        //1, 15 (1.5, Windows only) or 2
        int stopBits = 1;
        //'n'one, 'e'ven, 'o'dd, 'm'ark, 's'pace
        char parity = 'n';
        //0 none, 1 RTS/CTS, 2 XON/XOFF, 3 DTR/DSR
        int flowControl = 0;
        //Milliseconds without progress of the output before a write fails (0: no limit)
        int64_t stallTimeout = 0;
    };

    enum class CommandKind {
        Write, Drain, Configure, Flush, Signals, SetSignals, Read, Close
    };

    /**
     * A request of JavaScript to the thread of a port. Writes, drains and configurations run in their order (a
     * configuration waits for the writes before it); the others run at once
     */
    struct Command {
        CommandKind kind = CommandKind::Read;
        uint32_t id = 0;
        std::vector<uint8_t> data;
        LineOptions options;
        bool input = false;
        bool output = false;
        int dtr = -1;
        int rts = -1;
        int brk = -1;
        bool wanted = false;
        bool discard = false;
        //Drain: milliseconds without progress (0: none), and an absolute limit on the steady clock in milliseconds (0: none)
        int64_t stall = 0;
        int64_t deadline = 0;
    };

    enum class EventKind {
        Opened, Result, Failed, Data, Fatal, Closed
    };

    /**
     * What the thread of a port tells JavaScript: an open port, a request done or failed, data received, the port dead
     * (the device gone), the port closed
     */
    struct Event {
        EventKind kind = EventKind::Result;
        uint32_t id = 0;
        std::vector<uint8_t> data;
        Failure failure;
        bool hasSignals = false;
        bool cts = false;
        bool dsr = false;
        bool dcd = false;
        bool ri = false;
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
        //A port of a paired Bluetooth device (its serial port profile): the address of the device
        std::string bluetoothAddress;
    };

    /**
     * An open port: its device and the thread that owns it. JavaScript queues commands; the thread opens the device,
     * runs them, reads while JavaScript wants data, and tells what happened through post
     */
    struct Port {
        std::string path;
        LineOptions options;
        bool exclusive = true;
        //A Bluetooth device reached by an RFCOMM socket (Linux) in place of a port: its address and channel
        bool rfcomm = false;
        std::string address;
        int channel = 1;
        //The events for JavaScript (a thread-safe function of the addon)
        std::function<void(Event *)> post;
        std::thread thread;
        std::mutex mutex;
        std::deque<Command> commands;
        std::atomic<bool> finished{false};
        //The environment ended without waiting for the thread: its events go nowhere
        std::mutex postMutex;
        bool silenced = false;
#ifdef _WIN32
        HANDLE handle = INVALID_HANDLE_VALUE;
        HANDLE wakeEvent = nullptr;
        //The levels of the output lines, written into every configuration
        bool dtr = true;
        bool rts = true;
        COMMTIMEOUTS savedTimeouts = {};
        bool timeoutsSaved = false;
#else
        int fd = -1;
        int wakeRead = -1;
        int wakeWrite = -1;
        bool locked = false;
#endif

        Port();

        ~Port();

        /**
         * Queue a command and wake the thread
         */
        void push(Command command);

        void wake();
    };

    /**
     * The body of the thread of a port (one for each platform): open the device, run the commands, close it
     */
    void run(Port &port);

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

    /**
     * The output speed the kernel holds (termios2), 0 when it cannot tell
     */
    uint32_t linuxSpeed(int fd);
#endif
}

#endif
