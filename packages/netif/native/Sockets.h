//The sockets bound to an interface (Linux: SO_BINDTODEVICE) and their multicast groups, and whether the system refuses
//the packets reaching the addresses of an interface through another one (the strong host model: Windows, macOS).
#pragma once

#include <cstdint>
#include <optional>
#include <string>

namespace netif {

struct BoundSocket {
    int fd = -1;
    uint16_t port = 0;
};

//A socket of the family (4, 6) bound to the interface of the name, on the port of every address of the family (0: one
//the system chooses); a TCP socket listening already. IPv6 only for 6 (IPV6_V6ONLY). A std::system_error when the system
//refuses (EPERM: binding to an interface needs CAP_NET_RAW before Linux 5.7; ENODEV: no such interface; EADDRINUSE…).
BoundSocket bindToInterface(const std::string &name, int family, bool stream, uint16_t port, int backlog);

//The socket joins (or leaves) the multicast group on the interface of the index (MCAST_JOIN_GROUP: by its index, the
//interface may have no address)
void membership(int fd, const std::string &group, uint32_t index, bool join);

//A setting that makes the system accept, through another interface, packets for the addresses of the interface of the
//index: the interface and the setting
struct WeakReception {
    std::string interfaceName;
    std::string setting;
};

//The first setting of the family (4, 6) that makes the system accept, through another interface, the packets for the
//addresses of the interface of the index; none when it refuses them
std::optional<WeakReception> weakReception(uint32_t index, int family);

}
