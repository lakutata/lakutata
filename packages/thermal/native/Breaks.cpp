#include "Breaks.h"

#include <cstring>
#include <mutex>
#include <vector>

extern "C" {
#include "graphemebreak.h"
#include "linebreak.h"
}

namespace thermal {

namespace {

std::once_flag initialized;

//The tables of libunibreak, built once
void initialize()
{
    std::call_once(initialized, []() {
        init_linebreak();
        init_graphemebreak();
    });
}

//The length of the UTF-8 sequence starting with a byte
size_t sequenceLength(unsigned char lead)
{
    if (lead < 0x80) return 1;
    if ((lead >> 5) == 6) return 2;
    if ((lead >> 4) == 14) return 3;
    if ((lead >> 3) == 30) return 4;
    return 1;
}

bool isSpace(const std::string &character)
{
    return character == " " || character == "\t" || character == "\n" || character == "\r" || character == "\f";
}

//A word: as it is, or split between its graphemes when it is long
void emitWord(const std::string &word, const std::string &language, const std::function<void(const std::string &)> &onWord)
{
    if (word.empty()) return;
    std::vector<char> breaks(word.size());
    set_graphemebreaks_utf8(reinterpret_cast<const utf8_t *>(word.data()), word.size(), language.c_str(), breaks.data());
    size_t graphemes = 0;
    for (char brk : breaks) if (brk == GRAPHEMEBREAK_BREAK) graphemes++;
    if (graphemes <= LONG_WORD) {
        onWord(word);
        return;
    }
    size_t start = 0;
    for (size_t i = 0; i < word.size(); i++) {
        if (breaks[i] != GRAPHEMEBREAK_BREAK) continue;
        onWord(word.substr(start, i + 1 - start));
        start = i + 1;
    }
    if (start < word.size()) onWord(word.substr(start));
}

}

void splitText(const char *text, const std::string &language, const std::function<void(const std::string &)> &onWord, const std::function<void(const std::string &)> &onSpace)
{
    initialize();
    const size_t length = std::strlen(text);
    if (!length) return;
    std::vector<char> breaks(length);
    set_linebreaks_utf8(reinterpret_cast<const utf8_t *>(text), length, language.c_str(), breaks.data());
    std::string word;
    size_t at = 0;
    while (at < length) {
        const size_t size = std::min(sequenceLength(static_cast<unsigned char>(text[at])), length - at);
        const std::string character(text + at, size);
        const char brk = breaks[at + size - 1];
        at += size;
        if (isSpace(character)) {
            emitWord(word, language, onWord);
            word.clear();
            onSpace(character);
            continue;
        }
        word += character;
        if (brk == LINEBREAK_ALLOWBREAK || brk == LINEBREAK_MUSTBREAK) {
            emitWord(word, language, onWord);
            word.clear();
        }
    }
    emitWord(word, language, onWord);
}

}
