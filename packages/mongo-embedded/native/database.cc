#include "database.h"

#include <exception>
#include <utility>

namespace mongo_embedded {

Database::Database(Napi::Env env, std::function<void()> closeStore, std::function<void()> idle)
    : env_(env), closeStore_(std::move(closeStore)), idle_(std::move(idle)), settling_(new Settling()) {
  settle_ = Callback::New(env, "mongo-embedded", 0, 1, settling_, &Database::Finalize, static_cast<void*>(nullptr));
  settling_->function = settle_;
  // Idle: the event loop is not held until a task is queued
  napi_unref_threadsafe_function(env, settling_->function);
  napi_add_env_cleanup_hook(env, &Database::Cleanup, this);
  thread_ = std::thread([this] { Run(); });
}

Database::~Database() {
  Shutdown();
  if (!cleaned_) napi_remove_env_cleanup_hook(env_, &Database::Cleanup, this);
}

Napi::Value Database::Submit(Napi::Env env, Work work, Finish finish) {
  napi_deferred deferred;
  napi_value promise;
  NAPI_THROW_IF_FAILED(env, napi_create_promise(env, &deferred, &promise), Napi::Value());
  if (closing_) {
    napi_reject_deferred(env, deferred, Napi::Error::New(env, "The database of mongo-embedded is closed").Value());
    return Napi::Value(env, promise);
  }
  Task* task = new Task{std::move(work), std::move(finish), deferred, Outcome()};
  if (settling_->pending++ == 0) napi_ref_threadsafe_function(env, settling_->function);
  {
    std::lock_guard<std::mutex> lock(mutex_);
    queue_.push_back(task);
  }
  ready_.notify_one();
  return Napi::Value(env, promise);
}

Napi::Value Database::Close(Napi::Env env) {
  if (closing_) {
    Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(env);
    deferred.Resolve(env.Undefined());
    return deferred.Promise();
  }
  // The last task: the store closed on the thread, which ends after it
  Napi::Value promise = Submit(
      env,
      [this](Outcome&) {
        closeStore_();
        closeStore_ = nullptr;
        std::lock_guard<std::mutex> lock(mutex_);
        ending_ = true;
      },
      [](napi_env env, Outcome&) {
        napi_value undefined = nullptr;
        napi_get_undefined(env, &undefined);
        return undefined;
      });
  closing_ = true;
  return promise;
}

void Database::Shutdown() {
  if (stopped_) return;
  stopped_ = true;
  closing_ = true;
  std::deque<Task*> dropped;
  {
    std::lock_guard<std::mutex> lock(mutex_);
    ending_ = true;
    dropped.swap(queue_);
  }
  ready_.notify_one();
  if (thread_.joinable()) thread_.join();
  // The tasks never run: their promises left pending (the environment ends, or no reference reaches them any more)
  for (Task* task : dropped) delete task;
  if (closeStore_) {
    closeStore_();
    closeStore_ = nullptr;
  }
  settle_.Release();
}

void Database::Run() {
  // A task ran since the idle work: it runs once no task came for kIdleDelay
  bool idle = false;
  for (;;) {
    Task* task;
    {
      std::unique_lock<std::mutex> lock(mutex_);
      if (idle && idle_ && queue_.empty() && !ending_ &&
          !ready_.wait_for(lock, kIdleDelay, [this] { return !queue_.empty() || ending_; })) {
        idle = false;
        lock.unlock();
        idle_();
        continue;
      }
      ready_.wait(lock, [this] { return !queue_.empty() || ending_; });
      if (queue_.empty()) return;
      task = queue_.front();
      queue_.pop_front();
    }
    try {
      task->work(task->outcome);
    } catch (const std::exception& error) {
      task->outcome.code = -1;
      task->outcome.message = error.what();
    }
    // The environment ending: the result cannot be given
    if (settle_.NonBlockingCall(task) != napi_ok) delete task;
    idle = true;
  }
}

napi_value BufferOf(napi_env env, const uint8_t* data, size_t size) {
  napi_value buffer;
  void* copied;
  return napi_create_buffer_copy(env, size, size ? data : nullptr, &copied, &buffer) == napi_ok ? buffer : nullptr;
}

// The error of a failure, made by the raw functions (nullptr when they fail)
static napi_value ErrorOf(napi_env env, const Outcome& outcome) {
  napi_value message, code, error;
  if (napi_create_string_utf8(env, outcome.message.data(), outcome.message.size(), &message) != napi_ok) return nullptr;
  if (napi_create_error(env, nullptr, message, &error) != napi_ok) return nullptr;
  if (napi_create_int32(env, outcome.code, &code) == napi_ok) napi_set_named_property(env, error, "code", code);
  napi_value index;
  if (outcome.index >= 0 && napi_create_int64(env, outcome.index, &index) == napi_ok) napi_set_named_property(env, error, "index", index);
  return error;
}

void Database::Settle(Napi::Env env, Napi::Function, Settling* settling, Task* task) {
  if (env != nullptr) {
    if (--settling->pending == 0) napi_unref_threadsafe_function(env, settling->function);
    Outcome& outcome = task->outcome;
    napi_value result = task->finish(env, outcome);
    if (outcome.code != 0) {
      result = ErrorOf(env, outcome);
      if (result != nullptr) napi_reject_deferred(env, task->deferred, result);
    } else if (result != nullptr) {
      napi_resolve_deferred(env, task->deferred, result);
    }
  }
  delete task;
}

void Database::Finalize(Napi::Env, void*, Settling* settling) { delete settling; }

void Database::Cleanup(void* data) {
  Database* database = static_cast<Database*>(data);
  database->cleaned_ = true;
  database->Shutdown();
}

}  // namespace mongo_embedded
