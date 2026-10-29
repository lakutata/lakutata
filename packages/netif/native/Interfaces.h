//The network interfaces of the machine, read from the system: every interface, the ones without an address too, with
//its state and its unicast addresses. Each system has its own source file (linux/, darwin/, windows/).
#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace netif {

//A unicast address of an interface
struct Address {
    //The address as text (an IPv6 address without its scope)
    std::string address;
    //4 or 6
    int family = 4;
    unsigned prefixLength = 0;
    //Not usable yet: an IPv6 address in its duplicate address detection, or one that failed it
    bool tentative = false;
    //IPv6: the scope of the address, the index of its interface for a link-local one, 0 for a global one (Windows also
    //gives the site of a site-local one)
    uint32_t scopeId = 0;
};

struct Interface {
    std::string name;
    uint32_t index = 0;
    //The hardware address (aa:bb:cc:dd:ee:ff), empty when the interface has none
    std::string mac;
    //Enabled (its administrative state)
    bool up = false;
    //Connected: its link is up
    bool running = false;
    bool loopback = false;
    std::vector<Address> addresses;
};

//Every interface of the machine; a std::system_error when the system cannot be read
std::vector<Interface> listInterfaces();

//The text of an address of the given family (AF_INET or AF_INET6) from its bytes
std::string addressText(int family, const void *bytes);

//The text of a hardware address of 6 bytes, empty for none (any other length, or all zeros)
std::string macText(const unsigned char *bytes, size_t length);

}
