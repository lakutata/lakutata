//The interfaces of Linux, read by netlink: the dump of the links (name, index, hardware address, flags), then the one of
//the addresses with their flags (a tentative IPv6 address is in its duplicate address detection). getifaddrs() gives no
//flags of the addresses.
#include "../Interfaces.h"
#include "Netlink.h"

#include <linux/if_addr.h>
#include <net/if.h>
#include <sys/socket.h>
#include <unistd.h>

#include <cerrno>
#include <map>
#include <system_error>
#include <utility>

namespace netif {

Netlink::Netlink(uint32_t groups)
{
    descriptor = socket(AF_NETLINK, SOCK_RAW | SOCK_CLOEXEC, NETLINK_ROUTE);
    if (descriptor < 0) throw std::system_error(errno, std::generic_category(), "socket(AF_NETLINK)");
    sockaddr_nl local{};
    local.nl_family = AF_NETLINK;
    local.nl_groups = groups;
    if (bind(descriptor, reinterpret_cast<sockaddr *>(&local), sizeof local) < 0) {
        int error = errno;
        close(descriptor);
        descriptor = -1;
        throw std::system_error(error, std::generic_category(), "bind(AF_NETLINK)");
    }
}

Netlink::~Netlink()
{
    if (descriptor >= 0) close(descriptor);
}

void Netlink::dump(uint16_t type, unsigned char family, const std::function<void(const nlmsghdr *)> &handler)
{
    struct {
        nlmsghdr header;
        rtgenmsg message;
    } request{};
    request.header.nlmsg_len = NLMSG_LENGTH(sizeof(rtgenmsg));
    request.header.nlmsg_type = type;
    request.header.nlmsg_flags = NLM_F_REQUEST | NLM_F_DUMP;
    request.header.nlmsg_seq = ++sequence;
    request.message.rtgen_family = family;
    sockaddr_nl kernel{};
    kernel.nl_family = AF_NETLINK;
    if (sendto(descriptor, &request, request.header.nlmsg_len, 0, reinterpret_cast<sockaddr *>(&kernel), sizeof kernel) < 0) {
        throw std::system_error(errno, std::generic_category(), "send(netlink)");
    }
    std::vector<char> buffer(65536);
    for (;;) {
        ssize_t received = recv(descriptor, buffer.data(), buffer.size(), 0);
        if (received < 0) {
            if (errno == EINTR) continue;
            throw std::system_error(errno, std::generic_category(), "recv(netlink)");
        }
        int remaining = static_cast<int>(received);
        for (auto *header = reinterpret_cast<nlmsghdr *>(buffer.data()); NLMSG_OK(header, remaining); header = NLMSG_NEXT(header, remaining)) {
            if (header->nlmsg_seq != sequence) continue;
            if (header->nlmsg_type == NLMSG_DONE) return;
            if (header->nlmsg_type == NLMSG_ERROR) {
                auto *error = static_cast<const nlmsgerr *>(NLMSG_DATA(header));
                if (error->error == 0) continue;
                throw std::system_error(-error->error, std::generic_category(), "netlink dump");
            }
            handler(header);
        }
    }
}

std::vector<Interface> listInterfaces()
{
    Netlink netlink;
    std::vector<Interface> interfaces;
    std::map<uint32_t, size_t> positions;
    netlink.dump(RTM_GETLINK, AF_UNSPEC, [&](const nlmsghdr *header) {
        if (header->nlmsg_type != RTM_NEWLINK) return;
        auto *info = static_cast<const ifinfomsg *>(NLMSG_DATA(header));
        Interface entry;
        entry.index = static_cast<uint32_t>(info->ifi_index);
        entry.up = info->ifi_flags & IFF_UP;
        entry.running = info->ifi_flags & IFF_RUNNING;
        entry.loopback = info->ifi_flags & IFF_LOOPBACK;
        int length = static_cast<int>(IFLA_PAYLOAD(header));
        for (auto *attribute = IFLA_RTA(info); RTA_OK(attribute, length); attribute = RTA_NEXT(attribute, length)) {
            if (attribute->rta_type == IFLA_IFNAME) {
                entry.name = static_cast<const char *>(RTA_DATA(attribute));
            } else if (attribute->rta_type == IFLA_ADDRESS) {
                entry.mac = macText(static_cast<const unsigned char *>(RTA_DATA(attribute)), RTA_PAYLOAD(attribute));
            }
        }
        positions[entry.index] = interfaces.size();
        interfaces.push_back(std::move(entry));
    });
    netlink.dump(RTM_GETADDR, AF_UNSPEC, [&](const nlmsghdr *header) {
        if (header->nlmsg_type != RTM_NEWADDR) return;
        auto *info = static_cast<const ifaddrmsg *>(NLMSG_DATA(header));
        if (info->ifa_family != AF_INET && info->ifa_family != AF_INET6) return;
        auto position = positions.find(info->ifa_index);
        if (position == positions.end()) return;
        const void *local = nullptr;
        const void *address = nullptr;
        uint32_t flags = info->ifa_flags;
        int length = static_cast<int>(IFA_PAYLOAD(header));
        for (auto *attribute = IFA_RTA(info); RTA_OK(attribute, length); attribute = RTA_NEXT(attribute, length)) {
            if (attribute->rta_type == IFA_LOCAL) local = RTA_DATA(attribute);
            else if (attribute->rta_type == IFA_ADDRESS) address = RTA_DATA(attribute);
#ifdef IFA_FLAGS
            else if (attribute->rta_type == IFA_FLAGS) flags = *static_cast<const uint32_t *>(RTA_DATA(attribute));
#endif
        }
        //IPv4: the local address is IFA_LOCAL (IFA_ADDRESS is the peer of a point-to-point link); IPv6: IFA_ADDRESS
        const void *bytes = info->ifa_family == AF_INET && local ? local : (address ? address : local);
        if (!bytes) return;
        Address entry;
        entry.family = info->ifa_family == AF_INET ? 4 : 6;
        entry.address = addressText(info->ifa_family, bytes);
        entry.prefixLength = info->ifa_prefixlen;
        //An optimistic address (RFC 4429) is usable while its detection runs
        entry.tentative = (flags & IFA_F_DADFAILED) || ((flags & IFA_F_TENTATIVE) && !(flags & IFA_F_OPTIMISTIC));
        auto *octets = static_cast<const unsigned char *>(bytes);
        if (entry.family == 6 && octets[0] == 0xfe && (octets[1] & 0xc0) == 0x80) entry.scopeId = info->ifa_index;
        interfaces[position->second].addresses.push_back(std::move(entry));
    });
    return interfaces;
}

}
