// The prefilter of the scans: the comparisons of the top-level fields of a filter with numbers, which a document must
// not fail to be given to mingo. A document failing one is left out before it is decoded; any other document (the field
// missing, an array, another type, NaN, an integer of 64 bits beyond 2^53, a document not read to its end) is given, as
// mingo is the one that tells which documents match.
#ifndef MONGO_EMBEDDED_PREFILTER_H
#define MONGO_EMBEDDED_PREFILTER_H

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace mongo_embedded {

enum class Comparison { Greater = 1, GreaterOrEqual = 2, Less = 3, LessOrEqual = 4, Equal = 5, NotEqual = 6 };

struct Predicate {
  std::string field;
  Comparison comparison;
  double value;
};

// Whether a document (its BSON) may match all the predicates
bool MayMatch(const uint8_t* document, size_t size, const std::vector<Predicate>& predicates);

}  // namespace mongo_embedded

#endif
