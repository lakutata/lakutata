#include "NodeHost.h"

#include <cerrno>
#include <chrono>
#include <condition_variable>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <mutex>
#include <pthread.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <unistd.h>
#include <fcntl.h>

#ifdef __APPLE__
#include <libgen.h>
#include <mach-o/dyld.h>
#endif
#ifdef __OHOS__
#include <dlfcn.h>
#else
extern "C" int lakutata_node_run(int argc, char **argv);
#endif

namespace lakutata {

static std::mutex lock;
static std::condition_variable pausedChanged;

/**
 * The directory of the Node.js project of the application
 */
static std::string projectDirectory() {
    const char *project = getenv("LAKUTATA_NODE_PROJECT");
    if (project && *project) return project;
#if defined(__APPLE__)
    //The bundle of the application: nodejs next to its executable
    char path[4096];
    uint32_t size = sizeof path;
    if (_NSGetExecutablePath(path, &size) == 0) return std::string(dirname(path)) + "/nodejs";
    return "nodejs";
#elif defined(__OHOS__)
    //The copy written while developing (lakutata mobile deploy harmony: the resfile of the HAP cannot be written) while
    //it is on, else the one of the HAP: lakutata mobile run harmony turns it off (the files of the application cannot be
    //removed from the computer, only written)
    std::ifstream development("/data/storage/el2/base/files/nodejs-dev/.development");
    std::string state;
    development >> state;
    struct stat info;
    if (state == "on" && stat("/data/storage/el2/base/files/nodejs-dev/main.js", &info) == 0) return "/data/storage/el2/base/files/nodejs-dev";
    return "/data/storage/el1/bundle/entry/resources/resfile/nodejs";
#else
    return "nodejs";
#endif
}

NodeHost &NodeHost::instance() {
    static NodeHost host;
    return host;
}

std::string NodeHost::start(std::vector<std::pair<std::string, std::string>> environment) {
    std::lock_guard<std::mutex> guard(lock);
    if (started_) return "already started";
    int pair[2];
    if (socketpair(AF_UNIX, SOCK_STREAM, 0, pair) != 0) return std::string("socketpair failed: ") + strerror(errno);
#ifdef __APPLE__
    int on = 1;
    setsockopt(pair[0], SOL_SOCKET, SO_NOSIGPIPE, &on, sizeof on);
#endif
    //Node.js gets a copy of its end: the host shuts its own down when Node.js ends, whatever Node.js did with the copy
    int nodeCopy = dup(pair[1]);
    fcntl(pair[0], F_SETFD, FD_CLOEXEC);
    fcntl(pair[1], F_SETFD, FD_CLOEXEC);
    fd_ = pair[0];
    nodeEnd_ = pair[1];
    setenv("LAKUTATA_NODE_FD", std::to_string(nodeCopy).c_str(), 1);
    setenv("UV_USE_IO_URING", "0", 1);
#ifdef __OHOS__
    //The temporary directory of the system cannot be written; the native tree of the project is embedded in it (the
    //resources of the HAP leave out the files starting with a dot) and extracted into the cache of the application
    setenv("TMPDIR", "/data/storage/el2/base/cache", 0);
    setenv("LAKUTATA_NATIVE_DIR", "/data/storage/el2/base/cache/lakutata", 0);
#endif
    for (auto &variable : environment) setenv(variable.first.c_str(), variable.second.c_str(), 1);
    if (args_.empty()) {
#ifdef __OHOS__
        //The W^X policy of HarmonyOS refuses the code V8 compiles
        args_ = {"node", "--jitless", projectDirectory() + "/main.js"};
#else
        args_ = {"node", projectDirectory() + "/main.js"};
#endif
    }
    started_ = true;
    pthread_t reader;
    pthread_create(&reader, nullptr, readLoop, this);
    pthread_detach(reader);
    //Node.js and V8 want a large stack
    pthread_attr_t attributes;
    pthread_attr_init(&attributes);
    pthread_attr_setstacksize(&attributes, 16 * 1024 * 1024);
    pthread_attr_setdetachstate(&attributes, PTHREAD_CREATE_DETACHED);
    pthread_t node;
    pthread_create(&node, &attributes, runNode, this);
    pthread_attr_destroy(&attributes);
    return "started";
}

void NodeHost::send(const std::string &line) {
    std::lock_guard<std::mutex> guard(lock);
    if (!started_ || fd_ < 0) return;
    std::string data = line + "\n";
    for (size_t written = 0; written < data.size();) {
#ifdef __APPLE__
        ssize_t n = write(fd_, data.data() + written, data.size() - written);
#else
        ssize_t n = ::send(fd_, data.data() + written, data.size() - written, MSG_NOSIGNAL);
#endif
        if (n <= 0) break;
        written += static_cast<size_t>(n);
    }
}

void NodeHost::listen(Listener listener) {
    std::vector<std::string> pending;
    {
        std::lock_guard<std::mutex> guard(lock);
        listener_ = listener;
        pending.swap(pending_);
    }
    for (auto &line : pending) listener(line);
}

bool NodeHost::pause(int timeout) {
    unsigned answered;
    {
        std::lock_guard<std::mutex> guard(lock);
        if (!started_) return false;
        answered = paused_;
    }
    send("{\"type\":\"pause\"}");
    if (timeout <= 0) return false;
    std::unique_lock<std::mutex> guard(lock);
    return pausedChanged.wait_for(guard, std::chrono::milliseconds(timeout), [this, answered] {
        return paused_ != answered || !started_;
    }) && paused_ != answered;
}

void NodeHost::resume() {
    send("{\"type\":\"resume\"}");
}

void NodeHost::deliver(std::string line) {
    Listener listener;
    {
        std::lock_guard<std::mutex> guard(lock);
        if (!listener_) {
            pending_.push_back(std::move(line));
            return;
        }
        listener = listener_;
    }
    listener(std::move(line));
}

void *NodeHost::readLoop(void *data) {
    NodeHost *host = static_cast<NodeHost *>(data);
    int fd;
    {
        std::lock_guard<std::mutex> guard(lock);
        fd = host->fd_;
    }
    std::string buffer;
    char chunk[4096];
    for (;;) {
        ssize_t n = read(fd, chunk, sizeof chunk);
        if (n <= 0) break;
        buffer.append(chunk, static_cast<size_t>(n));
        for (size_t at = buffer.find('\n'); at != std::string::npos; at = buffer.find('\n')) {
            std::string line = buffer.substr(0, at);
            buffer.erase(0, at + 1);
            //The answer to a pause is the host's
            if (line == "{\"type\":\"paused\"}") {
                std::lock_guard<std::mutex> guard(lock);
                host->paused_++;
                pausedChanged.notify_all();
                continue;
            }
            host->deliver(std::move(line));
        }
    }
    //The end of the stream comes once Node.js ended (runNode shuts its end down): the exit follows its last lines
    int code;
    {
        std::lock_guard<std::mutex> guard(lock);
        close(fd);
        host->fd_ = -1;
        code = host->exitCode_;
        host->started_ = false;
        pausedChanged.notify_all();
    }
    host->deliver("{\"type\":\"exit\",\"code\":" + std::to_string(code) + "}");
    return nullptr;
}

void *NodeHost::runNode(void *data) {
    NodeHost *host = static_cast<NodeHost *>(data);
    //The arguments in one block, as libuv expects them; the block stays (libuv keeps pointers into it)
    size_t size = 0;
    for (auto &arg : host->args_) size += arg.size() + 1;
    char *block = static_cast<char *>(malloc(size));
    std::vector<char *> argv;
    char *at = block;
    for (auto &arg : host->args_) {
        memcpy(at, arg.c_str(), arg.size() + 1);
        argv.push_back(at);
        at += arg.size() + 1;
    }
    argv.push_back(nullptr);
    int code;
#ifdef __OHOS__
    //The runtime links libnode.so and is loaded on its own (RTLD_LOCAL: the addons find libnode.so by its name)
    static void *runtime = dlopen("liblakutata_node.so", RTLD_NOW | RTLD_LOCAL);
    using Run = int (*)(int, char **);
    Run run = runtime ? reinterpret_cast<Run>(dlsym(runtime, "lakutata_node_run")) : nullptr;
    if (!run) {
        host->deliver(std::string("{\"type\":\"error\",\"message\":\"") + dlerror() + "\"}");
        code = 1;
    } else {
        code = run(static_cast<int>(host->args_.size()), argv.data());
    }
#else
    code = lakutata_node_run(static_cast<int>(host->args_.size()), argv.data());
#endif
    int nodeEnd;
    {
        std::lock_guard<std::mutex> guard(lock);
        host->exitCode_ = code;
        nodeEnd = host->nodeEnd_;
        host->nodeEnd_ = -1;
    }
    shutdown(nodeEnd, SHUT_WR);
    close(nodeEnd);
    return nullptr;
}

}
