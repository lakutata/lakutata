// lakutata: the limits of the exact numbers computed: a power whose result would have more than 2^20 bits (about
// 315000 digits) stays a power, and the gamma function of an integer above 20001 (its factorial) stays as written, as
// the factorials of the parser of the addon. SymEngine computed them all, which could take hours and all the memory;
// printing a number is quadratic in its digits (100000! takes 4 s).
#ifndef SYMENGINE_LIMITS_H
#define SYMENGINE_LIMITS_H

#include <symengine/mp_class.h>

namespace SymEngine
{

constexpr unsigned long EXACT_BITS = 1ul << 20;
constexpr long GAMMA_LIMIT = 20001;

inline unsigned long bit_length(const integer_class &i)
{
    return i == 0 ? 0 : boost::multiprecision::msb(mp_abs(i)) + 1;
}

// Whether |base|**|exponent| has more than EXACT_BITS bits
inline bool exact_power_too_large(const integer_class &base,
                                  const integer_class &exponent)
{
    const unsigned long bits = bit_length(base);
    if (bits <= 1)
        return false;
    const integer_class magnitude = mp_abs(exponent);
    return not mp_fits_ulong_p(magnitude)
           or mp_get_ui(magnitude) > EXACT_BITS / bits;
}

} // namespace SymEngine

#endif
