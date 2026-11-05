// The collators of the collations of MongoDB (collation.h).
#include "collation.h"

#include <unicode/ucol.h>
#include <unicode/udata.h>
#include <unicode/uloc.h>
#include <unicode/uvernum.h>

#include <cstring>
#include <mutex>
#include <string>
#include <vector>

namespace mongo_embedded {
namespace {

// The data of ICU, given once for the process (the addon is loaded again by each thread of workers) and kept as long as
// it runs
std::mutex dataMutex;
char* data = nullptr;

// The error of a collation, with the code of MongoDB that the client gives its error (2: BadValue)
Napi::Error CollationError(Napi::Env env, int code, const std::string& message) {
  Napi::Error error = Napi::Error::New(env, message);
  error.Set("code", Napi::Number::New(env, code));
  return error;
}

// collationData(): whether the data of ICU was given; collationData(bytes): the data given to ICU (a copy of the
// bytes, aligned, kept for the process), unless it was
Napi::Value CollationData(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  std::lock_guard<std::mutex> lock(dataMutex);
  if (data || info.Length() == 0 || !info[0].IsBuffer()) return Napi::Boolean::New(env, data != nullptr);
  Napi::Buffer<char> bytes = info[0].As<Napi::Buffer<char>>();
  char* copy = new char[bytes.Length()];
  std::memcpy(copy, bytes.Data(), bytes.Length());
  UErrorCode status = U_ZERO_ERROR;
  udata_setCommonData(copy, &status);
  if (U_FAILURE(status)) {
    delete[] copy;
    throw Napi::Error::New(env, std::string("The data of the collations could not be loaded: ") + u_errorName(status));
  }
  data = copy;
  return Napi::Boolean::New(env, true);
}

UCollator* CollatorOf(const Napi::Value& value) { return value.As<Napi::External<UCollator>>().Data(); }

// The value of an attribute of a collation, on or off
UColAttributeValue Switch(bool on) { return on ? UCOL_ON : UCOL_OFF; }

// collator(locale, {strength, caseLevel, caseFirst, numericOrdering, alternate, maxVariable, normalization, backwards}):
// {collator, strength, caseLevel, ...}: the collator of a locale with the attributes given (checked by the client),
// and the attributes it takes, the ones not given those of its locale. A locale ICU does not know (it would fall back
// to the root locale) fails with the code 2 of MongoDB.
Napi::Value Collator(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!data) throw Napi::Error::New(env, "The data of the collations is not loaded");
  const std::string locale = info[0].As<Napi::String>().Utf8Value();
  Napi::Object attributes = info[1].As<Napi::Object>();
  UErrorCode status = U_ZERO_ERROR;
  UCollator* collator = ucol_open(locale.c_str(), &status);
  const std::string invalid = "Field 'locale' is invalid in: { locale: \"" + locale + "\" }";
  if (U_FAILURE(status)) throw CollationError(env, 2, invalid);
  // A locale not known: ICU falls back to the root locale
  const char* valid = ucol_getLocaleByType(collator, ULOC_VALID_LOCALE, &status);
  char base[ULOC_FULLNAME_CAPACITY] = {0};
  UErrorCode baseStatus = U_ZERO_ERROR;
  uloc_getBaseName(locale.c_str(), base, sizeof(base), &baseStatus);
  if (U_FAILURE(status) || !valid || (std::strcmp(valid, "root") == 0 && std::strcmp(base, "root") != 0 && base[0] != 0)) {
    ucol_close(collator);
    throw CollationError(env, 2, invalid);
  }
  static const UColAttributeValue strengths[] = {UCOL_PRIMARY, UCOL_SECONDARY, UCOL_TERTIARY, UCOL_QUATERNARY, UCOL_IDENTICAL};
  if (attributes.Has("strength")) {
    const int strength = attributes.Get("strength").As<Napi::Number>().Int32Value();
    ucol_setAttribute(collator, UCOL_STRENGTH, strengths[strength - 1], &status);
  }
  if (attributes.Has("caseLevel"))
    ucol_setAttribute(collator, UCOL_CASE_LEVEL, Switch(attributes.Get("caseLevel").ToBoolean()), &status);
  if (attributes.Has("caseFirst")) {
    const std::string caseFirst = attributes.Get("caseFirst").As<Napi::String>().Utf8Value();
    ucol_setAttribute(collator, UCOL_CASE_FIRST,
                      caseFirst == "upper" ? UCOL_UPPER_FIRST : caseFirst == "lower" ? UCOL_LOWER_FIRST : UCOL_OFF, &status);
  }
  if (attributes.Has("numericOrdering"))
    ucol_setAttribute(collator, UCOL_NUMERIC_COLLATION, Switch(attributes.Get("numericOrdering").ToBoolean()), &status);
  if (attributes.Has("alternate"))
    ucol_setAttribute(collator, UCOL_ALTERNATE_HANDLING,
                      attributes.Get("alternate").As<Napi::String>().Utf8Value() == "shifted" ? UCOL_SHIFTED : UCOL_NON_IGNORABLE,
                      &status);
  if (attributes.Has("maxVariable"))
    ucol_setMaxVariable(collator,
                        attributes.Get("maxVariable").As<Napi::String>().Utf8Value() == "space" ? UCOL_REORDER_CODE_SPACE
                                                                                               : UCOL_REORDER_CODE_PUNCTUATION,
                        &status);
  if (attributes.Has("normalization"))
    ucol_setAttribute(collator, UCOL_NORMALIZATION_MODE, Switch(attributes.Get("normalization").ToBoolean()), &status);
  if (attributes.Has("backwards"))
    ucol_setAttribute(collator, UCOL_FRENCH_COLLATION, Switch(attributes.Get("backwards").ToBoolean()), &status);
  if (U_FAILURE(status)) {
    ucol_close(collator);
    throw CollationError(env, 2, std::string("The collation could not be set: ") + u_errorName(status));
  }
  Napi::Object result = Napi::Object::New(env);
  result.Set("collator", Napi::External<UCollator>::New(env, collator, [](Napi::Env, UCollator* opened) { ucol_close(opened); }));
  const UColAttributeValue strength = ucol_getAttribute(collator, UCOL_STRENGTH, &status);
  int level = 3;
  for (int index = 0; index < 5; index++)
    if (strengths[index] == strength) level = index + 1;
  result.Set("strength", Napi::Number::New(env, level));
  result.Set("caseLevel", Napi::Boolean::New(env, ucol_getAttribute(collator, UCOL_CASE_LEVEL, &status) == UCOL_ON));
  const UColAttributeValue caseFirst = ucol_getAttribute(collator, UCOL_CASE_FIRST, &status);
  result.Set("caseFirst", Napi::String::New(env, caseFirst == UCOL_UPPER_FIRST ? "upper" : caseFirst == UCOL_LOWER_FIRST ? "lower" : "off"));
  result.Set("numericOrdering", Napi::Boolean::New(env, ucol_getAttribute(collator, UCOL_NUMERIC_COLLATION, &status) == UCOL_ON));
  result.Set("alternate", Napi::String::New(env, ucol_getAttribute(collator, UCOL_ALTERNATE_HANDLING, &status) == UCOL_SHIFTED
                                                     ? "shifted"
                                                     : "non-ignorable"));
  result.Set("maxVariable", Napi::String::New(env, ucol_getMaxVariable(collator) == UCOL_REORDER_CODE_SPACE ? "space" : "punct"));
  result.Set("normalization", Napi::Boolean::New(env, ucol_getAttribute(collator, UCOL_NORMALIZATION_MODE, &status) == UCOL_ON));
  result.Set("backwards", Napi::Boolean::New(env, ucol_getAttribute(collator, UCOL_FRENCH_COLLATION, &status) == UCOL_ON));
  result.Set("version", Napi::String::New(env, U_ICU_VERSION));
  return result;
}

// The sort key of a string (its bytes compared give the order of the collator; it ends with a 0 and holds no other)
Napi::Buffer<uint8_t> SortKeyOf(Napi::Env env, UCollator* collator, const std::u16string& text) {
  const UChar* characters = reinterpret_cast<const UChar*>(text.data());
  const int32_t length = static_cast<int32_t>(text.size());
  uint8_t stack[256];
  int32_t size = ucol_getSortKey(collator, characters, length, stack, sizeof(stack));
  if (size <= static_cast<int32_t>(sizeof(stack))) return Napi::Buffer<uint8_t>::Copy(env, stack, size);
  std::vector<uint8_t> heap(size);
  size = ucol_getSortKey(collator, characters, length, heap.data(), size);
  return Napi::Buffer<uint8_t>::Copy(env, heap.data(), size);
}

// sortKey(collator, string): the sort key of a string
Napi::Value SortKey(const Napi::CallbackInfo& info) {
  return SortKeyOf(info.Env(), CollatorOf(info[0]), info[1].As<Napi::String>().Utf16Value());
}

// sortKeys(collator, strings): the sort keys of strings
Napi::Value SortKeys(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  UCollator* collator = CollatorOf(info[0]);
  Napi::Array strings = info[1].As<Napi::Array>();
  Napi::Array keys = Napi::Array::New(env, strings.Length());
  for (uint32_t index = 0; index < strings.Length(); index++)
    keys.Set(index, SortKeyOf(env, collator, strings.Get(index).As<Napi::String>().Utf16Value()));
  return keys;
}

// compareStrings(collator, a, b): -1, 0 or 1, the order of two strings
Napi::Value CompareStrings(const Napi::CallbackInfo& info) {
  const std::u16string a = info[1].As<Napi::String>().Utf16Value();
  const std::u16string b = info[2].As<Napi::String>().Utf16Value();
  const UCollationResult result =
      ucol_strcoll(CollatorOf(info[0]), reinterpret_cast<const UChar*>(a.data()), static_cast<int32_t>(a.size()),
                   reinterpret_cast<const UChar*>(b.data()), static_cast<int32_t>(b.size()));
  return Napi::Number::New(info.Env(), result == UCOL_LESS ? -1 : result == UCOL_GREATER ? 1 : 0);
}

}  // namespace

void InitCollation(Napi::Env env, Napi::Object exports) {
  exports.Set("collationData", Napi::Function::New(env, CollationData, "collationData"));
  exports.Set("collator", Napi::Function::New(env, Collator, "collator"));
  exports.Set("sortKey", Napi::Function::New(env, SortKey, "sortKey"));
  exports.Set("sortKeys", Napi::Function::New(env, SortKeys, "sortKeys"));
  exports.Set("compareStrings", Napi::Function::New(env, CompareStrings, "compareStrings"));
}

}  // namespace mongo_embedded
