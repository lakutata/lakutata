//The dense polynomials over the integers, as SymPy's polys (sympy/polys/densebasic.py, densearith.py, densetools.py,
//BSD-3, its notice in THIRD_PARTY_NOTICES.md): a polynomial in one variable is its coefficients from the leading one
//(Dup, empty for 0); a polynomial in u + 1 variables is a polynomial in the first one whose coefficients are
//polynomials in the others (Dmp), its level u given to each function. The functions have the names and the meaning of
//SymPy's (dup_ for one variable, dmp_ for several); Python's // and % floor, as floorDiv and floorMod do.
#pragma once

#include <cstddef>
#include <vector>

#include <symengine/integer.h>

namespace math {
namespace poly {

using Z = SymEngine::integer_class;
using Dup = std::vector<Z>;

//A polynomial of a level: its integer coefficients at level 0, its coefficients of the level below otherwise
struct Dmp {
    Dup g;
    std::vector<Dmp> c;
};

//The integers: Python's floor division and modulo, the residue of the least absolute value (gf_int), the integer square
//root (SymPy's ZZ.sqrt), gcd and lcm (nonnegative)
Z floorDiv(const Z &a, const Z &b);
Z floorMod(const Z &a, const Z &b);
Z symmetricMod(const Z &a, const Z &p);
Z isqrt(const Z &a);
Z gcd(const Z &a, const Z &b);
Z lcm(const Z &a, const Z &b);

//One variable
void dup_strip(Dup &f);
long dup_degree(const Dup &f);
Z dup_LC(const Dup &f);
Z dup_TC(const Dup &f);
Dup dup_add(const Dup &f, const Dup &g);
Dup dup_sub(const Dup &f, const Dup &g);
Dup dup_neg(const Dup &f);
Dup dup_mul(const Dup &f, const Dup &g);
Dup dup_sqr(const Dup &f);
Dup dup_pow(const Dup &f, unsigned long n);
Dup dup_mul_ground(const Dup &f, const Z &c);
Dup dup_quo_ground(const Dup &f, const Z &c);
Dup dup_exquo_ground(const Dup &f, const Z &c);
Dup dup_add_term(const Dup &f, const Z &c, long i);
Dup dup_mul_term(const Dup &f, const Z &c, long i);
Dup dup_prem(const Dup &f, const Dup &g);
void dup_rr_div(const Dup &f, const Dup &g, Dup &q, Dup &r);
Dup dup_quo(const Dup &f, const Dup &g);
Dup dup_rem(const Dup &f, const Dup &g);
Z dup_max_norm(const Dup &f);
Z dup_content(const Dup &f);
Dup dup_primitive(const Dup &f, Z &content);
Dup dup_diff(const Dup &f, long m);
Z dup_eval(const Dup &f, const Z &a);
Dup dup_trunc(const Dup &f, const Z &p);
Dup dup_inflate(const Dup &f, long m);
Dup dup_monic(const Dup &f);

//Several variables, the level u given
Dmp dmp_zero(long u);
Dmp dmp_one(long u);
Dmp dmp_ground(const Z &c, long u);
Dmp dmp_from_dup(const Dup &f);
bool dmp_zero_p(const Dmp &f, long u);
bool dmp_one_p(const Dmp &f, long u);
bool dmp_ground_p(const Dmp &f, long u);
void dmp_strip(Dmp &f, long u);
long dmp_degree(const Dmp &f, long u);
long dmp_degree_in(const Dmp &f, long j, long u);
std::vector<long> dmp_degree_list(const Dmp &f, long u);
Dmp dmp_LC(const Dmp &f, long u);
Dmp dmp_TC(const Dmp &f, long u);
Z dmp_ground_LC(const Dmp &f, long u);
Z dmp_ground_TC(const Dmp &f, long u);
std::size_t dmp_length(const Dmp &f, long u);
Dmp dmp_add(const Dmp &f, const Dmp &g, long u);
Dmp dmp_sub(const Dmp &f, const Dmp &g, long u);
Dmp dmp_neg(const Dmp &f, long u);
Dmp dmp_mul(const Dmp &f, const Dmp &g, long u);
Dmp dmp_sqr(const Dmp &f, long u);
Dmp dmp_pow(const Dmp &f, unsigned long n, long u);
Dmp dmp_mul_ground(const Dmp &f, const Z &c, long u);
Dmp dmp_quo_ground(const Dmp &f, const Z &c, long u);
Dmp dmp_exquo_ground(const Dmp &f, const Z &c, long u);
Dmp dmp_add_term(const Dmp &f, const Dmp &c, long i, long u);
Dmp dmp_mul_term(const Dmp &f, const Dmp &c, long i, long u);
Dmp dmp_prem(const Dmp &f, const Dmp &g, long u);
void dmp_rr_div(const Dmp &f, const Dmp &g, long u, Dmp &q, Dmp &r);
Dmp dmp_quo(const Dmp &f, const Dmp &g, long u);
Dmp dmp_exquo(const Dmp &f, const Dmp &g, long u);
Z dmp_max_norm(const Dmp &f, long u);
Z dmp_ground_content(const Dmp &f, long u);
Dmp dmp_ground_primitive(const Dmp &f, long u, Z &content);
Z dmp_ground_extract(Dmp &f, Dmp &g, long u);
Dmp dmp_ground_monic(const Dmp &f, long u);
Dmp dmp_diff(const Dmp &f, long m, long u);
Dmp dmp_diff_in(const Dmp &f, long m, long j, long u);
Dmp dmp_eval(const Dmp &f, const Z &a, long u);
Dmp dmp_eval_in(const Dmp &f, const Z &a, long j, long u);
Dmp dmp_ground_trunc(const Dmp &f, const Z &p, long u);
Dmp dmp_raise(const Dmp &f, long l, long u);
Dmp dmp_inflate(const Dmp &f, const std::vector<long> &m, long u);
//The exponents of several polynomials divided by the gcd of each variable's: the gcds (1 where none), the polynomials
std::vector<long> dmp_multi_deflate(std::vector<Dmp> &polys, long u);
bool dmp_equal(const Dmp &f, const Dmp &g, long u);

//The terms of a polynomial (its monomials and coefficients), and a polynomial of its terms
struct Term {
    std::vector<long> exponents;
    Z coefficient;
};
std::vector<Term> dmp_to_terms(const Dmp &f, long u);
Dmp dmp_from_terms(const std::vector<Term> &terms, long u);

}
}
