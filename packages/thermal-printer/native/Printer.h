#ifndef LAKUTATA_THERMAL_PRINTER_H
#define LAKUTATA_THERMAL_PRINTER_H

#include <atomic>
#include <cstdint>
#include <string>
#include <vector>

namespace printer {

    /**
     * A failure: the error of the system (an IOReturn of macOS, an error of Windows), the call that failed, a message
     * in place of the system's, a name in place of the one of the code
     */
    struct Failure {
        long code = 0;
        std::string syscall;
        std::string detail;
        std::string name;
    };

    /**
     * A USB printer (an interface of the printer class), as listed
     */
    struct UsbInfo {
        //The path of its printer interface (Windows)
        std::string path;
        int vendorId = -1;
        int productId = -1;
        std::string serialNumber;
        std::string manufacturer;
        std::string product;
        //The IEEE 1284 id it reports
        std::string deviceId;
        //Its location on the bus (macOS)
        long long locationId = -1;
    };

    /**
     * A USB printer to open: its path (Windows), or its ids (macOS)
     */
    struct UsbTarget {
        std::string path;
        int vendorId = -1;
        int productId = -1;
        std::string serialNumber;
    };

    /**
     * An open USB printer of the platform
     */
    struct UsbDevice;

    void listUsb(std::vector<UsbInfo> &printers);

    UsbDevice *openUsb(const UsbTarget &target);

    /**
     * Write all of the data, failing with ETIMEDOUT once the printer took nothing for stallMs milliseconds (0: no limit),
     * with ECANCELED once abortUsb is called
     */
    void writeUsb(UsbDevice *device, const uint8_t *data, size_t length, int64_t stallMs);

    /**
     * Stop the write running (from another thread)
     */
    void abortUsb(UsbDevice *device);

    void closeUsb(UsbDevice *device);

    /**
     * A printer of the spooler of Windows
     */
    struct QueueInfo {
        std::string name;
        std::string driver;
        std::string port;
        bool isDefault = false;
    };

    void listQueues(std::vector<QueueInfo> &queues);

    /**
     * A raw document sent to a printer of the spooler of Windows
     */
    void printRaw(const std::string &name, const uint8_t *data, size_t length, const std::string &document);

    std::string nameOf(long code);

    std::string messageOf(long code);
}

#endif
