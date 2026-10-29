//The notifications of Linux: a netlink socket joined to the groups of the links and of the IPv4 and IPv6 addresses,
//read by a thread of the addon, which a pipe wakes to stop. An overrun of the socket (ENOBUFS) is a change too.
#include "../Watcher.h"
#include "Netlink.h"

#include <fcntl.h>
#include <poll.h>
#include <sys/socket.h>
#include <unistd.h>

#include <cerrno>
#include <system_error>
#include <thread>
#include <vector>

namespace netif {

struct Watcher::State {
    Netlink socket{RTMGRP_LINK | RTMGRP_IPV4_IFADDR | RTMGRP_IPV6_IFADDR};
    int wake[2] = {-1, -1};
    std::thread thread;
};

Watcher::Watcher(std::function<void()> changed) : state(std::make_unique<State>())
{
    if (pipe2(state->wake, O_CLOEXEC | O_NONBLOCK) != 0) throw std::system_error(errno, std::generic_category(), "pipe2");
    State *watched = state.get();
    state->thread = std::thread([watched, changed]() {
        std::vector<char> buffer(65536);
        pollfd descriptors[2] = {{watched->socket.fd(), POLLIN, 0}, {watched->wake[0], POLLIN, 0}};
        for (;;) {
            if (poll(descriptors, 2, -1) < 0) {
                if (errno == EINTR) continue;
                return;
            }
            if (descriptors[1].revents) return;
            if (!descriptors[0].revents) continue;
            bool any = false;
            for (;;) {
                ssize_t received = recv(watched->socket.fd(), buffer.data(), buffer.size(), MSG_DONTWAIT);
                if (received < 0) {
                    if (errno == EINTR) continue;
                    if (errno == ENOBUFS) any = true;
                    break;
                }
                int remaining = static_cast<int>(received);
                for (auto *header = reinterpret_cast<nlmsghdr *>(buffer.data()); NLMSG_OK(header, remaining); header = NLMSG_NEXT(header, remaining)) {
                    uint16_t type = header->nlmsg_type;
                    if (type == RTM_NEWLINK || type == RTM_DELLINK || type == RTM_NEWADDR || type == RTM_DELADDR) any = true;
                }
            }
            if (any) changed();
        }
    });
}

Watcher::~Watcher()
{
    if (state->wake[1] >= 0) {
        char byte = 1;
        while (write(state->wake[1], &byte, 1) < 0 && errno == EINTR) {
        }
    }
    if (state->thread.joinable()) state->thread.join();
    for (int descriptor : state->wake) {
        if (descriptor >= 0) close(descriptor);
    }
}

}
