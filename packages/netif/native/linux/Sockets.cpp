//The sockets of Linux bound to an interface (SO_BINDTODEVICE, by its name: SO_BINDTOIFINDEX needs Linux 5.0) and their
//multicast groups. Linux receives the packets of an address through any interface: there is no strong host model to
//rely on, the binding is what refuses the other interfaces.
#include "../Sockets.h"

#include <arpa/inet.h>
#include <net/if.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>

#include <cerrno>
#include <cstring>
#include <system_error>

namespace netif {

namespace {

[[noreturn]] void fail(int fd, const char *call)
{
    int error = errno;
    if (fd >= 0) close(fd);
    throw std::system_error(error, std::generic_category(), call);
}

}

BoundSocket bindToInterface(const std::string &name, int family, bool stream, uint16_t port, int backlog)
{
    int domain = family == 6 ? AF_INET6 : AF_INET;
    int fd = socket(domain, (stream ? SOCK_STREAM : SOCK_DGRAM) | SOCK_CLOEXEC, 0);
    if (fd < 0) fail(-1, "socket");
    int on = 1;
    //As Node.js does for its TCP servers: a port in TIME_WAIT can be listened on again
    if (stream && setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &on, sizeof on) != 0) fail(fd, "setsockopt(SO_REUSEADDR)");
    if (family == 6 && setsockopt(fd, IPPROTO_IPV6, IPV6_V6ONLY, &on, sizeof on) != 0) fail(fd, "setsockopt(IPV6_V6ONLY)");
    if (setsockopt(fd, SOL_SOCKET, SO_BINDTODEVICE, name.c_str(), static_cast<socklen_t>(name.size())) != 0) fail(fd, "setsockopt(SO_BINDTODEVICE)");
    sockaddr_storage address{};
    socklen_t length;
    if (family == 6) {
        auto *in6 = reinterpret_cast<sockaddr_in6 *>(&address);
        in6->sin6_family = AF_INET6;
        in6->sin6_addr = in6addr_any;
        in6->sin6_port = htons(port);
        length = sizeof(sockaddr_in6);
    } else {
        auto *in4 = reinterpret_cast<sockaddr_in *>(&address);
        in4->sin_family = AF_INET;
        in4->sin_addr.s_addr = htonl(INADDR_ANY);
        in4->sin_port = htons(port);
        length = sizeof(sockaddr_in);
    }
    if (bind(fd, reinterpret_cast<sockaddr *>(&address), length) != 0) fail(fd, "bind");
    if (stream && listen(fd, backlog) != 0) fail(fd, "listen");
    length = sizeof address;
    if (getsockname(fd, reinterpret_cast<sockaddr *>(&address), &length) != 0) fail(fd, "getsockname");
    BoundSocket bound;
    bound.fd = fd;
    bound.port = ntohs(family == 6 ? reinterpret_cast<sockaddr_in6 *>(&address)->sin6_port : reinterpret_cast<sockaddr_in *>(&address)->sin_port);
    return bound;
}

void membership(int fd, const std::string &group, uint32_t index, bool join)
{
    group_req request{};
    request.gr_interface = index;
    int level;
    if (inet_pton(AF_INET, group.c_str(), &reinterpret_cast<sockaddr_in *>(&request.gr_group)->sin_addr) == 1) {
        reinterpret_cast<sockaddr_in *>(&request.gr_group)->sin_family = AF_INET;
        level = IPPROTO_IP;
    } else if (inet_pton(AF_INET6, group.c_str(), &reinterpret_cast<sockaddr_in6 *>(&request.gr_group)->sin6_addr) == 1) {
        reinterpret_cast<sockaddr_in6 *>(&request.gr_group)->sin6_family = AF_INET6;
        level = IPPROTO_IPV6;
    } else {
        throw std::system_error(EINVAL, std::generic_category(), "inet_pton");
    }
    if (setsockopt(fd, level, join ? MCAST_JOIN_GROUP : MCAST_LEAVE_GROUP, &request, sizeof request) != 0) {
        throw std::system_error(errno, std::generic_category(), join ? "setsockopt(MCAST_JOIN_GROUP)" : "setsockopt(MCAST_LEAVE_GROUP)");
    }
}

//Linux has no strong host model: the binding decides
std::optional<WeakReception> weakReception(uint32_t, int)
{
    return WeakReception{std::string(), std::string("the weak host model of Linux")};
}

}
