#include "prefilter.h"

#include <cstring>

namespace mongo_embedded {
namespace {

uint32_t ReadU32(const uint8_t* data) {
  return static_cast<uint32_t>(data[0]) | (static_cast<uint32_t>(data[1]) << 8) | (static_cast<uint32_t>(data[2]) << 16) |
         (static_cast<uint32_t>(data[3]) << 24);
}

// The size of the value of an element of a type at p (in a document ending at end), or -1 when it cannot be told
int64_t ValueSize(uint8_t type, const uint8_t* p, const uint8_t* end) {
  switch (type) {
    case 0x01: case 0x09: case 0x11: case 0x12: return 8;
    case 0x02: case 0x0D: case 0x0E: return end - p >= 4 ? 4 + static_cast<int64_t>(ReadU32(p)) : -1;
    case 0x03: case 0x04: case 0x0F: return end - p >= 4 ? static_cast<int64_t>(ReadU32(p)) : -1;
    case 0x05: return end - p >= 4 ? 5 + static_cast<int64_t>(ReadU32(p)) : -1;
    case 0x06: case 0x0A: case 0x7F: case 0xFF: return 0;
    case 0x07: return 12;
    case 0x08: return 1;
    case 0x10: return 4;
    case 0x13: return 16;
    default: return -1;
  }
}

// The integers of 64 bits a double holds exactly
constexpr int64_t kExact = int64_t{1} << 53;

}  // namespace

bool MayMatch(const uint8_t* document, size_t size, const std::vector<Predicate>& predicates) {
  for (const Predicate& predicate : predicates) {
    if (predicate.value != predicate.value) continue;
    const uint8_t* end = document + size;
    const uint8_t* p = document + 4;
    while (p < end && *p != 0) {
      const uint8_t type = *p++;
      const uint8_t* name = p;
      while (p < end && *p != 0) p++;
      if (p >= end) return true;
      const size_t length = static_cast<size_t>(p - name);
      p++;
      const int64_t bytes = ValueSize(type, p, end);
      if (bytes < 0 || p + bytes > end) return true;
      if (length == predicate.field.size() && std::memcmp(name, predicate.field.data(), length) == 0) {
        double value;
        if (type == 0x01) {
          std::memcpy(&value, p, 8);
        } else if (type == 0x10) {
          int32_t integer;
          std::memcpy(&integer, p, 4);
          value = integer;
        } else if (type == 0x12) {
          int64_t integer;
          std::memcpy(&integer, p, 8);
          if (integer > kExact || integer < -kExact) break;
          value = static_cast<double>(integer);
        } else {
          break;
        }
        if (value != value) break;
        bool holds = false;
        switch (predicate.comparison) {
          case Comparison::Greater: holds = value > predicate.value; break;
          case Comparison::GreaterOrEqual: holds = value >= predicate.value; break;
          case Comparison::Less: holds = value < predicate.value; break;
          case Comparison::LessOrEqual: holds = value <= predicate.value; break;
          case Comparison::Equal: holds = value == predicate.value; break;
          case Comparison::NotEqual: holds = value != predicate.value; break;
        }
        if (!holds) return false;
        break;
      }
      p += bytes;
    }
  }
  return true;
}

}  // namespace mongo_embedded
