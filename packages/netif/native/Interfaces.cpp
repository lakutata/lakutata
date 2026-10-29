//The parts of the reading of the interfaces common to every system
#include "Interfaces.h"

#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
#else
#include <arpa/inet.h>
#include <sys/socket.h>
#endif

#include <cstdio>

namespace netif {

std::string addressText(int family, const void *bytes)
{
    char text[64] = {0};
    if (!inet_ntop(family, const_cast<void *>(bytes), text, sizeof text)) return std::string();
    return std::string(text);
}

std::string macText(const unsigned char *bytes, size_t length)
{
    if (length != 6) return std::string();
    bool zero = true;
    for (size_t index = 0; index < length; index++) zero = zero && bytes[index] == 0;
    if (zero) return std::string();
    char text[18];
    std::snprintf(text, sizeof text, "%02x:%02x:%02x:%02x:%02x:%02x", bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5]);
    return std::string(text);
}

}
