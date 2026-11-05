// The collators of the collations of MongoDB, from the ICU of the package (vendor/icu): its data given once per process,
// a collator opened by a locale and the attributes of a collation, the attributes it takes (the ones of its locale when
// they are not given), the sort keys of strings and their comparison. They run on the thread of JavaScript.
#ifndef MONGO_EMBEDDED_COLLATION_H
#define MONGO_EMBEDDED_COLLATION_H

#include <napi.h>

namespace mongo_embedded {

// Sets the functions of the collators on the exports of the addon: collationData, collator, sortKey, sortKeys,
// compareStrings
void InitCollation(Napi::Env env, Napi::Object exports);

}  // namespace mongo_embedded

#endif
