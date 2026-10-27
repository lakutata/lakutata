//The real roots of polynomials isolated (see RealRoots.h)
#include "RealRoots.h"

#include <algorithm>

#include "../async/Pool.h"
#include "../core/Errors.h"

namespace math {
namespace poly {

namespace {

//The sign changes of the coefficients, the zeros skipped
long signVariations(const Dup &f)
{
    long variations = 0;
    int last = 0;
    for (const Z &c : f) {
        const int sign = c > 0 ? 1 : (c < 0 ? -1 : 0);
        if (sign == 0) continue;
        if (last != 0 && sign != last) variations++;
        last = sign;
    }
    return variations;
}

//f(x + 1)
Dup taylorShift(Dup f)
{
    const size_t n = f.empty() ? 0 : f.size() - 1;
    for (size_t i = 0; i < n; i++) {
        for (size_t j = 1; j <= n - i; j++) f[j] += f[j - 1];
    }
    return f;
}

//An upper bound of the number of roots in (0, 1), exact when it is 0 or 1: the sign variations of (x + 1)^n f(1/(x + 1))
long rootsInUnit(const Dup &f)
{
    return signVariations(taylorShift(Dup(f.rbegin(), f.rend())));
}

//2^n f(x/2): the roots doubled
Dup halved(const Dup &f)
{
    Dup g = f;
    for (size_t i = 0; i < g.size(); i++) g[i] <<= static_cast<unsigned>(i);
    return g;
}

//The roots of f in (0, 1) as intervals (c/2^k, (c + 1)/2^k), scaled by a factor
void isolateUnit(const Dup &f, const Q &scale, bool negative, std::vector<RootInterval> &found)
{
    struct Part {
        Dup f;
        Z c;
        unsigned k;
    };
    std::vector<Part> pending{{f, Z(0), 0}};
    while (!pending.empty()) {
        checkpoint();
        Part part = std::move(pending.back());
        pending.pop_back();
        const long count = rootsInUnit(part.f);
        if (count == 0) continue;
        if (count == 1) {
            const Z denominator = Z(1) << part.k;
            const Q low = Q(part.c, denominator) * scale, high = Q(part.c + 1, denominator) * scale;
            found.push_back(negative ? RootInterval{-high, -low} : RootInterval{low, high});
            continue;
        }
        if (part.k > 100000) throw MathError(ErrorCode::Internal, "The real roots are not separated");
        Dup left = halved(part.f);
        Dup right = taylorShift(left);
        pending.push_back({std::move(right), 2 * part.c + 1, part.k + 1});
        pending.push_back({std::move(left), 2 * part.c, part.k + 1});
    }
}

}

std::vector<RootInterval> dup_isolate_real_roots(const Dup &f)
{
    std::vector<RootInterval> found;
    const long n = dup_degree(f);
    if (n < 1) return found;
    //Cauchy's bound 1 + max |a_i|/|a_n|, raised to a power of 2
    Z largest = 0;
    for (size_t i = 1; i < f.size(); i++) largest = std::max(largest, Z(SymEngine::mp_abs(f[i])));
    const Z lead = SymEngine::mp_abs(f[0]);
    const Z bound = 1 + (largest + lead - 1) / lead;
    unsigned bits = 0;
    while ((Z(1) << bits) < bound) bits++;
    const Z B = Z(1) << bits;
    //f(B x) for the positive roots, f(-B x) for the negative ones
    Dup positive = f, negative = f;
    for (size_t i = 0; i < f.size(); i++) {
        const unsigned power = static_cast<unsigned>(static_cast<size_t>(n) - i);
        positive[i] <<= bits * power;
        negative[i] = positive[i];
        if (power % 2 == 1) negative[i] = -negative[i];
    }
    isolateUnit(positive, Q(B), false, found);
    isolateUnit(negative, Q(B), true, found);
    std::sort(found.begin(), found.end(), [](const RootInterval &x, const RootInterval &y) { return x.a < y.a; });
    return found;
}

int dup_sign_at(const Dup &f, const Q &x)
{
    if (f.empty()) return 0;
    //q^n f(p/q) = the sum of a_i p^(n - i) q^i, q > 0
    const Z p = SymEngine::get_num(x), q = SymEngine::get_den(x);
    Z value = f[0], power = 1;
    for (size_t i = 1; i < f.size(); i++) {
        power *= q;
        value = value * p + f[i] * power;
    }
    return value > 0 ? 1 : (value < 0 ? -1 : 0);
}

void dup_refine_root(const Dup &f, RootInterval &interval)
{
    const Q middle = (interval.a + interval.b) / 2;
    const int at = dup_sign_at(f, middle);
    if (at == 0) throw MathError(ErrorCode::Internal, "A rational root of a polynomial without one");
    if (at == dup_sign_at(f, interval.a)) {
        interval.a = middle;
    } else {
        interval.b = middle;
    }
}

}
}
