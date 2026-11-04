/*
** The storage of a database of mongo-embedded (store.c): a connection to its SQLite file, the collections of its
** catalog, and the reads and writes of their documents. Each function is called by one thread at a time (the thread of
** the database, or the one of its checkpoints for a connection of checkpoints); they return 0, or an error code with
** the message of mde_message().
*/
#ifndef MONGO_EMBEDDED_STORE_H
#define MONGO_EMBEDDED_STORE_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct MdeStore MdeStore;

/* When the writes are written to the disk (the option sync) */
#define MDE_SYNC_INTERVAL 0
#define MDE_SYNC_ALWAYS 1
#define MDE_SYNC_NEVER 2

/* The kinds of the changes of a write */
#define MDE_INSERT 0
#define MDE_REPLACE 1
#define MDE_DELETE 2

/* The errors besides the ones of SQLite: a document inserted whose key is there (the code of MongoDB), a document
** replaced that is not there, a collection that is not there */
#define MDE_DUPLICATE_KEY 11000
#define MDE_MISSING 100001
#define MDE_NO_COLLECTION 100002

typedef struct MdeOptions {
  int sync;
  int64_t cacheBytes;
  int64_t mmapBytes;
  /* A connection of the checkpoints only: no catalog */
  int checkpoints;
} MdeOptions;

/* A buffer of bytes growing as they are appended (malloc) */
typedef struct MdeBuffer {
  uint8_t *data;
  size_t size;
  size_t capacity;
} MdeBuffer;

void mde_buffer_free(MdeBuffer *buffer);

/* A change of a document: its key, and its BSON (of an insertion or a replacement) */
typedef struct MdeChange {
  int kind;
  const uint8_t *key;
  int keySize;
  const uint8_t *document;
  int documentSize;
} MdeChange;

/* Whether a document read by a scan is given: 0 leaves it out */
typedef int (*MdeFilter)(const uint8_t *document, size_t size, void *context);

/* A connection to a file (or ":memory:"), its catalog read; on a failure the message is written to message */
int mde_open(const char *file, const MdeOptions *options, MdeStore **store, char *message, size_t size);
void mde_close(MdeStore *store);
const char *mde_message(MdeStore *store);

/* The collections: for each one [u32 size of its name][its name][i64 id][i64 count of its documents][u32 size of the
** definitions of its indexes][their BSON] (little endian) */
int mde_collections(MdeStore *store, MdeBuffer *out);
int mde_create_collection(MdeStore *store, const char *name, int64_t *id);
int mde_drop_collection(MdeStore *store, int64_t id);
int mde_count(MdeStore *store, int64_t id, int64_t *count);

/* The definitions of the indexes of a collection written (none: size 0) */
int mde_set_indexes(MdeStore *store, int64_t id, const uint8_t *data, int size);

/* The changes of a collection as one transaction: all of them, or none (*failed the index of the change failing) */
int mde_write(MdeStore *store, int64_t id, const MdeChange *changes, int count, int *failed);

/* The documents of keys, appended to out; offsets[i] the offset of the one of keys[i], -1 when it is not there */
int mde_get(MdeStore *store, int64_t id, const uint8_t *const *keys, const int *keySizes, int count, MdeBuffer *out,
            int32_t *offsets);

/* The documents after a key (from the first one without it), in the order of their keys: up to maxDocuments given or
** maxBytes of them, maxScanned read; the key of the last one read in last, *done when the collection was read to its end */
int mde_scan(MdeStore *store, int64_t id, const uint8_t *after, int afterSize, int maxDocuments, size_t maxBytes,
             int maxScanned, MdeFilter filter, void *context, MdeBuffer *out, MdeBuffer *last, int *done);

/* The frames of the WAL after the last write committed (0 when it wrote none since the call before) */
int mde_frames(MdeStore *store);

/* A passive checkpoint: the frames of the WAL, and the ones written to the database; SQLITE_BUSY (5) when another
** connection holds the checkpoint */
int mde_checkpoint(MdeStore *store, int *frames, int *checkpointed);

/* The result of PRAGMA integrity_check ("ok" when the file is sound) */
int mde_integrity(MdeStore *store, MdeBuffer *out);

#ifdef __cplusplus
}
#endif

#endif
