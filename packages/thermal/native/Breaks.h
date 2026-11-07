//The line breaking of the text (litehtml's split_text): the break opportunities of Unicode (UAX #14, by libunibreak),
//which keep closing punctuation off the start of a line and opening punctuation off its end (、。，）！ after the character
//before them), and the long words (a web address, an order number) split between their graphemes so that they wrap
#pragma once

#include <functional>
#include <string>

namespace thermal {

//The words longer than this (in graphemes) can break between any two of their graphemes
constexpr size_t LONG_WORD = 16;

//Split a text into its words and its spaces (each white space character apart), in their order
void splitText(const char *text, const std::string &language, const std::function<void(const std::string &)> &onWord, const std::function<void(const std::string &)> &onSpace);

}
