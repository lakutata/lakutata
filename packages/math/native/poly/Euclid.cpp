//The greatest common divisors, least common multiples, resultants and discriminants, after SymPy's euclidtools.py:
//dup_inner_subresultants, dmp_inner_subresultants, dmp_prs_resultant, dmp_discriminant, _dmp_rr_trivial_gcd,
//_dmp_simplify_gcd, dmp_rr_prs_gcd, dmp_zz_heu_gcd and its interpolation, dmp_inner_gcd, dmp_rr_lcm, dmp_content and
//dmp_primitive (see Euclid.h)
#include "Euclid.h"

#include <algorithm>
#include <optional>
#include <utility>

#include "../async/Pool.h"
#include "../core/Errors.h"

namespace math {
namespace poly {

namespace {

const int HEU_GCD_MAX = 6;

Z canonicalUnit(const Z &c)
{
    return c < 0 ? Z(-1) : Z(1);
}

Z power(const Z &base, long exponent)
{
    Z result;
    SymEngine::mp_pow_ui(result, base, static_cast<unsigned long>(exponent));
    return result;
}

//dup_inner_subresultants
void dupInnerSubresultants(Dup f, Dup g, std::vector<Dup> &R, std::vector<Z> &S)
{
    R.clear();
    S.clear();
    long n = dup_degree(f), m = dup_degree(g);
    if (n < m) {
        std::swap(f, g);
        std::swap(n, m);
    }
    if (f.empty()) return;
    if (g.empty()) {
        R.push_back(f);
        S.push_back(Z(1));
        return;
    }
    R.push_back(f);
    R.push_back(g);
    long d = n - m;
    Dup h = dup_mul_ground(dup_prem(f, g), (d + 1) % 2 == 0 ? Z(1) : Z(-1));
    Z lc = dup_LC(g);
    Z c = power(lc, d);
    //The first scalar subdeterminant is 1
    S.push_back(Z(1));
    S.push_back(c);
    c = -c;
    while (!h.empty()) {
        checkpoint();
        const long k = dup_degree(h);
        R.push_back(h);
        f = g;
        g = h;
        d = m - k;
        m = k;
        const Z b = -lc * power(c, d);
        h = dup_quo_ground(dup_prem(f, g), b);
        lc = dup_LC(g);
        if (d > 1) {
            c = floorDiv(power(-lc, d), power(c, d - 1));
        } else {
            c = -lc;
        }
        S.push_back(-c);
    }
}

//The trivial gcds of one variable (_dup_rr_trivial_gcd): of 0
std::optional<Cofactors> dupTrivialGcd(const Dup &f, const Dup &g)
{
    if (f.empty() && g.empty()) return Cofactors{};
    if (f.empty()) {
        if (dup_LC(g) >= 0) return Cofactors{dmp_from_dup(g), Dmp(), dmp_from_dup({Z(1)})};
        return Cofactors{dmp_from_dup(dup_neg(g)), Dmp(), dmp_from_dup({Z(-1)})};
    }
    if (g.empty()) {
        if (dup_LC(f) >= 0) return Cofactors{dmp_from_dup(f), dmp_from_dup({Z(1)}), Dmp()};
        return Cofactors{dmp_from_dup(dup_neg(f)), dmp_from_dup({Z(-1)}), Dmp()};
    }
    return std::nullopt;
}

//dup_rr_prs_gcd
Cofactors dupPrsGcd(const Dup &f, const Dup &g)
{
    if (auto trivial = dupTrivialGcd(f, g)) return *trivial;
    Z fc, gc;
    const Dup F = dup_primitive(f, fc), G = dup_primitive(g, gc);
    Z c = gcd(fc, gc);
    std::vector<Dup> R;
    std::vector<Z> S;
    dupInnerSubresultants(F, G, R, S);
    Z ignored;
    Dup h = dup_primitive(R.back(), ignored);
    c *= canonicalUnit(dup_LC(h));
    h = dup_mul_ground(h, c);
    return Cofactors{dmp_from_dup(h), dmp_from_dup(dup_quo(f, h)), dmp_from_dup(dup_quo(g, h))};
}

//_dup_zz_gcd_interpolate
Dup dupInterpolate(Z h, const Z &x)
{
    Dup f;
    const Z half = floorDiv(x, 2);
    while (h != 0) {
        Z g = floorMod(h, x);
        if (g > half) g -= x;
        f.insert(f.begin(), g);
        h = floorDiv(h - g, x);
    }
    return f;
}

//The next evaluation point of the heuristic gcd
Z nextPoint(const Z &x)
{
    return floorDiv(73794 * x * isqrt(isqrt(x)), Z(27011));
}

//The first evaluation point of the heuristic gcd
Z firstPoint(const Z &fNorm, const Z &gNorm, const Z &fLC, const Z &gLC)
{
    const Z B = 2 * std::min(fNorm, gNorm) + 29;
    return std::max(std::min(B, Z(99 * isqrt(B))), Z(2 * std::min(floorDiv(fNorm, SymEngine::mp_abs(fLC)), floorDiv(gNorm, SymEngine::mp_abs(gLC))) + 4));
}

//dup_zz_heu_gcd: nothing when it fails
std::optional<Cofactors> dupHeuristicGcd(Dup f, Dup g)
{
    if (auto trivial = dupTrivialGcd(f, g)) return trivial;
    const long df = dup_degree(f), dg = dup_degree(g);
    const Z common = gcd(dup_content(f), dup_content(g));
    if (common != 1) {
        f = dup_quo_ground(f, common);
        g = dup_quo_ground(g, common);
    }
    if (df == 0 || dg == 0) return Cofactors{dmp_from_dup({common}), dmp_from_dup(f), dmp_from_dup(g)};
    Z x = firstPoint(dup_max_norm(f), dup_max_norm(g), dup_LC(f), dup_LC(g));
    for (int i = 0; i < HEU_GCD_MAX; i++) {
        checkpoint();
        const Z ff = dup_eval(f, x), gg = dup_eval(g, x);
        if (ff != 0 && gg != 0) {
            const Z hh = gcd(ff, gg);
            const Z cffValue = floorDiv(ff, hh), cfgValue = floorDiv(gg, hh);
            Z ignored;
            Dup h = dup_primitive(dupInterpolate(hh, x), ignored);
            Dup q, r, q2, r2;
            dup_rr_div(f, h, q, r);
            if (r.empty()) {
                dup_rr_div(g, h, q2, r2);
                if (r2.empty()) return Cofactors{dmp_from_dup(dup_mul_ground(h, common)), dmp_from_dup(q), dmp_from_dup(q2)};
            }
            const Dup cff = dupInterpolate(cffValue, x);
            dup_rr_div(f, cff, h, r);
            if (r.empty()) {
                dup_rr_div(g, h, q2, r2);
                if (r2.empty()) return Cofactors{dmp_from_dup(dup_mul_ground(h, common)), dmp_from_dup(cff), dmp_from_dup(q2)};
            }
            const Dup cfg = dupInterpolate(cfgValue, x);
            dup_rr_div(g, cfg, h, r);
            if (r.empty()) {
                dup_rr_div(f, h, q, r2);
                if (r2.empty()) return Cofactors{dmp_from_dup(dup_mul_ground(h, common)), dmp_from_dup(q), dmp_from_dup(cfg)};
            }
        }
        x = nextPoint(x);
    }
    return std::nullopt;
}

Cofactors dmpInnerGcd(const Dmp &f, const Dmp &g, long u);

//_dmp_simplify_gcd: one of them of degree 0 in the first variable
std::optional<Cofactors> dmpSimplifyGcd(const Dmp &f, const Dmp &g, long u)
{
    const long df = dmp_degree(f, u), dg = dmp_degree(g, u);
    if (df > 0 && dg > 0) return std::nullopt;
    Dmp F, G;
    if (!(df || dg)) {
        F = dmp_LC(f, u);
        G = dmp_LC(g, u);
    } else if (!df) {
        F = dmp_LC(f, u);
        G = dmp_content(g, u);
    } else {
        F = dmp_content(f, u);
        G = dmp_LC(g, u);
    }
    const long v = u - 1;
    const Dmp h = dmp_gcd(F, G, v);
    Cofactors result;
    result.h.c.push_back(h);
    for (const Dmp &c : f.c) result.cff.c.push_back(dmp_quo(c, h, v));
    for (const Dmp &c : g.c) result.cfg.c.push_back(dmp_quo(c, h, v));
    return result;
}

//_dmp_rr_trivial_gcd
std::optional<Cofactors> dmpTrivialGcd(const Dmp &f, const Dmp &g, long u)
{
    const bool zeroF = dmp_zero_p(f, u), zeroG = dmp_zero_p(g, u);
    if (zeroF && zeroG) return Cofactors{};
    if (zeroF) {
        if (dmp_ground_LC(g, u) >= 0) return Cofactors{g, dmp_zero(u), dmp_one(u)};
        return Cofactors{dmp_neg(g, u), dmp_zero(u), dmp_ground(Z(-1), u)};
    }
    if (zeroG) {
        if (dmp_ground_LC(f, u) >= 0) return Cofactors{f, dmp_one(u), dmp_zero(u)};
        return Cofactors{dmp_neg(f, u), dmp_ground(Z(-1), u), dmp_zero(u)};
    }
    if (dmp_one_p(f, u) || dmp_one_p(g, u)) return Cofactors{dmp_one(u), f, g};
    return dmpSimplifyGcd(f, g, u);
}

//dmp_rr_prs_gcd
Cofactors dmpPrsGcd(const Dmp &f, const Dmp &g, long u)
{
    if (u == 0) return dupPrsGcd(f.g, g.g);
    if (auto trivial = dmpTrivialGcd(f, g, u)) return *trivial;
    Dmp fc, gc;
    const Dmp F = dmp_primitive(f, u, fc), G = dmp_primitive(g, u, gc);
    std::vector<Dmp> R, S;
    dmp_inner_subresultants(F, G, u, R, S);
    const Dmp c = dmpPrsGcd(fc, gc, u - 1).h;
    Dmp ignored;
    Dmp h = dmp_mul_term(dmp_primitive(R.back(), u, ignored), c, 0, u);
    const Z unit = canonicalUnit(dmp_ground_LC(h, u));
    if (unit != 1) h = dmp_mul_ground(h, unit, u);
    return Cofactors{h, dmp_quo(f, h, u), dmp_quo(g, h, u)};
}

//_dmp_zz_gcd_interpolate: h of the level v, a polynomial of the level v + 1
Dmp dmpInterpolate(Dmp h, const Z &x, long v)
{
    Dmp f;
    while (!dmp_zero_p(h, v)) {
        const Dmp g = dmp_ground_trunc(h, x, v);
        f.c.insert(f.c.begin(), g);
        h = dmp_quo_ground(dmp_sub(h, g, v), x, v);
    }
    if (dmp_ground_LC(f, v + 1) < 0) return dmp_neg(f, v + 1);
    return f;
}

//dmp_zz_heu_gcd: nothing when it fails
std::optional<Cofactors> dmpHeuristicGcd(Dmp f, Dmp g, long u)
{
    if (u == 0) return dupHeuristicGcd(f.g, g.g);
    if (auto trivial = dmpTrivialGcd(f, g, u)) return trivial;
    const Z common = dmp_ground_extract(f, g, u);
    const Z fNorm = dmp_max_norm(f, u), gNorm = dmp_max_norm(g, u);
    Z x = firstPoint(fNorm, gNorm, dmp_ground_LC(f, u), dmp_ground_LC(g, u));
    const long v = u - 1;
    for (int i = 0; i < HEU_GCD_MAX; i++) {
        checkpoint();
        const Dmp ff = dmp_eval(f, x, u), gg = dmp_eval(g, x, u);
        if (!(dmp_zero_p(ff, v) || dmp_zero_p(gg, v))) {
            const std::optional<Cofactors> inner = dmpHeuristicGcd(ff, gg, v);
            if (!inner) return std::nullopt;
            Z ignored;
            Dmp h = dmp_ground_primitive(dmpInterpolate(inner->h, x, v), u, ignored);
            Dmp q, r, q2, r2;
            dmp_rr_div(f, h, u, q, r);
            if (dmp_zero_p(r, u)) {
                dmp_rr_div(g, h, u, q2, r2);
                if (dmp_zero_p(r2, u)) return Cofactors{dmp_mul_ground(h, common, u), q, q2};
            }
            const Dmp cff = dmpInterpolate(inner->cff, x, v);
            dmp_rr_div(f, cff, u, h, r);
            if (dmp_zero_p(r, u)) {
                dmp_rr_div(g, h, u, q2, r2);
                if (dmp_zero_p(r2, u)) return Cofactors{dmp_mul_ground(h, common, u), cff, q2};
            }
            const Dmp cfg = dmpInterpolate(inner->cfg, x, v);
            dmp_rr_div(g, cfg, u, h, r);
            if (dmp_zero_p(r, u)) {
                dmp_rr_div(f, h, u, q, r2);
                if (dmp_zero_p(r2, u)) return Cofactors{dmp_mul_ground(h, common, u), q, cfg};
            }
        }
        x = nextPoint(x);
    }
    return std::nullopt;
}

//_dmp_inner_gcd over the integers: the heuristic gcd, else the PRS
Cofactors dmpInnerGcd(const Dmp &f, const Dmp &g, long u)
{
    if (std::optional<Cofactors> heuristic = dmpHeuristicGcd(f, g, u)) return *heuristic;
    return dmpPrsGcd(f, g, u);
}

}

void dmp_inner_subresultants(const Dmp &f0, const Dmp &g0, long u, std::vector<Dmp> &R, std::vector<Dmp> &S)
{
    R.clear();
    S.clear();
    if (u == 0) {
        std::vector<Dup> r;
        std::vector<Z> s;
        dupInnerSubresultants(f0.g, g0.g, r, s);
        for (const Dup &p : r) R.push_back(dmp_from_dup(p));
        for (const Z &c : s) S.push_back(dmp_ground(c, 0));
        return;
    }
    Dmp f = f0, g = g0;
    long n = dmp_degree(f, u), m = dmp_degree(g, u);
    if (n < m) {
        std::swap(f, g);
        std::swap(n, m);
    }
    if (dmp_zero_p(f, u)) return;
    const long v = u - 1;
    if (dmp_zero_p(g, u)) {
        R.push_back(f);
        S.push_back(dmp_one(v));
        return;
    }
    R.push_back(f);
    R.push_back(g);
    long d = n - m;
    const Dmp b0 = dmp_pow(dmp_ground(Z(-1), v), static_cast<unsigned long>(d + 1), v);
    Dmp h = dmp_mul_term(dmp_prem(f, g, u), b0, 0, u);
    Dmp lc = dmp_LC(g, u);
    Dmp c = dmp_pow(lc, static_cast<unsigned long>(d), v);
    S.push_back(dmp_one(v));
    S.push_back(c);
    c = dmp_neg(c, v);
    while (!dmp_zero_p(h, u)) {
        checkpoint();
        const long k = dmp_degree(h, u);
        R.push_back(h);
        f = g;
        g = h;
        d = m - k;
        m = k;
        const Dmp b = dmp_mul(dmp_neg(lc, v), dmp_pow(c, static_cast<unsigned long>(d), v), v);
        const Dmp p = dmp_prem(f, g, u);
        h = Dmp();
        for (const Dmp &coefficient : p.c) h.c.push_back(dmp_quo(coefficient, b, v));
        dmp_strip(h, u);
        lc = dmp_LC(g, u);
        if (d > 1) {
            c = dmp_quo(dmp_pow(dmp_neg(lc, v), static_cast<unsigned long>(d), v), dmp_pow(c, static_cast<unsigned long>(d - 1), v), v);
        } else {
            c = dmp_neg(lc, v);
        }
        S.push_back(dmp_neg(c, v));
    }
}

Dmp dmp_resultant(const Dmp &f, const Dmp &g, long u)
{
    const long v = u == 0 ? 0 : u - 1;
    if (dmp_zero_p(f, u) || dmp_zero_p(g, u)) return dmp_zero(v);
    std::vector<Dmp> R, S;
    dmp_inner_subresultants(f, g, u, R, S);
    if (dmp_degree(R.back(), u) > 0) return dmp_zero(v);
    //The PRS is of the polynomial of the higher degree first: res(g, f) = (-1)^(mn) res(f, g)
    const long n = dmp_degree(f, u), m = dmp_degree(g, u);
    if (n < m && (n * m) % 2 == 1) return dmp_neg(S.back(), v);
    return S.back();
}

Dmp dmp_discriminant(const Dmp &f, long u)
{
    const long d = dmp_degree(f, u);
    const long v = u == 0 ? 0 : u - 1;
    if (d <= 0) return dmp_zero(v);
    const Z s = ((d * (d - 1)) / 2) % 2 == 0 ? Z(1) : Z(-1);
    const Dmp r = dmp_resultant(f, dmp_diff(f, 1, u), u);
    if (u == 0) return dmp_ground(floorDiv(dup_LC(r.g), dup_LC(f.g) * s), 0);
    return dmp_quo(r, dmp_mul_ground(dmp_LC(f, u), s, v), v);
}

Dmp dmp_content(const Dmp &f, long u)
{
    const long v = u - 1;
    Dmp content = dmp_LC(f, u);
    if (dmp_zero_p(f, u)) return content;
    for (std::size_t i = 1; i < f.c.size(); i++) {
        content = dmp_gcd(content, f.c[i], v);
        if (dmp_one_p(content, v)) break;
    }
    if (dmp_ground_LC(content, v) < 0) return dmp_neg(content, v);
    return content;
}

Dmp dmp_primitive(const Dmp &f, long u, Dmp &content)
{
    const long v = u - 1;
    content = dmp_content(f, u);
    if (dmp_zero_p(f, u) || dmp_one_p(content, v)) return f;
    Dmp h;
    for (const Dmp &c : f.c) h.c.push_back(dmp_quo(c, content, v));
    return h;
}

Cofactors dmp_inner_gcd(const Dmp &f, const Dmp &g, long u)
{
    if (u == 0) {
        if (std::optional<Cofactors> heuristic = dupHeuristicGcd(f.g, g.g)) return *heuristic;
        return dupPrsGcd(f.g, g.g);
    }
    std::vector<Dmp> polys = {f, g};
    const std::vector<long> J = dmp_multi_deflate(polys, u);
    const Cofactors result = dmpInnerGcd(polys[0], polys[1], u);
    return Cofactors{dmp_inflate(result.h, J, u), dmp_inflate(result.cff, J, u), dmp_inflate(result.cfg, J, u)};
}

Dmp dmp_gcd(const Dmp &f, const Dmp &g, long u)
{
    return dmp_inner_gcd(f, g, u).h;
}

Dmp dmp_lcm(const Dmp &f0, const Dmp &g0, long u)
{
    if (u == 0) {
        //dup_rr_lcm
        if (f0.g.empty() || g0.g.empty()) return Dmp();
        Z fc, gc;
        const Dup f = dup_primitive(f0.g, fc), g = dup_primitive(g0.g, gc);
        const Dup h = dup_quo(dup_mul(f, g), dmp_gcd(dmp_from_dup(f), dmp_from_dup(g), 0).g);
        return dmp_from_dup(dup_mul_ground(h, lcm(fc, gc) * canonicalUnit(dup_LC(h))));
    }
    //dmp_rr_lcm
    Z fc, gc;
    const Dmp f = dmp_ground_primitive(f0, u, fc), g = dmp_ground_primitive(g0, u, gc);
    const Dmp h = dmp_quo(dmp_mul(f, g, u), dmp_gcd(f, g, u), u);
    return dmp_mul_ground(h, lcm(fc, gc), u);
}

}
}
