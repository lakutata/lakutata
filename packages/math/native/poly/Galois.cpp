//The polynomials modulo a prime, after SymPy's galoistools.py: gf_from_int_poly, gf_to_int_poly, gf_strip, gf_add,
//gf_sub, gf_mul, gf_sqr, gf_add_mul, gf_sub_mul, gf_mul_ground, gf_lshift, gf_div, gf_rem, gf_quo, gf_monic, gf_gcd,
//gf_gcdex, gf_diff, gf_pow_mod, gf_frobenius_monomial_base, gf_frobenius_map, _gf_pow_pnm1d2, gf_sqf_p,
//gf_ddf_zassenhaus, gf_edf_zassenhaus, gf_zassenhaus, gf_factor_sqf (see Galois.h)
#include "Galois.h"

#include <algorithm>

#include "../async/Pool.h"
#include "../core/Errors.h"

namespace math {
namespace poly {

SmallField::T SmallField::reduce(const Z &c) const
{
    return static_cast<T>(floorMod(c, Z(p)));
}

Z SmallField::lift(T a) const
{
    return a <= p / 2 ? Z(a) : Z(a) - Z(p);
}

SmallField::T SmallField::inv(T a) const
{
    //The extended Euclid's algorithm on signed 64-bit integers (p < 2^31)
    std::int64_t r0 = static_cast<std::int64_t>(p), r1 = static_cast<std::int64_t>(a % p), s0 = 0, s1 = 1;
    while (r1 != 0) {
        const std::int64_t q = r0 / r1;
        std::swap(r0, r1);
        r1 -= q * r0;
        std::swap(s0, s1);
        s1 -= q * s0;
    }
    if (r0 != 1) throw MathError(ErrorCode::Internal, "An integer without an inverse modulo a prime");
    return static_cast<T>(((s0 % static_cast<std::int64_t>(p)) + static_cast<std::int64_t>(p)) % static_cast<std::int64_t>(p));
}

SmallField::T SmallField::fromLong(long a) const
{
    const std::int64_t m = static_cast<std::int64_t>(p);
    return static_cast<T>(((static_cast<std::int64_t>(a) % m) + m) % m);
}

BigField::T BigField::inv(const T &a) const
{
    Z g, s, t;
    SymEngine::mp_gcdext(g, s, t, a, p);
    if (g != 1 && g != -1) throw MathError(ErrorCode::Internal, "An integer without an inverse modulo a prime");
    return floorMod(g == 1 ? s : Z(-s), p);
}

std::uint64_t GfRandom::next()
{
    state = state * 6364136223846793005ULL + 1442695040888963407ULL;
    return state >> 33;
}

template <typename F> Gf<F> gf_from_int_poly(const F &field, const Dup &f)
{
    Gf<F> g;
    g.reserve(f.size());
    for (const Z &c : f) g.push_back(field.reduce(c));
    gf_strip<F>(g);
    return g;
}

template <typename F> Dup gf_to_int_poly(const F &field, const Gf<F> &f)
{
    Dup g;
    g.reserve(f.size());
    for (const auto &c : f) g.push_back(field.lift(c));
    return g;
}

template <typename F> void gf_strip(Gf<F> &f)
{
    std::size_t leading = 0;
    while (leading < f.size() && f[leading] == 0) leading++;
    if (leading) f.erase(f.begin(), f.begin() + static_cast<std::ptrdiff_t>(leading));
}

namespace {

template <typename F> long degree(const Gf<F> &f)
{
    return static_cast<long>(f.size()) - 1;
}

}

template <typename F> Gf<F> gf_add(const F &field, const Gf<F> &f, const Gf<F> &g)
{
    if (f.empty()) return g;
    if (g.empty()) return f;
    const std::size_t n = f.size(), m = g.size();
    Gf<F> h = n >= m ? f : g;
    const Gf<F> &shorter = n >= m ? g : f;
    const std::size_t offset = h.size() - shorter.size();
    for (std::size_t i = 0; i < shorter.size(); i++) h[offset + i] = field.add(h[offset + i], shorter[i]);
    gf_strip<F>(h);
    return h;
}

template <typename F> Gf<F> gf_sub(const F &field, const Gf<F> &f, const Gf<F> &g)
{
    Gf<F> negated;
    negated.reserve(g.size());
    for (const auto &c : g) negated.push_back(field.neg(c));
    return gf_add<F>(field, f, negated);
}

template <typename F> Gf<F> gf_mul(const F &field, const Gf<F> &f, const Gf<F> &g)
{
    if (f.empty() || g.empty()) return {};
    Gf<F> h(f.size() + g.size() - 1, typename F::T(0));
    for (std::size_t i = 0; i < f.size(); i++) {
        if (f[i] == 0) continue;
        for (std::size_t j = 0; j < g.size(); j++) h[i + j] = field.add(h[i + j], field.mul(f[i], g[j]));
    }
    gf_strip<F>(h);
    return h;
}

template <typename F> Gf<F> gf_add_mul(const F &field, const Gf<F> &f, const Gf<F> &g, const Gf<F> &h)
{
    return gf_add<F>(field, f, gf_mul<F>(field, g, h));
}

template <typename F> Gf<F> gf_sub_mul(const F &field, const Gf<F> &f, const Gf<F> &g, const Gf<F> &h)
{
    return gf_sub<F>(field, f, gf_mul<F>(field, g, h));
}

template <typename F> Gf<F> gf_mul_ground(const F &field, const Gf<F> &f, const typename F::T &a)
{
    if (a == 0) return {};
    Gf<F> h;
    h.reserve(f.size());
    for (const auto &c : f) h.push_back(field.mul(a, c));
    gf_strip<F>(h);
    return h;
}

template <typename F> Gf<F> gf_lshift(const Gf<F> &f, long n)
{
    if (f.empty()) return f;
    Gf<F> h = f;
    h.insert(h.end(), static_cast<std::size_t>(n), typename F::T(0));
    return h;
}

template <typename F> void gf_div(const F &field, const Gf<F> &f, const Gf<F> &g, Gf<F> &q, Gf<F> &r)
{
    const long df = degree<F>(f), dg = degree<F>(g);
    if (g.empty()) throw MathError(ErrorCode::Internal, "A polynomial divided by 0 modulo a prime");
    if (df < dg) {
        q.clear();
        r = f;
        return;
    }
    const typename F::T inv = field.inv(g[0]);
    Gf<F> h = f;
    const long dq = df - dg, dr = dg - 1;
    for (long i = 0; i <= df; i++) {
        typename F::T coeff = h[static_cast<std::size_t>(i)];
        for (long j = std::max(0L, dg - i); j <= std::min(df - i, dr); j++) {
            coeff = field.sub(coeff, field.mul(h[static_cast<std::size_t>(i + j - dg)], g[static_cast<std::size_t>(dg - j)]));
        }
        if (i <= dq) coeff = field.mul(coeff, inv);
        h[static_cast<std::size_t>(i)] = coeff;
    }
    q.assign(h.begin(), h.begin() + dq + 1);
    r.assign(h.begin() + dq + 1, h.end());
    gf_strip<F>(r);
}

template <typename F> Gf<F> gf_rem(const F &field, const Gf<F> &f, const Gf<F> &g)
{
    Gf<F> q, r;
    gf_div<F>(field, f, g, q, r);
    return r;
}

template <typename F> Gf<F> gf_quo(const F &field, const Gf<F> &f, const Gf<F> &g)
{
    Gf<F> q, r;
    gf_div<F>(field, f, g, q, r);
    return q;
}

template <typename F> Gf<F> gf_monic(const F &field, const Gf<F> &f, typename F::T &lc)
{
    if (f.empty()) {
        lc = typename F::T(0);
        return f;
    }
    lc = f[0];
    if (field.isOne(lc)) return f;
    return gf_mul_ground<F>(field, f, field.inv(lc));
}

template <typename F> Gf<F> gf_gcd(const F &field, Gf<F> f, Gf<F> g)
{
    while (!g.empty()) {
        Gf<F> r = gf_rem<F>(field, f, g);
        f = std::move(g);
        g = std::move(r);
    }
    typename F::T lc;
    return gf_monic<F>(field, f, lc);
}

template <typename F> void gf_gcdex(const F &field, const Gf<F> &f, const Gf<F> &g, Gf<F> &s, Gf<F> &t, Gf<F> &h)
{
    using T = typename F::T;
    if (f.empty() && g.empty()) {
        s = {T(1)};
        t.clear();
        h.clear();
        return;
    }
    T p0, p1;
    Gf<F> r0 = gf_monic<F>(field, f, p0), r1 = gf_monic<F>(field, g, p1);
    if (f.empty()) {
        s.clear();
        t = {field.inv(p1)};
        h = r1;
        return;
    }
    if (g.empty()) {
        s = {field.inv(p0)};
        t.clear();
        h = r0;
        return;
    }
    Gf<F> s0 = {field.inv(p0)}, s1, t0, t1 = {field.inv(p1)};
    for (;;) {
        Gf<F> Q, R;
        gf_div<F>(field, r0, r1, Q, R);
        if (R.empty()) break;
        T lc;
        Gf<F> monic = gf_monic<F>(field, R, lc);
        r0 = std::move(r1);
        r1 = std::move(monic);
        const T inv = field.inv(lc);
        const Gf<F> sNext = gf_sub_mul<F>(field, s0, s1, Q), tNext = gf_sub_mul<F>(field, t0, t1, Q);
        s0 = std::move(s1);
        s1 = gf_mul_ground<F>(field, sNext, inv);
        t0 = std::move(t1);
        t1 = gf_mul_ground<F>(field, tNext, inv);
    }
    s = s1;
    t = t1;
    h = r1;
}

namespace {

using G = Gf<SmallField>;

G gfDiff(const SmallField &field, const G &f)
{
    const long df = degree<SmallField>(f);
    G h(static_cast<std::size_t>(std::max(df, 0L)), 0);
    long n = df;
    for (std::size_t i = 0; i + 1 < f.size(); i++) {
        const SmallField::T coeff = field.mul(f[i], field.fromLong(n));
        if (coeff) h[static_cast<std::size_t>(df - n)] = coeff;
        n--;
    }
    gf_strip<SmallField>(h);
    return h;
}

G gfPowMod(const SmallField &field, G f, std::uint64_t n, const G &g)
{
    if (!n) return {1};
    if (n == 1) return gf_rem<SmallField>(field, f, g);
    if (n == 2) return gf_rem<SmallField>(field, gf_mul<SmallField>(field, f, f), g);
    G h = {1};
    for (;;) {
        if (n & 1) {
            h = gf_rem<SmallField>(field, gf_mul<SmallField>(field, h, f), g);
            n--;
        }
        n >>= 1;
        if (!n) break;
        f = gf_rem<SmallField>(field, gf_mul<SmallField>(field, f, f), g);
    }
    return h;
}

std::vector<G> frobeniusMonomialBase(const SmallField &field, const G &g)
{
    const long n = degree<SmallField>(g);
    if (n == 0) return {};
    std::vector<G> b(static_cast<std::size_t>(n));
    b[0] = {1};
    if (static_cast<long>(field.p) < n) {
        for (long i = 1; i < n; i++) b[static_cast<std::size_t>(i)] = gf_rem<SmallField>(field, gf_lshift<SmallField>(b[static_cast<std::size_t>(i - 1)], static_cast<long>(field.p)), g);
    } else if (n > 1) {
        b[1] = gfPowMod(field, {1, 0}, field.p, g);
        for (long i = 2; i < n; i++) b[static_cast<std::size_t>(i)] = gf_rem<SmallField>(field, gf_mul<SmallField>(field, b[static_cast<std::size_t>(i - 1)], b[1]), g);
    }
    return b;
}

G frobeniusMap(const SmallField &field, G f, const G &g, const std::vector<G> &b)
{
    const long m = degree<SmallField>(g);
    if (degree<SmallField>(f) >= m) f = gf_rem<SmallField>(field, f, g);
    if (f.empty()) return {};
    const long n = degree<SmallField>(f);
    G sf = {f.back()};
    for (long i = 1; i <= n; i++) sf = gf_add<SmallField>(field, sf, gf_mul_ground<SmallField>(field, b[static_cast<std::size_t>(i)], f[static_cast<std::size_t>(n - i)]));
    return sf;
}

G powPnm1d2(const SmallField &field, G f, long n, const G &g, const std::vector<G> &b)
{
    f = gf_rem<SmallField>(field, f, g);
    G h = f, r = f;
    for (long i = 1; i < n; i++) {
        h = frobeniusMap(field, h, g, b);
        r = gf_rem<SmallField>(field, gf_mul<SmallField>(field, r, h), g);
    }
    return gfPowMod(field, r, (field.p - 1) / 2, g);
}

//_sort_factors(multiple=False): by the number of coefficients, then the coefficients
void sortFactors(std::vector<G> &factors)
{
    std::sort(factors.begin(), factors.end(), [](const G &a, const G &b) {
        if (a.size() != b.size()) return a.size() < b.size();
        return a < b;
    });
}

std::vector<std::pair<G, long>> ddfZassenhaus(const SmallField &field, G f)
{
    long i = 1;
    G g = {1, 0};
    std::vector<std::pair<G, long>> factors;
    std::vector<G> b = frobeniusMonomialBase(field, f);
    while (2 * i <= degree<SmallField>(f)) {
        checkpoint();
        g = frobeniusMap(field, g, f, b);
        const G h = gf_gcd<SmallField>(field, f, gf_sub<SmallField>(field, g, {1, 0}));
        if (h != G{1}) {
            factors.push_back({h, i});
            f = gf_quo<SmallField>(field, f, h);
            g = gf_rem<SmallField>(field, g, f);
            b = frobeniusMonomialBase(field, f);
        }
        i++;
    }
    if (f != G{1}) factors.push_back({f, degree<SmallField>(f)});
    return factors;
}

std::vector<G> edfZassenhaus(const SmallField &field, const G &f, long n, GfRandom &random)
{
    std::vector<G> factors = {f};
    if (degree<SmallField>(f) <= n) return factors;
    const long N = degree<SmallField>(f) / n;
    const std::vector<G> b = frobeniusMonomialBase(field, f);
    while (static_cast<long>(factors.size()) < N) {
        checkpoint();
        //gf_random(2n - 1): 1 first, then random coefficients
        G r = {1};
        for (long i = 0; i < 2 * n - 1; i++) r.push_back(random.next() % field.p);
        const G h = powPnm1d2(field, r, n, f, b);
        G hMinusOne = h;
        if (hMinusOne.empty()) {
            hMinusOne = {field.p - 1};
        } else {
            hMinusOne.back() = field.sub(hMinusOne.back(), 1);
            gf_strip<SmallField>(hMinusOne);
        }
        const G g = gf_gcd<SmallField>(field, f, hMinusOne);
        if (g != G{1} && g != f) {
            std::vector<G> left = edfZassenhaus(field, g, n, random), right = edfZassenhaus(field, gf_quo<SmallField>(field, f, g), n, random);
            factors = left;
            factors.insert(factors.end(), right.begin(), right.end());
        }
    }
    sortFactors(factors);
    return factors;
}

}

bool gf_sqf_p(const SmallField &field, const Gf<SmallField> &f0)
{
    SmallField::T lc;
    const G f = gf_monic<SmallField>(field, f0, lc);
    if (f.empty()) return true;
    return gf_gcd<SmallField>(field, f, gfDiff(field, f)) == G{1};
}

std::vector<Gf<SmallField>> gf_factor_sqf(const SmallField &field, const Gf<SmallField> &f0, SmallField::T &lc)
{
    const G f = gf_monic<SmallField>(field, f0, lc);
    if (degree<SmallField>(f) < 1) return {};
    GfRandom random(0x6c616b75746174ULL ^ field.p);
    std::vector<G> factors;
    for (const auto &[factor, n] : ddfZassenhaus(field, f)) {
        const std::vector<G> equal = edfZassenhaus(field, factor, n, random);
        factors.insert(factors.end(), equal.begin(), equal.end());
    }
    sortFactors(factors);
    return factors;
}

#define INSTANTIATE(F) \
    template Gf<F> gf_from_int_poly<F>(const F &, const Dup &); \
    template Dup gf_to_int_poly<F>(const F &, const Gf<F> &); \
    template void gf_strip<F>(Gf<F> &); \
    template Gf<F> gf_add<F>(const F &, const Gf<F> &, const Gf<F> &); \
    template Gf<F> gf_sub<F>(const F &, const Gf<F> &, const Gf<F> &); \
    template Gf<F> gf_mul<F>(const F &, const Gf<F> &, const Gf<F> &); \
    template Gf<F> gf_add_mul<F>(const F &, const Gf<F> &, const Gf<F> &, const Gf<F> &); \
    template Gf<F> gf_sub_mul<F>(const F &, const Gf<F> &, const Gf<F> &, const Gf<F> &); \
    template Gf<F> gf_mul_ground<F>(const F &, const Gf<F> &, const typename F::T &); \
    template Gf<F> gf_lshift<F>(const Gf<F> &, long); \
    template void gf_div<F>(const F &, const Gf<F> &, const Gf<F> &, Gf<F> &, Gf<F> &); \
    template Gf<F> gf_rem<F>(const F &, const Gf<F> &, const Gf<F> &); \
    template Gf<F> gf_quo<F>(const F &, const Gf<F> &, const Gf<F> &); \
    template Gf<F> gf_monic<F>(const F &, const Gf<F> &, typename F::T &); \
    template Gf<F> gf_gcd<F>(const F &, Gf<F>, Gf<F>); \
    template void gf_gcdex<F>(const F &, const Gf<F> &, const Gf<F> &, Gf<F> &, Gf<F> &, Gf<F> &);

INSTANTIATE(SmallField)
INSTANTIATE(BigField)

}
}
