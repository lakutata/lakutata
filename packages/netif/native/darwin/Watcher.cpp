//The notifications of macOS: the kernel events of the network (a PF_SYSTEM socket filtered to their class), read by a
//thread of the addon, which a pipe wakes to stop. Of the events only the ones of the interfaces (attached, detached,
//flags, link) and of their addresses count. The routing socket has no message for an interface attached or detached.
#include "../Watcher.h"

#include <net/net_kev.h>
#include <fcntl.h>
#include <poll.h>
#include <sys/ioctl.h>
#include <sys/kern_event.h>
#include <sys/socket.h>
#include <sys/sys_domain.h>
#include <unistd.h>

#include <cerrno>
#include <system_error>
#include <thread>
#include <vector>

namespace netif {

struct Watcher::State {
    int socket = -1;
    int wake[2] = {-1, -1};
    std::thread thread;
};

namespace {

bool counts(const kern_event_msg *event)
{
    if (event->vendor_code != KEV_VENDOR_APPLE || event->kev_class != KEV_NETWORK_CLASS) return false;
    switch (event->kev_subclass) {
        case KEV_INET_SUBCLASS:
            return event->event_code == KEV_INET_NEW_ADDR || event->event_code == KEV_INET_CHANGED_ADDR || event->event_code == KEV_INET_ADDR_DELETED || event->event_code == KEV_INET_SIFNETMASK;
        case KEV_INET6_SUBCLASS:
            return event->event_code == KEV_INET6_NEW_USER_ADDR || event->event_code == KEV_INET6_CHANGED_ADDR || event->event_code == KEV_INET6_ADDR_DELETED || event->event_code == KEV_INET6_NEW_LL_ADDR || event->event_code == KEV_INET6_NEW_RTADV_ADDR;
        case KEV_DL_SUBCLASS:
            return event->event_code == KEV_DL_SIFFLAGS || event->event_code == KEV_DL_SIFMEDIA || event->event_code == KEV_DL_IF_ATTACHED || event->event_code == KEV_DL_IF_DETACHED || event->event_code == KEV_DL_LINK_OFF || event->event_code == KEV_DL_LINK_ON || event->event_code == KEV_DL_LINK_ADDRESS_CHANGED;
        default:
            return false;
    }
}

void closeAll(int socket, const int (&wake)[2])
{
    if (socket >= 0) close(socket);
    for (int descriptor : wake) {
        if (descriptor >= 0) close(descriptor);
    }
}

}

Watcher::Watcher(std::function<void()> changed) : state(std::make_unique<State>())
{
    state->socket = socket(PF_SYSTEM, SOCK_RAW, SYSPROTO_EVENT);
    if (state->socket < 0) throw std::system_error(errno, std::generic_category(), "socket(PF_SYSTEM)");
    kev_request filter{KEV_VENDOR_APPLE, KEV_NETWORK_CLASS, KEV_ANY_SUBCLASS};
    if (ioctl(state->socket, SIOCSKEVFILT, &filter) != 0 || pipe(state->wake) != 0) {
        int error = errno;
        closeAll(state->socket, state->wake);
        state->socket = -1;
        throw std::system_error(error, std::generic_category(), "SIOCSKEVFILT");
    }
    for (int descriptor : {state->socket, state->wake[0], state->wake[1]}) {
        fcntl(descriptor, F_SETFD, FD_CLOEXEC);
        fcntl(descriptor, F_SETFL, fcntl(descriptor, F_GETFL) | O_NONBLOCK);
    }
    State *watched = state.get();
    state->thread = std::thread([watched, changed]() {
        std::vector<char> buffer(8192);
        pollfd descriptors[2] = {{watched->socket, POLLIN, 0}, {watched->wake[0], POLLIN, 0}};
        for (;;) {
            if (poll(descriptors, 2, -1) < 0) {
                if (errno == EINTR) continue;
                return;
            }
            if (descriptors[1].revents) return;
            if (!descriptors[0].revents) continue;
            bool any = false;
            for (;;) {
                ssize_t received = read(watched->socket, buffer.data(), buffer.size());
                if (received < 0) {
                    if (errno == EINTR) continue;
                    if (errno == ENOBUFS) any = true;
                    break;
                }
                //The events of a read, one after the other
                for (ssize_t offset = 0; offset + static_cast<ssize_t>(KEV_MSG_HEADER_SIZE) <= received;) {
                    auto *event = reinterpret_cast<const kern_event_msg *>(buffer.data() + offset);
                    if (event->total_size < KEV_MSG_HEADER_SIZE) break;
                    any = any || counts(event);
                    offset += event->total_size;
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
    closeAll(state->socket, state->wake);
}

}
