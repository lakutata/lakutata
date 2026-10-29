//macOS: no socket of an interface (IP_BOUND_IF only chooses the interface the packets leave by); the strong host model
//of the system (net.inet.ip.check_interface = 2, its IPv6 counterpart) refuses the packets of an address that come
//through another interface, as long as the forwarding of the family is off (XNU skips the check while it forwards).
#include "../Sockets.h"

#include <sys/sysctl.h>

#include <cerrno>
#include <system_error>

namespace netif {

namespace {

int setting(const char *name)
{
    int value = 0;
    size_t size = sizeof value;
    if (sysctlbyname(name, &value, &size, nullptr, 0) != 0) return -1;
    return value;
}

}

BoundSocket bindToInterface(const std::string &, int, bool, uint16_t, int)
{
    throw std::system_error(ENOTSUP, std::generic_category(), "bind to an interface");
}

void membership(int, const std::string &, uint32_t, bool)
{
    throw std::system_error(ENOTSUP, std::generic_category(), "membership");
}

std::optional<WeakReception> weakReception(uint32_t, int family)
{
    const char *check = family == 6 ? "net.inet6.ip6.check_interface" : "net.inet.ip.check_interface";
    const char *forwarding = family == 6 ? "net.inet6.ip6.forwarding" : "net.inet.ip.forwarding";
    if (setting(check) != 2) return WeakReception{std::string(), std::string(check)};
    if (setting(forwarding) != 0) return WeakReception{std::string(), std::string(forwarding)};
    return std::nullopt;
}

}
