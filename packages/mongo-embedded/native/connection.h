// A database opened by its thread: the lock of its directory, its connection to its SQLite file, the names of its
// collections, and the thread of its checkpoints, which runs them on a connection of its own (WAL lets them run while
// the database is written) as the option sync tells.
#ifndef MONGO_EMBEDDED_CONNECTION_H
#define MONGO_EMBEDDED_CONNECTION_H

#include <condition_variable>
#include <cstdint>
#include <map>
#include <mutex>
#include <string>
#include <thread>

#include "store.h"

namespace mongo_embedded {

struct Settings {
  // A directory, or empty for a database in memory
  std::string directory;
  int sync = MDE_SYNC_INTERVAL;
  // The interval of the checkpoints of the sync "interval" (ms)
  int64_t syncInterval = 100;
  // The page cache: 16 MiB, as fast as 64 MiB at 1,000,000 and 10,000,000 documents (the pages it misses are in the
  // cache of the files of the system)
  int64_t cacheBytes = 16 * 1024 * 1024;
  int64_t mmapBytes = 0;
};

// The thread of the checkpoints of a file with the sync "interval": a passive checkpoint every interval when frames
// were written, which syncs the WAL (a write is lost by a power loss for an interval at most); its connection closed
// when it stops
class Checkpoints {
 public:
  Checkpoints(MdeStore* store, int64_t interval);
  ~Checkpoints();

  // After a write
  void Written();

 private:
  void Run();

  MdeStore* store_;
  int64_t interval_;
  std::thread thread_;
  std::mutex mutex_;
  std::condition_variable wake_;
  bool written_ = false;
  bool stopping_ = false;
};

class Connection {
 public:
  // The database opened (on its thread): the message of its failure, empty when it opened
  std::string Open(const Settings& settings);
  void Close();
  ~Connection() { Close(); }

  MdeStore* store() const { return store_; }

  // The id of a collection, or 0; a collection created when it is missing
  int64_t IdOf(const std::string& name) const;
  int64_t Create(const std::string& name, std::string* message);
  bool Drop(const std::string& name, std::string* message);
  const std::map<std::string, int64_t>& names() const { return names_; }

  // After a write: the thread of the checkpoints told; a WAL of 16384 frames checkpointed at once, the writes waiting
  void Written();

  // The thread of the database idle: a WAL of 1000 frames checkpointed by this connection, which no write runs
  // beside, so that every frame is written back and the next write restarts the WAL from its beginning (a thread of
  // checkpoints never sees the WAL written back whole while the writes go on); tried again at the next idle when the
  // thread of the checkpoints held the checkpoint
  void Idle();

 private:
  bool Lock(const std::string& directory, std::string* message);
  void Unlock();

  MdeStore* store_ = nullptr;
  Checkpoints* checkpoints_ = nullptr;
  std::map<std::string, int64_t> names_;
  // The descriptor (a HANDLE on Windows) of the file LOCK held, or -1
  intptr_t lock_ = -1;
  // The frames of the WAL after the last write
  int frames_ = 0;
};

}  // namespace mongo_embedded

#endif
