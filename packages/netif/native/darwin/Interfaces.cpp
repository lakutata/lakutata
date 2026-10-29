//The interfaces of macOS, read by getifaddrs(): the link entry of each interface (name, index, hardware address, flags),
//then its addresses. The link state comes from the media of the interface (SIOCGIFMEDIA) where it has one (IFF_RUNNING
//stays set on an Ethernet port without its cable), the duplicate address detection of an IPv6 address from its flags
//(SIOCGIFAFLAG_IN6).
#include "../Interfaces.h"

#include <ifaddrs.h>
#include <net/if.h>
#include <net/if_dl.h>
#include <net/if_media.h>
#include <netinet/in.h>
#include <netinet6/in6_var.h>
#include <sys/ioctl.h>
#include <sys/socket.h>
#include <unistd.h>

#include <cerrno>
#include <cstring>
#include <map>
#include <system_error>
#include <utility>

namespace netif {

namespace {

const char *const MASKED_MAC = "02:00:00:00:00:00";

class Descriptor {
public:
    explicit Descriptor(int family) : fd(socket(family, SOCK_DGRAM, 0))
    {
    }

    ~Descriptor()
    {
        if (fd >= 0) close(fd);
    }

    Descriptor(const Descriptor &) = delete;

    Descriptor &operator=(const Descriptor &) = delete;

    const int fd;
};

unsigned prefixLength(const sockaddr *netmask)
{
    if (!netmask) return 0;
    const unsigned char *bytes = nullptr;
    size_t length = 0;
    if (netmask->sa_family == AF_INET) {
        bytes = reinterpret_cast<const unsigned char *>(&reinterpret_cast<const sockaddr_in *>(netmask)->sin_addr);
        length = 4;
    } else if (netmask->sa_family == AF_INET6) {
        bytes = reinterpret_cast<const unsigned char *>(&reinterpret_cast<const sockaddr_in6 *>(netmask)->sin6_addr);
        length = 16;
    } else {
        return 0;
    }
    unsigned bits = 0;
    for (size_t index = 0; index < length; index++) bits += static_cast<unsigned>(__builtin_popcount(bytes[index]));
    return bits;
}

//The link is up: its media says so, or (no media) the interface runs
bool linkActive(const Descriptor &probe, const char *name, unsigned int flags)
{
    if (probe.fd >= 0) {
        ifmediareq media{};
        std::strncpy(media.ifm_name, name, sizeof media.ifm_name - 1);
        if (ioctl(probe.fd, SIOCGIFMEDIA, &media) == 0 && (media.ifm_status & IFM_AVALID)) return media.ifm_status & IFM_ACTIVE;
    }
    return flags & IFF_RUNNING;
}

bool tentative(const Descriptor &probe, const char *name, const sockaddr_in6 *address)
{
    if (probe.fd < 0) return false;
    in6_ifreq request{};
    std::strncpy(request.ifr_name, name, sizeof request.ifr_name - 1);
    request.ifr_addr = *address;
    if (ioctl(probe.fd, SIOCGIFAFLAG_IN6, &request) != 0) return false;
    int flags = request.ifr_ifru.ifru_flags6;
    if (flags & IN6_IFF_DUPLICATED) return true;
    return (flags & IN6_IFF_TENTATIVE) && !(flags & IN6_IFF_OPTIMISTIC);
}

}

std::vector<Interface> listInterfaces()
{
    ifaddrs *entries = nullptr;
    if (getifaddrs(&entries) != 0) throw std::system_error(errno, std::generic_category(), "getifaddrs");
    Descriptor probe4(AF_INET);
    Descriptor probe6(AF_INET6);
    std::vector<Interface> interfaces;
    std::map<std::string, size_t> positions;
    auto at = [&](const ifaddrs *entry) -> Interface & {
        auto position = positions.find(entry->ifa_name);
        if (position != positions.end()) return interfaces[position->second];
        Interface created;
        created.name = entry->ifa_name;
        created.index = if_nametoindex(entry->ifa_name);
        created.up = entry->ifa_flags & IFF_UP;
        created.loopback = entry->ifa_flags & IFF_LOOPBACK;
        created.running = linkActive(probe4, entry->ifa_name, entry->ifa_flags);
        positions[created.name] = interfaces.size();
        interfaces.push_back(std::move(created));
        return interfaces.back();
    };
    for (const ifaddrs *entry = entries; entry; entry = entry->ifa_next) {
        if (!entry->ifa_name) continue;
        Interface &owner = at(entry);
        if (!entry->ifa_addr) continue;
        if (entry->ifa_addr->sa_family == AF_LINK) {
            auto *link = reinterpret_cast<const sockaddr_dl *>(entry->ifa_addr);
            if (link->sdl_index) owner.index = link->sdl_index;
            owner.mac = macText(reinterpret_cast<const unsigned char *>(LLADDR(link)), link->sdl_alen);
            //Newer macOS (27 at least) gives the processes without an entitlement 02:00:00:00:00:00 for every interface in
            //place of its hardware address (os.networkInterfaces() too): no address then
            if (owner.mac == MASKED_MAC) owner.mac.clear();
        } else if (entry->ifa_addr->sa_family == AF_INET) {
            Address address;
            address.family = 4;
            address.address = addressText(AF_INET, &reinterpret_cast<const sockaddr_in *>(entry->ifa_addr)->sin_addr);
            address.prefixLength = prefixLength(entry->ifa_netmask);
            owner.addresses.push_back(std::move(address));
        } else if (entry->ifa_addr->sa_family == AF_INET6) {
            sockaddr_in6 socketAddress = *reinterpret_cast<const sockaddr_in6 *>(entry->ifa_addr);
            Address address;
            address.family = 6;
            address.prefixLength = prefixLength(entry->ifa_netmask);
            address.tentative = tentative(probe6, entry->ifa_name, &socketAddress);
            //A link-local address carries its scope in its second 16 bits inside the kernel (KAME): removed from the text
            unsigned char *octets = socketAddress.sin6_addr.s6_addr;
            if (octets[0] == 0xfe && (octets[1] & 0xc0) == 0x80) {
                octets[2] = 0;
                octets[3] = 0;
                address.scopeId = owner.index;
            }
            address.address = addressText(AF_INET6, &socketAddress.sin6_addr);
            owner.addresses.push_back(std::move(address));
        }
    }
    freeifaddrs(entries);
    return interfaces;
}

}
