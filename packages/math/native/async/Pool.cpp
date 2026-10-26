#include "Pool.h"

#include <cstdlib>
#include <stdexcept>
#include <string>
#include <thread>

#ifdef _WIN32
//node-gyp defines them already
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#else
#include <pthread.h>
#endif

#include "../core/Errors.h"

namespace math {

namespace {

unsigned poolSize()
{
    if (const char *configured = std::getenv("LAKUTATA_MATH_THREADS")) {
        const long value = std::strtol(configured, nullptr, 10);
        if (value > 0 && value <= 1024) return static_cast<unsigned>(value);
    }
    const unsigned processors = std::thread::hardware_concurrency();
    return processors > 1 ? processors - 1 : 1;
}

thread_local std::shared_ptr<Token> currentToken;

}

Pool &Pool::shared()
{
    //Never destroyed: its threads are detached, the process ends without waiting for an operation running
    static Pool *pool = new Pool(poolSize());
    return *pool;
}

Pool::Pool(unsigned size) : size_(size)
{
    for (unsigned i = 0; i < size; i++) start();
}

void Pool::start()
{
    //Reserved, not committed: the memory is used as the stack grows
    const size_t stack = (sizeof(void *) == 8 ? 64 : 16) * 1024 * 1024;
#ifdef _WIN32
    HANDLE thread = CreateThread(nullptr, stack, [](LPVOID pool) -> DWORD {
        static_cast<Pool *>(pool)->work();
        return 0;
    }, this, STACK_SIZE_PARAM_IS_A_RESERVATION, nullptr);
    if (thread == nullptr) throw std::runtime_error("The threads of the addon cannot be started");
    CloseHandle(thread);
#else
    pthread_attr_t attributes;
    pthread_attr_init(&attributes);
    pthread_attr_setstacksize(&attributes, stack);
    pthread_attr_setdetachstate(&attributes, PTHREAD_CREATE_DETACHED);
    pthread_t thread;
    const int failed = pthread_create(&thread, &attributes, [](void *pool) -> void * {
        static_cast<Pool *>(pool)->work();
        return nullptr;
    }, this);
    pthread_attr_destroy(&attributes);
    if (failed != 0) throw std::runtime_error("The threads of the addon cannot be started");
#endif
}

unsigned Pool::size() const
{
    return size_;
}

void Pool::submit(std::function<void()> task)
{
    {
        std::lock_guard<std::mutex> lock(mutex_);
        tasks_.push_back(std::move(task));
    }
    available_.notify_one();
}

void Pool::work()
{
    while (true) {
        std::function<void()> task;
        {
            std::unique_lock<std::mutex> lock(mutex_);
            available_.wait(lock, [this] { return !tasks_.empty(); });
            task = std::move(tasks_.front());
            tasks_.pop_front();
        }
        task();
    }
}

void Token::cancel(Reason reason)
{
    int expected = 0;
    reason_.compare_exchange_strong(expected, static_cast<int>(reason));
}

Token::Reason Token::reason() const
{
    return static_cast<Reason>(reason_.load());
}

void setCurrentToken(std::shared_ptr<Token> token)
{
    currentToken = std::move(token);
}

void checkpoint()
{
    if (!currentToken) return;
    switch (currentToken->reason()) {
        case Token::Reason::None: return;
        case Token::Reason::Cancelled: throw MathError(ErrorCode::Cancelled, "The operation is cancelled");
        case Token::Reason::Timeout: throw MathError(ErrorCode::Timeout, "The operation took longer than its timeout");
    }
}

}
