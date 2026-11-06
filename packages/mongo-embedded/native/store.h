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
  /* A connection reading beside the transaction of a session of the one writing (mde_refresh): its catalog read, not
  ** made, the counts of its collections not counted */
  int reader;
  /* The most bytes of the events of the oplog (its oldest ones deleted beyond); 0: no event written to the oplog */
  int64_t oplogBytes;
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

/* An entry of an index written with a change of a write (the index of the change in the write): removed or inserted
** in the table of the index (the id of the table), its key (the key of the index, then the key of the _id when the
** index is not unique) and its value (the key of the _id). unique: 1 for a unique index, which refuses a key that
** another document holds; 2 for an index not unique prepared to be unique (prepareUnique), which refuses new entries of a
** key that another document holds; 0 otherwise */
typedef struct MdeEntry {
  int change;
  int64_t index;
  int unique;
  int remove;
  const uint8_t *key;
  int keySize;
  const uint8_t *value;
  int valueSize;
} MdeEntry;

/* A range of the keys of a table, compared as bytes (the shorter one first when one starts the other): its lower and
** upper bounds (NULL: none), each one in it or not */
typedef struct MdeRange {
  const uint8_t *lower;
  int lowerSize;
  int lowerInclusive;
  const uint8_t *upper;
  int upperSize;
  int upperInclusive;
} MdeRange;

/* Whether a document read by a scan is given: 0 leaves it out */
typedef int (*MdeFilter)(const uint8_t *document, size_t size, void *context);

/* A connection to a file (or ":memory:"), its catalog read; on a failure the message is written to message */
int mde_open(const char *file, const MdeOptions *options, MdeStore **store, char *message, size_t size);
void mde_close(MdeStore *store);
const char *mde_message(MdeStore *store);

/* The name a store opened: the path of its file, or the name of its database in memory (a connection reading beside it
** opens it) */
const char *mde_file(MdeStore *store);

/* The transaction of a session: the functions called while it is open run in it (their writes seen by its reads only),
** a failure of one of them leaving it to be aborted. An abort restores the collections, their counts and the
** definitions of their indexes as they were when it began */
int mde_begin(MdeStore *store);
int mde_commit(MdeStore *store);
int mde_abort(MdeStore *store);
int mde_in_transaction(MdeStore *store);

/* A connection reading beside the transaction of a session (opened with the option reader) brought to the last commit
** of the one writing, before its transaction begins: its catalog read again, the counts of its collections those of
** the one writing */
int mde_refresh(MdeStore *reader, MdeStore *writer);


/* The collections: for each one [u32 size of its name][its name][i64 id][i64 count of its documents][16 bytes of its
** UUID][u32 size of the definitions of its indexes][their BSON][u32 number of the tables of its indexes][their i64 ids]
** (little endian) */
int mde_collections(MdeStore *store, MdeBuffer *out);
/* A collection created, of a UUID (16 bytes; NULL: a random one), its definitions written with it when they are
** given (size 0: none) */
int mde_create_collection(MdeStore *store, const char *name, const uint8_t *uuid, const uint8_t *definitions,
                          int definitionsSize, int64_t *id);
int mde_drop_collection(MdeStore *store, int64_t id);
/* A collection renamed (its tables and its indexes kept), the collection of the new name dropped (dropped, its id; 0:
** none) in the same transaction */
int mde_rename_collection(MdeStore *store, int64_t id, const char *name, int64_t dropped);
int mde_count(MdeStore *store, int64_t id, int64_t *count);

/* The definitions of the indexes of a collection written (none: size 0) */
int mde_set_indexes(MdeStore *store, int64_t id, const uint8_t *data, int size);

/* The table of an index of a collection created (its id in *index), or dropped. The id 0 of an index is the table of
** the collection itself, ordered by the keys of the _id */
int mde_create_index(MdeStore *store, int64_t id, int64_t *index);
int mde_drop_index(MdeStore *store, int64_t id, int64_t index);

/* The changes of a collection and the entries of its indexes as one transaction: all of them, or none (*failed the
** index of the change failing, *failedIndex the id of the index of a duplicate key, 0 for the _id). The entries of a
** change, in the order of the changes, are removed before it and inserted after it. The definitions of the indexes
** are written with them when they are given (not NULL; size 0: none) */
int mde_write(MdeStore *store, int64_t id, const MdeChange *changes, int count, const MdeEntry *entries, int entryCount,
              const uint8_t *definitions, int definitionsSize, int *failed, int64_t *failedIndex);

/* Entries inserted in the table of an index (a build), as one transaction: *failed the index of a key of a unique
** index that another document holds */
int mde_write_index(MdeStore *store, int64_t id, int64_t index, int unique, const uint8_t *const *keys, const int *keySizes,
                    const uint8_t *const *values, const int *valueSizes, int count, int *failed);

/* The documents of keys, appended to out; offsets[i] the offset of the one of keys[i], -1 when it is not there */
int mde_get(MdeStore *store, int64_t id, const uint8_t *const *keys, const int *keySizes, int count, MdeBuffer *out,
            int32_t *offsets);

/* The documents after a key (from the first one without it), in the order of their keys: up to maxDocuments given or
** maxBytes of them, maxScanned read; the key of the last one read in last, *done when the collection was read to its end */
int mde_scan(MdeStore *store, int64_t id, const uint8_t *after, int afterSize, int maxDocuments, size_t maxBytes,
             int maxScanned, MdeFilter filter, void *context, MdeBuffer *out, MdeBuffer *last, int *done);

/* The entries of ranges of a table (an index, or the collection: 0), in their order or reversed (the ranges too), from
** the range given (after the key given in it, when given): the documents of the entries (left out by the filter),
** or the keys of their _id ([u32 size][the key] each) when keysOnly is 1, the entries of an index ([u32 size][the key]
** [u32 size][the value] each) when it is 2; up to maxDocuments given or maxBytes of them,
** maxScanned read. The key of the last entry read in last, the range it is in in *range, *done when the ranges were read
** to their end. No range: all the entries */
int mde_scan_range(MdeStore *store, int64_t id, int64_t index, const MdeRange *ranges, int rangeCount, int reverse,
                   int *range, const uint8_t *after, int afterSize, int keysOnly, int maxDocuments, size_t maxBytes,
                   int maxScanned, MdeFilter filter, void *context, MdeBuffer *out, MdeBuffer *last, int *done);

/* The entries of ranges of a table (an index, or the collection: 0) */
int mde_count_range(MdeStore *store, int64_t id, int64_t index, const MdeRange *ranges, int rangeCount, int64_t *count);

/* The frames of the WAL after the last write committed (0 when it wrote none since the call before) */
int mde_frames(MdeStore *store);

/* A passive checkpoint: the frames of the WAL, and the ones written to the database; SQLITE_BUSY (5) when another
** connection holds the checkpoint */
int mde_checkpoint(MdeStore *store, int *frames, int *checkpointed);

/* The WAL written to the disk (its frames committed made durable: a write of the write concern j); nothing for a
** database in memory */
int mde_sync_wal(MdeStore *store);

/*
** The oplog of the change streams: the events of the writes (BSON, made by the client), written in the transaction of
** their write, each one under the key of its generation (the opening of the database: a new one each time) and of its
** sequence in it (8 bytes each, big endian); its oldest events deleted once it holds more bytes than its limit.
*/

/* Events queued: the next commit of a function (its transaction, or the one of the session open) writes them to the
** oplog, a failure dropping them */
int mde_queue_events(MdeStore *store, const uint8_t *const *events, const int *sizes, int count);

/* The events queued written to the oplog by a transaction of their own (or in the one of the session open) */
int mde_append_events(MdeStore *store);

/* The events queued dropped (the function they were queued for failed before its commit) */
void mde_drop_events(MdeStore *store);


/* The events after a key (from the first one without it), in their order: [u32 size of the event][its key, 16
** bytes][the event] each, up to maxEvents or maxBytes of them; the key of the last one read in last, *done when the
** oplog was read to its end; the key of the last event the oplog lost, as the read sees it (16 bytes, zeros when none) */
int mde_oplog_read(MdeStore *store, const uint8_t *after, int afterSize, int maxEvents, size_t maxBytes, MdeBuffer *out,
                   MdeBuffer *last, int *done, uint8_t *lost);

/* The state of the oplog: its generation, the sequence of its next event, the key of its oldest event (*hasFirst 0 when
** it has none), the UUID of the database (16 bytes), the key and the cluster time of the last event it lost (24 bytes,
** zeros when none, the time zeros when it is not known; for an opening keeping no events, the ones lost when it
** opened), the cluster time of its last event (8 bytes; *hasLastTime 0 when it has none). A cluster time: its
** increment, then its time, 4 bytes each, little endian */
int mde_oplog_state(MdeStore *store, int64_t *generation, int64_t *nextSeq, uint8_t *first, int *hasFirst,
                    uint8_t *database, uint8_t *lost, uint8_t *lastTime, int *hasLastTime);


/* The result of PRAGMA integrity_check ("ok" when the file is sound) */

int mde_integrity(MdeStore *store, MdeBuffer *out);

#ifdef __cplusplus
}
#endif

#endif
