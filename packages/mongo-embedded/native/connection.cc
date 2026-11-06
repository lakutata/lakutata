#include "connection.h"

#include <chrono>
#include <cstring>
#include <vector>

#ifdef _WIN32
#include <windows.h>
#else
#include <errno.h>
#include <fcntl.h>
#include <sys/file.h>
#include <unistd.h>
#endif

namespace mongo_embedded {
namespace {

// The frames of the WAL that start a checkpoint whatever the sync (as the default of SQLite, wal_autocheckpoint), and
// the ones checkpointed at once by the thread of the database, the writes waiting (about 64 MiB)
constexpr int kFullWal = 1000;
constexpr int kLargestWal = 16384;

#ifdef _WIN32
std::wstring Wide(const std::string& text) {
  const int size = MultiByteToWideChar(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), nullptr, 0);
  std::wstring wide(static_cast<size_t>(size), L'\0');
  MultiByteToWideChar(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), &wide[0], size);
  return wide;
}

uint64_t ProcessId() { return GetCurrentProcessId(); }
#else
uint64_t ProcessId() { return static_cast<uint64_t>(getpid()); }
#endif

// The message of a directory locked: the process holding it, read from its file LOCK
std::string Locked(const std::string& directory, const std::string& content) {
  const uint64_t pid = std::strtoull(content.c_str(), nullptr, 10);
  const std::string by = pid == ProcessId() ? "this process" : pid ? "the process " + std::to_string(pid) : "another process";
  return "The database " + directory + " of mongo-embedded is opened by " + by;
}

}  // namespace

Checkpoints::Checkpoints(MdeStore* store, int64_t interval) : store_(store), interval_(interval > 0 ? interval : 100) {
  thread_ = std::thread([this] { Run(); });
}

Checkpoints::~Checkpoints() {
  {
    std::lock_guard<std::mutex> lock(mutex_);
    stopping_ = true;
  }
  wake_.notify_one();
  thread_.join();
  mde_close(store_);
}

void Checkpoints::Written() {
  std::lock_guard<std::mutex> lock(mutex_);
  written_ = true;
}

void Checkpoints::Run() {
  std::unique_lock<std::mutex> lock(mutex_);
  for (;;) {
    wake_.wait_for(lock, std::chrono::milliseconds(interval_), [this] { return stopping_; });
    if (stopping_) return;
    if (!written_) continue;
    written_ = false;
    lock.unlock();
    int frames = 0, checkpointed = 0;
    mde_checkpoint(store_, &frames, &checkpointed);
    lock.lock();
  }
}

std::string Connection::Open(const Settings& settings) {
  std::string message;
  settings_ = settings;
  std::string file = ":memory:";
  if (!settings.directory.empty()) {
    if (!Lock(settings.directory, &message)) return message;
    file = settings.directory + "/data.db";
  }
  MdeOptions options = {settings.sync, settings.cacheBytes, settings.mmapBytes, 0, 0, settings.oplogBytes};
  char error[512] = {0};
  if (mde_open(file.c_str(), &options, &store_, error, sizeof(error)) != 0) {
    Unlock();
    return error;
  }
  MdeBuffer collections = {nullptr, 0, 0};
  if (mde_collections(store_, &collections) != 0) {
    message = mde_message(store_);
    mde_buffer_free(&collections);
    Close();
    return message;
  }
  for (size_t at = 0; at + 4 <= collections.size;) {
    uint32_t length;
    int64_t id;
    std::memcpy(&length, collections.data + at, 4);
    std::string name(reinterpret_cast<const char*>(collections.data + at + 4), length);
    std::memcpy(&id, collections.data + at + 4 + length, 8);
    names_[name] = id;
    uint32_t indexes, tables;
    // [u32 size][name][i64 id][i64 count][16 bytes of the UUID][u32 size of the definitions][definitions]...
    std::memcpy(&indexes, collections.data + at + 4 + length + 32, 4);
    at += 4 + length + 36 + indexes;
    std::memcpy(&tables, collections.data + at, 4);
    at += 4 + static_cast<size_t>(tables) * 8;
  }
  mde_buffer_free(&collections);
  if (!settings.directory.empty() && settings.sync == MDE_SYNC_INTERVAL) {
    MdeOptions checkpoints = options;
    checkpoints.checkpoints = 1;
    MdeStore* store = nullptr;
    if (mde_open(file.c_str(), &checkpoints, &store, error, sizeof(error)) != 0) {
      Close();
      return error;
    }
    checkpoints_ = new Checkpoints(store, settings.syncInterval);
  }
  return std::string();
}

void Connection::Close() {
  // The connection of the checkpoints closed first, then the one reading: the last one closed checkpoints the WAL
  delete checkpoints_;
  checkpoints_ = nullptr;
  if (reader_) mde_close(reader_);
  reader_ = nullptr;
  if (store_) mde_close(store_);
  store_ = nullptr;
  names_.clear();
  Unlock();
}

int64_t Connection::IdOf(const std::string& name) const {
  auto found = names_.find(name);
  return found == names_.end() ? 0 : found->second;
}

int64_t Connection::Create(const std::string& name, const uint8_t* uuid, const std::vector<uint8_t>& definitions, std::string* message) {
  int64_t id = IdOf(name);
  if (id) return id;
  if (mde_create_collection(store_, name.c_str(), uuid, definitions.data(), static_cast<int>(definitions.size()), &id) != 0) {

    *message = mde_message(store_);
    return 0;
  }
  names_[name] = id;
  return id;
}

bool Connection::Drop(const std::string& name, std::string* message) {
  const int64_t id = IdOf(name);
  if (!id) return false;
  if (mde_drop_collection(store_, id) != 0) {
    *message = mde_message(store_);
    return false;
  }
  names_.erase(name);
  return true;
}

int Connection::Rename(const std::string& from, const std::string& to, bool dropTarget, std::string* message) {
  if (from == to) {
    *message = "Can't rename a collection to itself";
    return 20;
  }
  const int64_t id = IdOf(from);
  if (!id) {
    *message = "source namespace does not exist";
    return 26;
  }
  const int64_t target = IdOf(to);
  if (target && !dropTarget) {
    *message = "target namespace exists";
    return 48;
  }
  if (mde_rename_collection(store_, id, to.c_str(), target) != 0) {
    *message = mde_message(store_);
    return -1;
  }
  names_.erase(from);
  names_[to] = id;
  return 0;
}

int Connection::Begin(std::string* message) {
  if (!reader_) {
    MdeOptions options = {settings_.sync, settings_.cacheBytes, settings_.mmapBytes, 0, 1, 0};
    char error[512] = {0};
    if (mde_open(mde_file(store_), &options, &reader_, error, sizeof(error)) != 0) {
      *message = error;
      return -1;
    }
  }
  if (mde_refresh(reader_, store_) != 0) {
    *message = mde_message(reader_);
    return -1;
  }
  if (mde_begin(store_) != 0) {
    *message = mde_message(store_);
    return -1;
  }
  saved_ = names_;
  return 0;
}

int Connection::Commit(std::string* message) {
  if (mde_commit(store_) != 0) {
    // Not committed: aborted
    *message = mde_message(store_);
    names_ = saved_;
    return -1;
  }
  saved_.clear();
  return 0;
}

void Connection::Abort() {
  if (!InTransaction()) return;
  mde_abort(store_);
  names_ = saved_;
  saved_.clear();
}

void Connection::Written() {
  const int frames = mde_frames(store_);
  if (!frames) return;
  frames_ = frames;
  if (checkpoints_) checkpoints_->Written();
  if (frames >= kLargestWal) Idle();
}

void Connection::Idle() {
  // Not while the transaction of a session is open: its frames are not committed
  if (frames_ < kFullWal || !store_ || mde_in_transaction(store_)) return;

  int frames = 0, checkpointed = 0;
  // Busy (the thread of the checkpoints holding it): tried again at the next idle
  if (mde_checkpoint(store_, &frames, &checkpointed) == 0 && frames >= 0 && checkpointed == frames) frames_ = 0;
}

bool Connection::Lock(const std::string& directory, std::string* message) {
  const std::string path = directory + "/LOCK";
  const std::string pid = std::to_string(ProcessId()) + "\n";
#ifdef _WIN32
  HANDLE handle = CreateFileW(Wide(path).c_str(), GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                              nullptr, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (handle == INVALID_HANDLE_VALUE) {
    *message = "The file " + path + " cannot be opened (error " + std::to_string(GetLastError()) + ")";
    return false;
  }
  // The byte locked is past the content (4 GiB): the locks of Windows are mandatory, and the content tells the pid
  OVERLAPPED overlapped = {};
  overlapped.OffsetHigh = 1;
  if (!LockFileEx(handle, LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY, 0, 1, 0, &overlapped)) {
    const DWORD code = GetLastError();
    char content[32] = {0};
    DWORD read = 0;
    ReadFile(handle, content, sizeof(content) - 1, &read, nullptr);
    CloseHandle(handle);
    *message = code == ERROR_LOCK_VIOLATION ? Locked(directory, content) : "The file " + path + " cannot be locked (error " + std::to_string(code) + ")";
    return false;
  }
  SetFilePointer(handle, 0, nullptr, FILE_BEGIN);
  SetEndOfFile(handle);
  DWORD written = 0;
  WriteFile(handle, pid.data(), static_cast<DWORD>(pid.size()), &written, nullptr);
  lock_ = reinterpret_cast<intptr_t>(handle);
#else
  const int descriptor = open(path.c_str(), O_RDWR | O_CREAT | O_CLOEXEC, 0644);
  if (descriptor < 0) {
    *message = "The file " + path + " cannot be opened: " + std::strerror(errno);
    return false;
  }
  // flock: a lock of the open file, so that a second opening in this process fails too
  if (flock(descriptor, LOCK_EX | LOCK_NB) != 0) {
    const int code = errno;
    char content[32] = {0};
    if (pread(descriptor, content, sizeof(content) - 1, 0) < 0) content[0] = 0;
    close(descriptor);
    *message = code == EWOULDBLOCK ? Locked(directory, content) : "The file " + path + " cannot be locked: " + std::strerror(code);
    return false;
  }
  if (ftruncate(descriptor, 0) != 0 || pwrite(descriptor, pid.data(), pid.size(), 0) < 0) {
    // The pid tells the process holding the lock in the message of a refusal only
  }
  lock_ = descriptor;
#endif
  return true;
}

void Connection::Unlock() {
  if (lock_ == -1) return;
#ifdef _WIN32
  CloseHandle(reinterpret_cast<HANDLE>(lock_));
#else
  close(static_cast<int>(lock_));
#endif
  lock_ = -1;
}

}  // namespace mongo_embedded
