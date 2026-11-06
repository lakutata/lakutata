/* The text of the text indexes, as MongoDB 8.0 makes it (text indexes of version 3): words split by the delimiters of
** Unicode 8.0, case folded, the stop words of their language left out, stemmed by Snowball, their diacritics removed */
#ifndef MDE_TEXT_H
#define MDE_TEXT_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* The flags of the terms of a text: its case kept (no folding), its diacritics kept */
#define MDE_TEXT_CASE_SENSITIVE 1
#define MDE_TEXT_DIACRITIC_SENSITIVE 2

/* The number of the languages (their ids from 1; 0 is none: no stop words, no stemming) */
#define MDE_TEXT_LANGUAGES 15

/* The terms of a text in a language (an id, 0 to MDE_TEXT_LANGUAGES): each one written by a function given the bytes
** of its UTF-8 (in the order of the words); the number of its words, the stop words left out; -1 when the memory runs
** out */
int mde_text_terms(const char *text, size_t size, int language, int flags,
                   void (*term)(void *context, const char *bytes, size_t size), void *context);

/* A text case folded (unless flags has MDE_TEXT_CASE_SENSITIVE: by the rules of a language, Turkish its own), its
** diacritics removed (unless flags has MDE_TEXT_DIACRITIC_SENSITIVE), its words not split, written by a function given
** its UTF-8 (the phrases of a $text and the texts they are looked for in): 0, or -1 when the memory runs out */
int mde_text_normalized(const char *text, size_t size, int language, int flags,
                        void (*write)(void *context, const char *bytes, size_t size), void *context);

#ifdef __cplusplus
}
#endif

#endif
