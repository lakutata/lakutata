//The polynomials over the integers modulo a prime, after SymPy's galoistools.py (BSD-3, its notice in
//THIRD_PARTY_NOTICES.md): a polynomial is its coefficients from the leading one, each in [0, p). The functions are
//templates of the field: SmallField (p < 2^31, its coefficients 64-bit, their products below 2^62) for Zassenhaus'
//factorization and its Hensel lifting, BigField (any p) for the Diophantine equations of Wang's algorithm. EDF draws
//its random polynomials from a fixed sequence, so that a factorization is the same at each run.
#pragma once

#include <cstdint>
#include <utility>
#include <vector>

#include "Dense.h"

namespace math {
namespace poly {

struct SmallField {
    using T = std::uint64_t;
    T p;

    //The residue in [0, p), and the integer of the least absolute value (gf_int)
    T reduce(const Z &c) const;
    Z lift(T a) const;
    T add(T a, T b) const { const T s = a + b; return s >= p ? s - p : s; }
    T sub(T a, T b) const { return a >= b ? a - b : a + p - b; }
    T mul(T a, T b) const { return (a * b) % p; }
    T neg(T a) const { return a == 0 ? 0 : p - a; }
    T inv(T a) const;
    T fromLong(long a) const;
    bool isOne(T a) const { return a == 1; }
};

struct BigField {
    using T = Z;
    Z p;

    T reduce(const Z &c) const { return floorMod(c, p); }
    Z lift(const T &a) const { return a <= floorDiv(p, 2) ? a : a - p; }
    T add(const T &a, const T &b) const { return floorMod(a + b, p); }
    T sub(const T &a, const T &b) const { return floorMod(a - b, p); }
    T mul(const T &a, const T &b) const { return floorMod(a * b, p); }
    T neg(const T &a) const { return floorMod(-a, p); }
    T inv(const T &a) const;
    T fromLong(long a) const { return floorMod(Z(a), p); }
    bool isOne(const T &a) const { return a == 1; }
};

//The sequence of the random numbers of EDF: a 64-bit linear congruential generator
class GfRandom {
public:
    explicit GfRandom(std::uint64_t seed) : state(seed) {}
    std::uint64_t next();
private:
    std::uint64_t state;
};

template <typename F> using Gf = std::vector<typename F::T>;

//The polynomial modulo p of an integer polynomial (gf_from_int_poly), and back, symmetric (gf_to_int_poly)
template <typename F> Gf<F> gf_from_int_poly(const F &field, const Dup &f);
template <typename F> Dup gf_to_int_poly(const F &field, const Gf<F> &f);

template <typename F> void gf_strip(Gf<F> &f);
template <typename F> Gf<F> gf_add(const F &field, const Gf<F> &f, const Gf<F> &g);
template <typename F> Gf<F> gf_sub(const F &field, const Gf<F> &f, const Gf<F> &g);
template <typename F> Gf<F> gf_mul(const F &field, const Gf<F> &f, const Gf<F> &g);
template <typename F> Gf<F> gf_add_mul(const F &field, const Gf<F> &f, const Gf<F> &g, const Gf<F> &h);
template <typename F> Gf<F> gf_sub_mul(const F &field, const Gf<F> &f, const Gf<F> &g, const Gf<F> &h);
template <typename F> Gf<F> gf_mul_ground(const F &field, const Gf<F> &f, const typename F::T &a);
template <typename F> Gf<F> gf_lshift(const Gf<F> &f, long n);
template <typename F> void gf_div(const F &field, const Gf<F> &f, const Gf<F> &g, Gf<F> &q, Gf<F> &r);
template <typename F> Gf<F> gf_rem(const F &field, const Gf<F> &f, const Gf<F> &g);
template <typename F> Gf<F> gf_quo(const F &field, const Gf<F> &f, const Gf<F> &g);
template <typename F> Gf<F> gf_monic(const F &field, const Gf<F> &f, typename F::T &lc);
template <typename F> Gf<F> gf_gcd(const F &field, Gf<F> f, Gf<F> g);
//s f + t g = h, the monic gcd
template <typename F> void gf_gcdex(const F &field, const Gf<F> &f, const Gf<F> &g, Gf<F> &s, Gf<F> &t, Gf<F> &h);

//Whether a polynomial modulo p is square free (gf_sqf_p), and the irreducible factors of a square-free one,
//monic (gf_factor_sqf: Cantor-Zassenhaus' distinct-degree and equal-degree factorizations), with its leading
//coefficient
bool gf_sqf_p(const SmallField &field, const Gf<SmallField> &f);
std::vector<Gf<SmallField>> gf_factor_sqf(const SmallField &field, const Gf<SmallField> &f, SmallField::T &lc);

}
}
