//The dense polynomials over the integers, after SymPy's densebasic.py, densearith.py and densetools.py (see Dense.h)
#include "Dense.h"

#include <algorithm>
#include <map>
#include <string>

#include "../core/Errors.h"

namespace math {
namespace poly {

using SymEngine::mp_abs;

Z floorDiv(const Z &a, const Z &b)
{
    Z q;
    SymEngine::mp_fdiv_q(q, a, b);
    return q;
}

Z floorMod(const Z &a, const Z &b)
{
    Z r;
    SymEngine::mp_fdiv_r(r, a, b);
    return r;
}

Z symmetricMod(const Z &a, const Z &p)
{
    Z c = floorMod(a, p);
    if (c > floorDiv(p, 2)) c -= p;
    return c;
}

Z isqrt(const Z &a)
{
    return SymEngine::mp_sqrt(a);
}

Z gcd(const Z &a, const Z &b)
{
    Z g;
    SymEngine::mp_gcd(g, a, b);
    return mp_abs(g);
}

Z lcm(const Z &a, const Z &b)
{
    if (a == 0 || b == 0) return Z(0);
    Z l;
    SymEngine::mp_lcm(l, a, b);
    return mp_abs(l);
}

namespace {

[[noreturn]] void notExact(const char *what)
{
    throw MathError(ErrorCode::Internal, std::string("A division of polynomials that is not exact: ") + what);
}

}

//One variable

void dup_strip(Dup &f)
{
    std::size_t leading = 0;
    while (leading < f.size() && f[leading] == 0) leading++;
    if (leading) f.erase(f.begin(), f.begin() + static_cast<std::ptrdiff_t>(leading));
}

long dup_degree(const Dup &f)
{
    return static_cast<long>(f.size()) - 1;
}

Z dup_LC(const Dup &f)
{
    return f.empty() ? Z(0) : f.front();
}

Z dup_TC(const Dup &f)
{
    return f.empty() ? Z(0) : f.back();
}

Dup dup_add(const Dup &f, const Dup &g)
{
    if (f.empty()) return g;
    if (g.empty()) return f;
    const std::size_t n = f.size(), m = g.size();
    Dup h;
    if (n >= m) {
        h = f;
        for (std::size_t i = 0; i < m; i++) h[n - m + i] += g[i];
    } else {
        h = g;
        for (std::size_t i = 0; i < n; i++) h[m - n + i] += f[i];
    }
    dup_strip(h);
    return h;
}

Dup dup_sub(const Dup &f, const Dup &g)
{
    return dup_add(f, dup_neg(g));
}

Dup dup_neg(const Dup &f)
{
    Dup h = f;
    for (Z &c : h) c = -c;
    return h;
}

Dup dup_mul(const Dup &f, const Dup &g)
{
    if (f.empty() || g.empty()) return {};
    const std::size_t df = f.size() - 1, dg = g.size() - 1;
    Dup h(df + dg + 1, Z(0));
    for (std::size_t i = 0; i <= df; i++) {
        if (f[i] == 0) continue;
        for (std::size_t j = 0; j <= dg; j++) h[i + j] += f[i] * g[j];
    }
    dup_strip(h);
    return h;
}

Dup dup_sqr(const Dup &f)
{
    return dup_mul(f, f);
}

Dup dup_pow(const Dup &f, unsigned long n)
{
    if (!n) return {Z(1)};
    if (n == 1 || f.empty() || (f.size() == 1 && f[0] == 1)) return f;
    Dup g = {Z(1)}, base = f;
    for (;;) {
        const unsigned long m = n;
        n /= 2;
        if (m & 1) {
            g = dup_mul(g, base);
            if (!n) break;
        }
        base = dup_sqr(base);
    }
    return g;
}

Dup dup_mul_ground(const Dup &f, const Z &c)
{
    if (c == 0 || f.empty()) return {};
    Dup h = f;
    for (Z &x : h) x *= c;
    return h;
}

Dup dup_quo_ground(const Dup &f, const Z &c)
{
    if (c == 0) throw MathError(ErrorCode::Internal, "A polynomial divided by 0");
    Dup h;
    h.reserve(f.size());
    for (const Z &x : f) h.push_back(floorDiv(x, c));
    dup_strip(h);
    return h;
}

Dup dup_exquo_ground(const Dup &f, const Z &c)
{
    if (c == 0) throw MathError(ErrorCode::Internal, "A polynomial divided by 0");
    Dup h;
    h.reserve(f.size());
    for (const Z &x : f) {
        Z q, r;
        SymEngine::mp_fdiv_qr(q, r, x, c);
        if (r != 0) notExact("a coefficient by an integer");
        h.push_back(q);
    }
    dup_strip(h);
    return h;
}

Dup dup_add_term(const Dup &f, const Z &c, long i)
{
    if (c == 0) return f;
    const long n = static_cast<long>(f.size());
    if (i == n - 1) {
        Dup h = f;
        h[0] += c;
        dup_strip(h);
        return h;
    }
    if (i >= n) {
        Dup h;
        h.reserve(static_cast<std::size_t>(i) + 1);
        h.push_back(c);
        h.insert(h.end(), static_cast<std::size_t>(i - n), Z(0));
        h.insert(h.end(), f.begin(), f.end());
        return h;
    }
    Dup h = f;
    h[static_cast<std::size_t>(n - i - 1)] += c;
    dup_strip(h);
    return h;
}

Dup dup_mul_term(const Dup &f, const Z &c, long i)
{
    if (c == 0 || f.empty()) return {};
    Dup h = dup_mul_ground(f, c);
    h.insert(h.end(), static_cast<std::size_t>(i), Z(0));
    return h;
}

Dup dup_prem(const Dup &f, const Dup &g)
{
    const long df = dup_degree(f), dg = dup_degree(g);
    if (g.empty()) throw MathError(ErrorCode::Internal, "A polynomial divided by 0");
    if (df < dg) return f;
    Dup r = f;
    long dr = df, N = df - dg + 1;
    const Z lcg = dup_LC(g);
    for (;;) {
        const Z lcr = dup_LC(r);
        const long j = dr - dg;
        N--;
        r = dup_sub(dup_mul_ground(r, lcg), dup_mul_term(g, lcr, j));
        const long previous = dr;
        dr = dup_degree(r);
        if (dr < dg) break;
        if (!(dr < previous)) throw MathError(ErrorCode::Internal, "The division of polynomials failed");
    }
    Z power;
    SymEngine::mp_pow_ui(power, lcg, static_cast<unsigned long>(N));
    return dup_mul_ground(r, power);
}

void dup_rr_div(const Dup &f, const Dup &g, Dup &q, Dup &r)
{
    const long df = dup_degree(f), dg = dup_degree(g);
    if (g.empty()) throw MathError(ErrorCode::Internal, "A polynomial divided by 0");
    q.clear();
    r = f;
    if (df < dg) return;
    long dr = df;
    const Z lcg = dup_LC(g);
    for (;;) {
        const Z lcr = dup_LC(r);
        Z c, remainder;
        SymEngine::mp_fdiv_qr(c, remainder, lcr, lcg);
        if (remainder != 0) break;
        const long j = dr - dg;
        q = dup_add_term(q, c, j);
        r = dup_sub(r, dup_mul_term(g, c, j));
        const long previous = dr;
        dr = dup_degree(r);
        if (dr < dg) break;
        if (!(dr < previous)) throw MathError(ErrorCode::Internal, "The division of polynomials failed");
    }
}

Dup dup_quo(const Dup &f, const Dup &g)
{
    Dup q, r;
    dup_rr_div(f, g, q, r);
    return q;
}

Dup dup_rem(const Dup &f, const Dup &g)
{
    Dup q, r;
    dup_rr_div(f, g, q, r);
    return r;
}

Z dup_max_norm(const Dup &f)
{
    Z norm = 0;
    for (const Z &c : f) norm = std::max(norm, Z(mp_abs(c)));
    return norm;
}

Z dup_content(const Dup &f)
{
    Z content = 0;
    for (const Z &c : f) {
        content = gcd(content, c);
        if (content == 1) break;
    }
    return content;
}

Dup dup_primitive(const Dup &f, Z &content)
{
    if (f.empty()) {
        content = 0;
        return f;
    }
    content = dup_content(f);
    return content == 1 ? f : dup_quo_ground(f, content);
}

Dup dup_diff(const Dup &f, long m)
{
    if (m <= 0) return f;
    long n = dup_degree(f);
    if (n < m) return {};
    Dup derivative;
    for (std::size_t i = 0; i + static_cast<std::size_t>(m) < f.size(); i++) {
        Z k = n;
        for (long j = n - 1; j > n - m; j--) k *= j;
        derivative.push_back(k * f[i]);
        n--;
    }
    dup_strip(derivative);
    return derivative;
}

Z dup_eval(const Dup &f, const Z &a)
{
    if (a == 0) return dup_TC(f);
    Z result = 0;
    for (const Z &c : f) result = result * a + c;
    return result;
}

Dup dup_trunc(const Dup &f, const Z &p)
{
    Dup g;
    g.reserve(f.size());
    for (const Z &c : f) g.push_back(symmetricMod(c, p));
    dup_strip(g);
    return g;
}

Dup dup_inflate(const Dup &f, long m)
{
    if (m <= 0) throw MathError(ErrorCode::Internal, "A polynomial inflated by a power that is not positive");
    if (m == 1 || f.empty()) return f;
    Dup result = {f[0]};
    for (std::size_t i = 1; i < f.size(); i++) {
        result.insert(result.end(), static_cast<std::size_t>(m - 1), Z(0));
        result.push_back(f[i]);
    }
    return result;
}

Dup dup_monic(const Dup &f)
{
    if (f.empty()) return f;
    const Z lc = dup_LC(f);
    return lc == 1 ? f : dup_exquo_ground(f, lc);
}

//Several variables

Dmp dmp_zero(long)
{
    return Dmp();
}

Dmp dmp_one(long u)
{
    return dmp_ground(Z(1), u);
}

Dmp dmp_ground(const Z &c, long u)
{
    Dmp f;
    if (c == 0) return f;
    if (u == 0) {
        f.g.push_back(c);
    } else {
        f.c.push_back(dmp_ground(c, u - 1));
    }
    return f;
}

Dmp dmp_from_dup(const Dup &f)
{
    Dmp h;
    h.g = f;
    return h;
}

bool dmp_zero_p(const Dmp &f, long u)
{
    return u == 0 ? f.g.empty() : f.c.empty();
}

bool dmp_one_p(const Dmp &f, long u)
{
    if (u == 0) return f.g.size() == 1 && f.g[0] == 1;
    return f.c.size() == 1 && dmp_one_p(f.c[0], u - 1);
}

bool dmp_ground_p(const Dmp &f, long u)
{
    if (u == 0) return f.g.size() <= 1;
    return f.c.empty() || (f.c.size() == 1 && dmp_ground_p(f.c[0], u - 1));
}

void dmp_strip(Dmp &f, long u)
{
    if (u == 0) {
        dup_strip(f.g);
        return;
    }
    std::size_t leading = 0;
    while (leading < f.c.size() && dmp_zero_p(f.c[leading], u - 1)) leading++;
    if (leading) f.c.erase(f.c.begin(), f.c.begin() + static_cast<std::ptrdiff_t>(leading));
}

long dmp_degree(const Dmp &f, long u)
{
    return u == 0 ? dup_degree(f.g) : static_cast<long>(f.c.size()) - 1;
}

long dmp_degree_in(const Dmp &f, long j, long u)
{
    if (j == 0) return dmp_degree(f, u);
    long degree = -1;
    for (const Dmp &c : f.c) degree = std::max(degree, dmp_degree_in(c, j - 1, u - 1));
    return degree;
}

std::vector<long> dmp_degree_list(const Dmp &f, long u)
{
    std::vector<long> degrees;
    for (long j = 0; j <= u; j++) degrees.push_back(dmp_degree_in(f, j, u));
    return degrees;
}

Dmp dmp_LC(const Dmp &f, long u)
{
    return f.c.empty() ? dmp_zero(u - 1) : f.c.front();
}

Dmp dmp_TC(const Dmp &f, long u)
{
    return f.c.empty() ? dmp_zero(u - 1) : f.c.back();
}

Z dmp_ground_LC(const Dmp &f, long u)
{
    if (u == 0) return dup_LC(f.g);
    return f.c.empty() ? Z(0) : dmp_ground_LC(f.c.front(), u - 1);
}

Z dmp_ground_TC(const Dmp &f, long u)
{
    if (u == 0) return dup_TC(f.g);
    return f.c.empty() ? Z(0) : dmp_ground_TC(f.c.back(), u - 1);
}

std::size_t dmp_length(const Dmp &f, long u)
{
    if (u == 0) return static_cast<std::size_t>(std::count_if(f.g.begin(), f.g.end(), [](const Z &c) { return c != 0; }));
    std::size_t length = 0;
    for (const Dmp &c : f.c) length += dmp_length(c, u - 1);
    return length;
}

Dmp dmp_add(const Dmp &f, const Dmp &g, long u)
{
    if (u == 0) return dmp_from_dup(dup_add(f.g, g.g));
    if (f.c.empty()) return g;
    if (g.c.empty()) return f;
    const std::size_t n = f.c.size(), m = g.c.size();
    Dmp h;
    if (n >= m) {
        h = f;
        for (std::size_t i = 0; i < m; i++) h.c[n - m + i] = dmp_add(h.c[n - m + i], g.c[i], u - 1);
    } else {
        h = g;
        for (std::size_t i = 0; i < n; i++) h.c[m - n + i] = dmp_add(f.c[i], h.c[m - n + i], u - 1);
    }
    dmp_strip(h, u);
    return h;
}

Dmp dmp_sub(const Dmp &f, const Dmp &g, long u)
{
    return dmp_add(f, dmp_neg(g, u), u);
}

Dmp dmp_neg(const Dmp &f, long u)
{
    if (u == 0) return dmp_from_dup(dup_neg(f.g));
    Dmp h;
    h.c.reserve(f.c.size());
    for (const Dmp &c : f.c) h.c.push_back(dmp_neg(c, u - 1));
    return h;
}

Dmp dmp_mul(const Dmp &f, const Dmp &g, long u)
{
    if (u == 0) return dmp_from_dup(dup_mul(f.g, g.g));
    if (f.c.empty() || g.c.empty()) return dmp_zero(u);
    const std::size_t df = f.c.size() - 1, dg = g.c.size() - 1;
    Dmp h;
    h.c.assign(df + dg + 1, dmp_zero(u - 1));
    for (std::size_t i = 0; i <= df; i++) {
        if (dmp_zero_p(f.c[i], u - 1)) continue;
        for (std::size_t j = 0; j <= dg; j++) h.c[i + j] = dmp_add(h.c[i + j], dmp_mul(f.c[i], g.c[j], u - 1), u - 1);
    }
    dmp_strip(h, u);
    return h;
}

Dmp dmp_sqr(const Dmp &f, long u)
{
    return dmp_mul(f, f, u);
}

Dmp dmp_pow(const Dmp &f, unsigned long n, long u)
{
    if (u == 0) return dmp_from_dup(dup_pow(f.g, n));
    if (!n) return dmp_one(u);
    if (n == 1 || dmp_zero_p(f, u) || dmp_one_p(f, u)) return f;
    Dmp g = dmp_one(u), base = f;
    for (;;) {
        const unsigned long m = n;
        n /= 2;
        if (m & 1) {
            g = dmp_mul(g, base, u);
            if (!n) break;
        }
        base = dmp_sqr(base, u);
    }
    return g;
}

Dmp dmp_mul_ground(const Dmp &f, const Z &c, long u)
{
    if (u == 0) return dmp_from_dup(dup_mul_ground(f.g, c));
    if (c == 0) return dmp_zero(u);
    Dmp h;
    h.c.reserve(f.c.size());
    for (const Dmp &x : f.c) h.c.push_back(dmp_mul_ground(x, c, u - 1));
    return h;
}

Dmp dmp_quo_ground(const Dmp &f, const Z &c, long u)
{
    if (u == 0) return dmp_from_dup(dup_quo_ground(f.g, c));
    Dmp h;
    h.c.reserve(f.c.size());
    for (const Dmp &x : f.c) h.c.push_back(dmp_quo_ground(x, c, u - 1));
    dmp_strip(h, u);
    return h;
}

Dmp dmp_exquo_ground(const Dmp &f, const Z &c, long u)
{
    if (u == 0) return dmp_from_dup(dup_exquo_ground(f.g, c));
    Dmp h;
    h.c.reserve(f.c.size());
    for (const Dmp &x : f.c) h.c.push_back(dmp_exquo_ground(x, c, u - 1));
    dmp_strip(h, u);
    return h;
}

Dmp dmp_add_term(const Dmp &f, const Dmp &c, long i, long u)
{
    if (u == 0) return dmp_from_dup(dup_add_term(f.g, dup_LC(c.g), i));
    if (dmp_zero_p(c, u - 1)) return f;
    const long n = static_cast<long>(f.c.size());
    if (i == n - 1) {
        Dmp h = f;
        h.c[0] = dmp_add(h.c[0], c, u - 1);
        dmp_strip(h, u);
        return h;
    }
    if (i >= n) {
        Dmp h;
        h.c.reserve(static_cast<std::size_t>(i) + 1);
        h.c.push_back(c);
        h.c.insert(h.c.end(), static_cast<std::size_t>(i - n), dmp_zero(u - 1));
        h.c.insert(h.c.end(), f.c.begin(), f.c.end());
        return h;
    }
    Dmp h = f;
    const std::size_t m = static_cast<std::size_t>(n - i - 1);
    h.c[m] = dmp_add(h.c[m], c, u - 1);
    dmp_strip(h, u);
    return h;
}

Dmp dmp_mul_term(const Dmp &f, const Dmp &c, long i, long u)
{
    if (u == 0) return dmp_from_dup(dup_mul_term(f.g, dup_LC(c.g), i));
    if (dmp_zero_p(f, u) || dmp_zero_p(c, u - 1)) return dmp_zero(u);
    Dmp h;
    h.c.reserve(f.c.size() + static_cast<std::size_t>(i));
    for (const Dmp &x : f.c) h.c.push_back(dmp_mul(x, c, u - 1));
    h.c.insert(h.c.end(), static_cast<std::size_t>(i), dmp_zero(u - 1));
    return h;
}

Dmp dmp_prem(const Dmp &f, const Dmp &g, long u)
{
    if (u == 0) return dmp_from_dup(dup_prem(f.g, g.g));
    const long df = dmp_degree(f, u), dg = dmp_degree(g, u);
    if (dg < 0) throw MathError(ErrorCode::Internal, "A polynomial divided by 0");
    if (df < dg) return f;
    Dmp r = f;
    long dr = df, N = df - dg + 1;
    const Dmp lcg = dmp_LC(g, u);
    for (;;) {
        const Dmp lcr = dmp_LC(r, u);
        const long j = dr - dg;
        N--;
        r = dmp_sub(dmp_mul_term(r, lcg, 0, u), dmp_mul_term(g, lcr, j, u), u);
        const long previous = dr;
        dr = dmp_degree(r, u);
        if (dr < dg) break;
        if (!(dr < previous)) throw MathError(ErrorCode::Internal, "The division of polynomials failed");
    }
    return dmp_mul_term(r, dmp_pow(lcg, static_cast<unsigned long>(N), u - 1), 0, u);
}

void dmp_rr_div(const Dmp &f, const Dmp &g, long u, Dmp &q, Dmp &r)
{
    if (u == 0) {
        Dup quotient, remainder;
        dup_rr_div(f.g, g.g, quotient, remainder);
        q = dmp_from_dup(quotient);
        r = dmp_from_dup(remainder);
        return;
    }
    const long df = dmp_degree(f, u), dg = dmp_degree(g, u);
    if (dg < 0) throw MathError(ErrorCode::Internal, "A polynomial divided by 0");
    q = dmp_zero(u);
    r = f;
    if (df < dg) return;
    long dr = df;
    const Dmp lcg = dmp_LC(g, u);
    for (;;) {
        const Dmp lcr = dmp_LC(r, u);
        Dmp c, remainder;
        dmp_rr_div(lcr, lcg, u - 1, c, remainder);
        if (!dmp_zero_p(remainder, u - 1)) break;
        const long j = dr - dg;
        q = dmp_add_term(q, c, j, u);
        r = dmp_sub(r, dmp_mul_term(g, c, j, u), u);
        const long previous = dr;
        dr = dmp_degree(r, u);
        if (dr < dg) break;
        if (!(dr < previous)) throw MathError(ErrorCode::Internal, "The division of polynomials failed");
    }
}

Dmp dmp_quo(const Dmp &f, const Dmp &g, long u)
{
    Dmp q, r;
    dmp_rr_div(f, g, u, q, r);
    return q;
}

Dmp dmp_exquo(const Dmp &f, const Dmp &g, long u)
{
    Dmp q, r;
    dmp_rr_div(f, g, u, q, r);
    if (!dmp_zero_p(r, u)) notExact("a polynomial by another");
    return q;
}

Z dmp_max_norm(const Dmp &f, long u)
{
    if (u == 0) return dup_max_norm(f.g);
    Z norm = 0;
    for (const Dmp &c : f.c) norm = std::max(norm, dmp_max_norm(c, u - 1));
    return norm;
}

Z dmp_ground_content(const Dmp &f, long u)
{
    if (u == 0) return dup_content(f.g);
    Z content = 0;
    for (const Dmp &c : f.c) {
        content = gcd(content, dmp_ground_content(c, u - 1));
        if (content == 1) break;
    }
    return content;
}

Dmp dmp_ground_primitive(const Dmp &f, long u, Z &content)
{
    if (dmp_zero_p(f, u)) {
        content = 0;
        return f;
    }
    content = dmp_ground_content(f, u);
    return content == 1 ? f : dmp_quo_ground(f, content, u);
}

Z dmp_ground_extract(Dmp &f, Dmp &g, long u)
{
    const Z common = gcd(dmp_ground_content(f, u), dmp_ground_content(g, u));
    if (common != 1 && common != 0) {
        f = dmp_quo_ground(f, common, u);
        g = dmp_quo_ground(g, common, u);
    }
    return common;
}

Dmp dmp_ground_monic(const Dmp &f, long u)
{
    if (dmp_zero_p(f, u)) return f;
    const Z lc = dmp_ground_LC(f, u);
    return lc == 1 ? f : dmp_exquo_ground(f, lc, u);
}

Dmp dmp_diff(const Dmp &f, long m, long u)
{
    if (u == 0) return dmp_from_dup(dup_diff(f.g, m));
    if (m <= 0) return f;
    long n = dmp_degree(f, u);
    if (n < m) return dmp_zero(u);
    Dmp derivative;
    for (std::size_t i = 0; i + static_cast<std::size_t>(m) < f.c.size(); i++) {
        Z k = n;
        for (long j = n - 1; j > n - m; j--) k *= j;
        derivative.c.push_back(dmp_mul_ground(f.c[i], k, u - 1));
        n--;
    }
    dmp_strip(derivative, u);
    return derivative;
}

Dmp dmp_diff_in(const Dmp &f, long m, long j, long u)
{
    if (j == 0) return dmp_diff(f, m, u);
    Dmp h;
    h.c.reserve(f.c.size());
    for (const Dmp &c : f.c) h.c.push_back(dmp_diff_in(c, m, j - 1, u - 1));
    dmp_strip(h, u);
    return h;
}

Dmp dmp_eval(const Dmp &f, const Z &a, long u)
{
    if (u == 0) return dmp_ground(dup_eval(f.g, a), 0);
    if (a == 0) return dmp_TC(f, u);
    if (f.c.empty()) return dmp_zero(u - 1);
    Dmp result = f.c.front();
    for (std::size_t i = 1; i < f.c.size(); i++) result = dmp_add(dmp_mul_ground(result, a, u - 1), f.c[i], u - 1);
    return result;
}

Dmp dmp_eval_in(const Dmp &f, const Z &a, long j, long u)
{
    if (j == 0) return dmp_eval(f, a, u);
    Dmp h;
    //Of the level 1: the values of its coefficients are the integer coefficients of the result
    if (u == 1) {
        for (const Dmp &c : f.c) h.g.push_back(dup_eval(c.g, a));
        dmp_strip(h, 0);
        return h;
    }
    h.c.reserve(f.c.size());
    for (const Dmp &c : f.c) h.c.push_back(dmp_eval_in(c, a, j - 1, u - 1));
    dmp_strip(h, u - 1);
    return h;
}

Dmp dmp_ground_trunc(const Dmp &f, const Z &p, long u)
{
    if (u == 0) return dmp_from_dup(dup_trunc(f.g, p));
    Dmp h;
    h.c.reserve(f.c.size());
    for (const Dmp &c : f.c) h.c.push_back(dmp_ground_trunc(c, p, u - 1));
    dmp_strip(h, u);
    return h;
}

Dmp dmp_raise(const Dmp &f, long l, long u)
{
    if (!l) return f;
    Dmp h;
    if (u == 0) {
        for (const Z &c : f.g) h.c.push_back(dmp_ground(c, l - 1));
        return h;
    }
    for (const Dmp &c : f.c) h.c.push_back(dmp_raise(c, l, u - 1));
    return h;
}

namespace {

Dmp inflate(const Dmp &g, const std::vector<long> &m, long v, std::size_t i)
{
    if (v == 0) return dmp_from_dup(dup_inflate(g.g, m[i]));
    if (m[i] <= 0) throw MathError(ErrorCode::Internal, "A polynomial inflated by a power that is not positive");
    std::vector<Dmp> inflated;
    for (const Dmp &c : g.c) inflated.push_back(inflate(c, m, v - 1, i + 1));
    Dmp result;
    if (inflated.empty()) return result;
    result.c.push_back(inflated[0]);
    for (std::size_t k = 1; k < inflated.size(); k++) {
        result.c.insert(result.c.end(), static_cast<std::size_t>(m[i] - 1), dmp_zero(v - 1));
        result.c.push_back(inflated[k]);
    }
    return result;
}

void collect(const Dmp &f, long u, std::vector<long> &exponents, std::vector<Term> &terms)
{
    const long degree = dmp_degree(f, u);
    if (u == 0) {
        for (long i = 0; i <= degree; i++) {
            const Z &c = f.g[static_cast<std::size_t>(i)];
            if (c == 0) continue;
            exponents.push_back(degree - i);
            terms.push_back({exponents, c});
            exponents.pop_back();
        }
        return;
    }
    for (long i = 0; i <= degree; i++) {
        exponents.push_back(degree - i);
        collect(f.c[static_cast<std::size_t>(i)], u - 1, exponents, terms);
        exponents.pop_back();
    }
}

}

Dmp dmp_inflate(const Dmp &f, const std::vector<long> &m, long u)
{
    if (std::all_of(m.begin(), m.end(), [](long k) { return k == 1; })) return f;
    return inflate(f, m, u, 0);
}

std::vector<long> dmp_multi_deflate(std::vector<Dmp> &polys, long u)
{
    std::vector<long> B(static_cast<std::size_t>(u) + 1, 0);
    std::vector<std::vector<Term>> all;
    for (const Dmp &p : polys) {
        all.push_back(dmp_to_terms(p, u));
        for (const Term &term : all.back()) {
            for (std::size_t i = 0; i < B.size(); i++) B[i] = static_cast<long>(gcd(Z(B[i]), Z(term.exponents[i])));
        }
    }
    for (long &b : B) if (b == 0) b = 1;
    if (std::all_of(B.begin(), B.end(), [](long b) { return b == 1; })) return B;
    for (std::size_t k = 0; k < polys.size(); k++) {
        for (Term &term : all[k]) for (std::size_t i = 0; i < B.size(); i++) term.exponents[i] /= B[i];
        polys[k] = dmp_from_terms(all[k], u);
    }
    return B;
}

bool dmp_equal(const Dmp &f, const Dmp &g, long u)
{
    if (u == 0) return f.g == g.g;
    if (f.c.size() != g.c.size()) return false;
    for (std::size_t i = 0; i < f.c.size(); i++) if (!dmp_equal(f.c[i], g.c[i], u - 1)) return false;
    return true;
}

Z dup_l1_norm(const Dup &f)
{
    Z norm = 0;
    for (const Z &c : f) norm += mp_abs(c);
    return norm;
}

Dmp dmp_eval_tail(const Dmp &f, const std::vector<Z> &A, long u)
{
    if (A.empty()) return f;
    const long n = static_cast<long>(A.size()), level = u - n;
    std::map<std::vector<long>, Z> collected;
    for (const Term &term : dmp_to_terms(f, u)) {
        Z value = term.coefficient;
        for (long i = 0; i < n; i++) {
            Z power;
            SymEngine::mp_pow_ui(power, A[static_cast<std::size_t>(i)], static_cast<unsigned long>(term.exponents[static_cast<std::size_t>(u - n + 1 + i)]));
            value *= power;
        }
        std::vector<long> head(term.exponents.begin(), term.exponents.begin() + (level < 0 ? 1 : level + 1));
        if (level < 0) head.assign(1, 0);
        collected[head] += value;
    }
    std::vector<Term> terms;
    for (const auto &[exponents, coefficient] : collected) terms.push_back({exponents, coefficient});
    return dmp_from_terms(terms, level < 0 ? 0 : level);
}

Dmp dmp_diff_eval_in(const Dmp &f, long m, const Z &a, long j, long u)
{
    return dmp_eval_in(dmp_diff_in(f, m, j, u), a, j, u);
}

Dmp dmp_expand(const std::vector<Dmp> &polys, long u)
{
    if (polys.empty()) return dmp_one(u);
    Dmp f = polys[0];
    for (std::size_t i = 1; i < polys.size(); i++) f = dmp_mul(f, polys[i], u);
    return f;
}

Dmp dmp_sub_mul(const Dmp &f, const Dmp &g, const Dmp &h, long u)
{
    return dmp_sub(f, dmp_mul(g, h, u), u);
}

Dmp dmp_add_mul(const Dmp &f, const Dmp &g, const Dmp &h, long u)
{
    return dmp_add(f, dmp_mul(g, h, u), u);
}

Dmp dmp_nest(const Dup &f, long l)
{
    Dmp h = dmp_from_dup(f);
    for (long i = 0; i < l; i++) {
        Dmp outer;
        outer.c.push_back(h);
        h = std::move(outer);
    }
    return h;
}

std::vector<long> dmp_terms_gcd(Dmp &f, long u)
{
    std::vector<long> G(static_cast<std::size_t>(u) + 1, 0);
    if (dmp_ground_TC(f, u) != 0 || dmp_zero_p(f, u)) return G;
    std::vector<Term> terms = dmp_to_terms(f, u);
    for (std::size_t i = 0; i < G.size(); i++) {
        long least = -1;
        for (const Term &term : terms) least = least < 0 ? term.exponents[i] : std::min(least, term.exponents[i]);
        G[i] = std::max(least, 0L);
    }
    if (std::all_of(G.begin(), G.end(), [](long g) { return g == 0; })) return G;
    for (Term &term : terms) for (std::size_t i = 0; i < G.size(); i++) term.exponents[i] -= G[i];
    f = dmp_from_terms(terms, u);
    return G;
}

std::vector<long> dmp_exclude(Dmp &f, long &u)
{
    std::vector<long> J;
    if (u == 0 || dmp_ground_p(f, u)) return J;
    std::vector<Term> terms = dmp_to_terms(f, u);
    for (long j = 0; j <= u; j++) {
        if (std::none_of(terms.begin(), terms.end(), [j](const Term &term) { return term.exponents[static_cast<std::size_t>(j)] != 0; })) J.push_back(j);
    }
    if (J.empty()) return J;
    for (Term &term : terms) {
        for (auto j = J.rbegin(); j != J.rend(); ++j) term.exponents.erase(term.exponents.begin() + *j);
    }
    u -= static_cast<long>(J.size());
    f = dmp_from_terms(terms, u);
    return J;
}

Dmp dmp_include(const Dmp &f, const std::vector<long> &J, long u)
{
    if (J.empty()) return f;
    std::vector<Term> terms = dmp_to_terms(f, u);
    for (Term &term : terms) for (const long j : J) term.exponents.insert(term.exponents.begin() + j, 0);
    return dmp_from_terms(terms, u + static_cast<long>(J.size()));
}

std::vector<Term> dmp_to_terms(const Dmp &f, long u)
{
    std::vector<Term> terms;
    std::vector<long> exponents;
    collect(f, u, exponents, terms);
    return terms;
}

Dmp dmp_from_terms(const std::vector<Term> &terms, long u)
{
    if (u == 0) {
        long degree = -1;
        for (const Term &term : terms) if (term.coefficient != 0) degree = std::max(degree, term.exponents[0]);
        Dmp f;
        if (degree < 0) return f;
        f.g.assign(static_cast<std::size_t>(degree) + 1, Z(0));
        for (const Term &term : terms) f.g[static_cast<std::size_t>(degree - term.exponents[0])] += term.coefficient;
        dmp_strip(f, 0);
        return f;
    }
    //By the exponent of the first variable, the terms of the others
    std::map<long, std::vector<Term>> groups;
    for (const Term &term : terms) {
        if (term.coefficient == 0) continue;
        groups[term.exponents[0]].push_back({std::vector<long>(term.exponents.begin() + 1, term.exponents.end()), term.coefficient});
    }
    Dmp f;
    if (groups.empty()) return f;
    const long degree = groups.rbegin()->first;
    f.c.assign(static_cast<std::size_t>(degree) + 1, dmp_zero(u - 1));
    for (const auto &group : groups) f.c[static_cast<std::size_t>(degree - group.first)] = dmp_from_terms(group.second, u - 1);
    dmp_strip(f, u);
    return f;
}

}
}
