#pragma once

#include <functional>
#include <string>
#include <utility>
#include <vector>

namespace lakutata {

/**
 * The Node.js of the application, run in a thread of its own and talking over a socketpair: its end is given to
 * Node.js by the environment variable LAKUTATA_NODE_FD, the lines it writes are handed to the listener. When Node.js
 * ends (process.exit(), an uncaught exception) the listener gets {"type":"exit","code":<code>}, and Node.js may be
 * started again
 */
class NodeHost {
public:
    using Listener = std::function<void(std::string)>;

    static NodeHost &instance();

    /**
     * Start the Node.js project of the application (its main.js) with variables added to its environment. The project
     * is in the directory LAKUTATA_NODE_PROJECT names when it is set (Android: the copy of the assets), else where the
     * system keeps it: the bundle of the application on iOS (nodejs, next to its executable), the resfile of the HAP
     * on HarmonyOS (files/nodejs-dev before it while its .development says on: the copy written while developing)
     * @return "started", or why it was not
     */
    std::string start(std::vector<std::pair<std::string, std::string>> environment);

    /**
     * Write a line to Node.js
     */
    void send(const std::string &line);

    /**
     * Give the lines Node.js writes to a listener (the lines written before are kept until one listens)
     */
    void listen(Listener listener);

    /**
     * Tell the application it goes to the background ({"type":"pause"}) and wait until it answers {"type":"paused"}
     * @param timeout the milliseconds waited at most, 0 to return at once
     * @return whether it answered in time
     */
    bool pause(int timeout);

    /**
     * Tell the application it came back from the background ({"type":"resume"})
     */
    void resume();

private:
    NodeHost() = default;
    void deliver(std::string line);
    static void *readLoop(void *host);
    static void *runNode(void *host);

    int fd_ = -1;
    // The end of Node.js kept by the host: shut down when Node.js ends, so the reader gets the end of the stream
    // whether Node.js closed its copy or not
    int nodeEnd_ = -1;
    int exitCode_ = 0;
    bool started_ = false;
    // Counts the answers to the pauses, which the reader keeps from the listener
    unsigned paused_ = 0;
    std::vector<std::string> args_;
    std::vector<std::string> pending_;
    Listener listener_;
};

}
