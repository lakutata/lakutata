/* The text of the text indexes (text.h): the words of a text split by the delimiters, folded, the stop words left out,
** stemmed by the stemmer of their language (Snowball's of April 2014, vendor/libstemmer_c), their diacritics removed,
** with the tables of tables.h (scripts/text-tables.mjs) */
#include "text.h"

#include <stdlib.h>
#include <string.h>

#include "api.h"
#include "stem_UTF_8_danish.h"
#include "stem_UTF_8_dutch.h"
#include "stem_UTF_8_english.h"
#include "stem_UTF_8_finnish.h"
#include "stem_UTF_8_french.h"
#include "stem_UTF_8_german.h"
#include "stem_UTF_8_hungarian.h"
#include "stem_UTF_8_italian.h"
#include "stem_UTF_8_norwegian.h"
#include "stem_UTF_8_portuguese.h"
#include "stem_UTF_8_romanian.h"
#include "stem_UTF_8_russian.h"
#include "stem_UTF_8_spanish.h"
#include "stem_UTF_8_swedish.h"
#include "stem_UTF_8_turkish.h"
#include "tables.h"

#define COUNT(table) (sizeof(table) / sizeof((table)[0]))

/* The id of English, whose words keep their apostrophes (don't), and of Turkish, whose case folding has its own rules
** (T) */
#define LANGUAGE_ENGLISH 3
#define LANGUAGE_TURKISH 15

typedef struct SN_env *(*CreateStemmer)(void);
typedef void (*CloseStemmer)(struct SN_env *);
typedef int (*Stem)(struct SN_env *);

/* The stemmers of the languages, by their ids (none for 0) */
static const struct {
  CreateStemmer create;
  CloseStemmer close;
  Stem stem;
} kStemmers[MDE_TEXT_LANGUAGES + 1] = {
  {NULL, NULL, NULL},
  {danish_UTF_8_create_env, danish_UTF_8_close_env, danish_UTF_8_stem},
  {dutch_UTF_8_create_env, dutch_UTF_8_close_env, dutch_UTF_8_stem},
  {english_UTF_8_create_env, english_UTF_8_close_env, english_UTF_8_stem},
  {finnish_UTF_8_create_env, finnish_UTF_8_close_env, finnish_UTF_8_stem},
  {french_UTF_8_create_env, french_UTF_8_close_env, french_UTF_8_stem},
  {german_UTF_8_create_env, german_UTF_8_close_env, german_UTF_8_stem},
  {hungarian_UTF_8_create_env, hungarian_UTF_8_close_env, hungarian_UTF_8_stem},
  {italian_UTF_8_create_env, italian_UTF_8_close_env, italian_UTF_8_stem},
  {norwegian_UTF_8_create_env, norwegian_UTF_8_close_env, norwegian_UTF_8_stem},
  {portuguese_UTF_8_create_env, portuguese_UTF_8_close_env, portuguese_UTF_8_stem},
  {romanian_UTF_8_create_env, romanian_UTF_8_close_env, romanian_UTF_8_stem},
  {russian_UTF_8_create_env, russian_UTF_8_close_env, russian_UTF_8_stem},
  {spanish_UTF_8_create_env, spanish_UTF_8_close_env, spanish_UTF_8_stem},
  {swedish_UTF_8_create_env, swedish_UTF_8_close_env, swedish_UTF_8_stem},
  {turkish_UTF_8_create_env, turkish_UTF_8_close_env, turkish_UTF_8_stem}
};

/* Whether a code point is in sorted ranges */
static int InRanges(const uint32_t ranges[][2], size_t count, uint32_t point) {
  size_t low = 0, high = count;
  while (low < high) {
    size_t middle = (low + high) / 2;
    if (point < ranges[middle][0]) high = middle;
    else if (point > ranges[middle][1]) low = middle + 1;
    else return 1;
  }
  return 0;
}

/* The value of a code point in sorted pairs (*found 0 and the code point itself when it is not there) */
static uint32_t Mapped(const uint32_t pairs[][2], size_t count, uint32_t point, int *found) {
  size_t low = 0, high = count;
  while (low < high) {
    size_t middle = (low + high) / 2;
    if (point < pairs[middle][0]) high = middle;
    else if (point > pairs[middle][0]) low = middle + 1;
    else {
      *found = 1;
      return pairs[middle][1];
    }
  }
  *found = 0;
  return point;
}

/* The code point at the start of UTF-8 and its length in bytes (a byte that does not start one: itself, of length 1) */
static uint32_t Decode(const uint8_t *s, size_t size, size_t *length) {
  const uint8_t c = s[0];
  *length = 1;
  if (c < 0x80) return c;
  const int n = c >= 0xF0 ? 4 : c >= 0xE0 ? 3 : c >= 0xC0 ? 2 : 1;
  if (n == 1 || (size_t)n > size) return c;
  uint32_t point = c & (0xFF >> (n + 1));
  for (int i = 1; i < n; i++) {
    if ((s[i] & 0xC0) != 0x80) return c;
    point = (point << 6) | (s[i] & 0x3F);
  }
  *length = (size_t)n;
  return point;
}

/* The UTF-8 of a code point (4 bytes at most): its length */
static size_t Encode(uint32_t point, uint8_t *out) {
  if (point < 0x80) {
    out[0] = (uint8_t)point;
    return 1;
  }
  if (point < 0x800) {
    out[0] = (uint8_t)(0xC0 | (point >> 6));
    out[1] = (uint8_t)(0x80 | (point & 0x3F));
    return 2;
  }
  if (point < 0x10000) {
    out[0] = (uint8_t)(0xE0 | (point >> 12));
    out[1] = (uint8_t)(0x80 | ((point >> 6) & 0x3F));
    out[2] = (uint8_t)(0x80 | (point & 0x3F));
    return 3;
  }
  out[0] = (uint8_t)(0xF0 | (point >> 18));
  out[1] = (uint8_t)(0x80 | ((point >> 12) & 0x3F));
  out[2] = (uint8_t)(0x80 | ((point >> 6) & 0x3F));
  out[3] = (uint8_t)(0x80 | (point & 0x3F));
  return 4;
}

/* Bytes growing as they are written */
typedef struct {
  uint8_t *data;
  size_t size;
  size_t capacity;
} Bytes;

/* Room for a code point more: 0 when the memory runs out */
static int Room(Bytes *bytes) {
  if (bytes->size + 4 <= bytes->capacity) return 1;
  size_t capacity = bytes->capacity ? bytes->capacity * 2 : 64;
  uint8_t *data = realloc(bytes->data, capacity);
  if (!data) return 0;
  bytes->data = data;
  bytes->capacity = capacity;
  return 1;
}

/* Whether a code point is a delimiter of the words of a language: the apostrophe in every language but English */
static int IsDelimiter(uint32_t point, int language) {
  if (point == 0x27) return language != LANGUAGE_ENGLISH;
  return InRanges(kDelimiters, COUNT(kDelimiters), point);
}

/* The case folding of a code point (C and S; T first in Turkish) */
static uint32_t Fold(uint32_t point, int turkish) {
  int found = 0;
  if (turkish) {
    const uint32_t folded = Mapped(kTurkishFolding, COUNT(kTurkishFolding), point, &found);
    if (found) return folded;
  }
  return Mapped(kFolding, COUNT(kFolding), point, &found);
}

/* Whether a word (folded) is a stop word of a language: a search of its sorted stop words */
static int IsStopWord(int language, const uint8_t *word, size_t size) {
  const char *const *words = kStopWords[language].words;
  int low = 0, high = kStopWords[language].count;
  while (low < high) {
    const int middle = (low + high) / 2;
    const size_t length = strlen(words[middle]);
    int order = memcmp(word, words[middle], size < length ? size : length);
    if (!order) order = size < length ? -1 : size > length ? 1 : 0;
    if (order < 0) high = middle;
    else if (order > 0) low = middle + 1;
    else return 1;
  }
  return 0;
}

int mde_text_normalized(const char *text, size_t size, int language, int flags,
                        void (*write)(void *context, const char *bytes, size_t size), void *context) {
  const uint8_t *s = (const uint8_t *)text;
  Bytes out = {NULL, 0, 0};
  size_t length = 0;
  for (size_t at = 0; at < size; at += length) {
    uint32_t point = Decode(s + at, size - at, &length);
    if (!(flags & MDE_TEXT_CASE_SENSITIVE)) point = Fold(point, language == LANGUAGE_TURKISH);
    if (!(flags & MDE_TEXT_DIACRITIC_SENSITIVE)) {
      int found = 0;
      const uint32_t letter = Mapped(kStripped, COUNT(kStripped), point, &found);
      if (found && !letter) continue;
      point = letter;
    }
    if (!Room(&out)) {
      free(out.data);
      return -1;
    }
    out.size += Encode(point, out.data + out.size);
  }
  write(context, out.data ? (const char *)out.data : "", out.size);
  free(out.data);
  return 0;
}

int mde_text_terms(const char *text, size_t size, int language, int flags,
                   void (*term)(void *context, const char *bytes, size_t size), void *context) {
  if (language < 0 || language > MDE_TEXT_LANGUAGES) language = 0;
  const uint8_t *s = (const uint8_t *)text;
  Bytes word = {NULL, 0, 0}, folded = {NULL, 0, 0}, stripped = {NULL, 0, 0};
  struct SN_env *stemmer = language ? kStemmers[language].create() : NULL;
  int words = 0, failed = language && !stemmer;
  size_t at = 0, length = 0;
  while (at < size && !failed) {
    uint32_t point = Decode(s + at, size - at, &length);
    if (IsDelimiter(point, language)) {
      at += length;
      continue;
    }
    /* A word: up to the next delimiter, folded (kept as it is too when its case is) */
    word.size = 0;
    folded.size = 0;
    for (; at < size; at += length) {
      point = Decode(s + at, size - at, &length);
      if (IsDelimiter(point, language)) break;
      if (!Room(&folded) || !Room(&word)) {
        failed = 1;
        break;
      }
      folded.size += Encode(Fold(point, language == LANGUAGE_TURKISH), folded.data + folded.size);
      if (flags & MDE_TEXT_CASE_SENSITIVE) word.size += Encode(point, word.data + word.size);
    }
    if (failed) break;
    if (language && IsStopWord(language, folded.data, folded.size)) continue;
    words++;
    const Bytes *kept = flags & MDE_TEXT_CASE_SENSITIVE ? &word : &folded;
    const uint8_t *stem = kept->data;
    size_t stemSize = kept->size;
    if (stemmer) {
      if (SN_set_current(stemmer, (int)stemSize, stem) != 0 || kStemmers[language].stem(stemmer) < 0) {
        failed = 1;
        break;
      }
      stem = stemmer->p;
      stemSize = (size_t)stemmer->l;
    }
    if (!(flags & MDE_TEXT_DIACRITIC_SENSITIVE)) {
      stripped.size = 0;
      for (size_t i = 0; i < stemSize; i += length) {
        point = Decode(stem + i, stemSize - i, &length);
        int found = 0;
        const uint32_t letter = Mapped(kStripped, COUNT(kStripped), point, &found);
        if (found && !letter) continue;
        if (!Room(&stripped)) {
          failed = 1;
          break;
        }
        stripped.size += Encode(letter, stripped.data + stripped.size);
      }
      if (failed) break;
      stem = stripped.data;
      stemSize = stripped.size;
    }
    /* A word of diacritics only gives no term */
    if (stemSize) term(context, (const char *)stem, stemSize);
  }
  if (stemmer) kStemmers[language].close(stemmer);
  free(word.data);
  free(folded.data);
  free(stripped.data);
  return failed ? -1 : words;
}
