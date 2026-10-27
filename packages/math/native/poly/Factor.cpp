//The square-free decomposition and the factorization over the integers, after SymPy's sqfreetools.py (dup_sqf_p,
//dmp_sqf_p, dup_sqf_part, dmp_sqf_part, dup_sqf_list, dmp_sqf_list) and factortools.py (dup_trial_division,
//dmp_trial_division, dmp_zz_mignotte_bound, dup_zz_hensel_step, dup_zz_hensel_lift, dup_zz_zassenhaus,
//_dup_cyclotomic_decompose, dup_zz_cyclotomic_factor, dup_zz_factor_sqf, dup_zz_factor, dmp_zz_wang_non_divisors,
//dmp_zz_wang_test_points, dmp_zz_wang_lead_coeffs, dup_zz_diophantine, dmp_zz_diophantine,
//dmp_zz_wang_hensel_lifting, dmp_zz_wang, dmp_zz_factor, dup_factor_list, dmp_factor_list) (see Factor.h)
#include "Factor.h"

#include <algorithm>
#include <cmath>
#include <optional>
#include <set>
#include <tuple>

#include "../async/Pool.h"
#include "../core/Errors.h"
#include "../ntheory/NumberTheory.h"
#include "Euclid.h"
#include "Galois.h"

namespace math {
namespace poly {

namespace {

using Factors = std::vector<std::pair<Dmp, long>>;

//Wang's lifting met factors that are not of the polynomial: restarted with other evaluation points
struct ExtraneousFactors {};

[[noreturn]] void internal(const char *what)
{
    throw MathError(ErrorCode::Internal, std::string("The factorization failed: ") + what);
}

//Python's comparison of the nested lists of two polynomials of a level
int compareDmp(const Dmp &f, const Dmp &g, long u)
{
    if (u == 0) {
        for (std::size_t i = 0; i < std::min(f.g.size(), g.g.size()); i++) {
            if (f.g[i] != g.g[i]) return f.g[i] < g.g[i] ? -1 : 1;
        }
        return f.g.size() == g.g.size() ? 0 : (f.g.size() < g.g.size() ? -1 : 1);
    }
    for (std::size_t i = 0; i < std::min(f.c.size(), g.c.size()); i++) {
        const int c = compareDmp(f.c[i], g.c[i], u - 1);
        if (c) return c;
    }
    return f.c.size() == g.c.size() ? 0 : (f.c.size() < g.c.size() ? -1 : 1);
}

std::size_t lengthOf(const Dmp &f, long u)
{
    return u == 0 ? f.g.size() : f.c.size();
}

//_sort_factors: by the number of coefficients, the multiplicity, the coefficients
void sortFactors(Factors &factors, long u)
{
    std::stable_sort(factors.begin(), factors.end(), [u](const std::pair<Dmp, long> &a, const std::pair<Dmp, long> &b) {
        if (lengthOf(a.first, u) != lengthOf(b.first, u)) return lengthOf(a.first, u) < lengthOf(b.first, u);
        if (a.second != b.second) return a.second < b.second;
        return compareDmp(a.first, b.first, u) < 0;
    });
}

void sortDups(std::vector<Dup> &factors)
{
    std::stable_sort(factors.begin(), factors.end(), [](const Dup &a, const Dup &b) {
        if (a.size() != b.size()) return a.size() < b.size();
        return compareDmp(dmp_from_dup(a), dmp_from_dup(b), 0) < 0;
    });
}

Dup dupGcd(const Dup &f, const Dup &g)
{
    return dmp_gcd(dmp_from_dup(f), dmp_from_dup(g), 0).g;
}

Z power(const Z &base, long exponent)
{
    Z result;
    SymEngine::mp_pow_ui(result, base, static_cast<unsigned long>(exponent));
    return result;
}

Z factorial(long n)
{
    Z result(1);
    for (long i = 2; i <= n; i++) result *= i;
    return result;
}

//log2 of a positive integer, of its 53 leading bits
double log2Of(const Z &a)
{
    if (a <= 0) return -INFINITY;
    const unsigned long bits = static_cast<unsigned long>(boost::multiprecision::msb(a)) + 1;
    if (bits <= 53) return std::log2(static_cast<double>(a));
    const Z top = a >> (bits - 53);
    return std::log2(static_cast<double>(top)) + static_cast<double>(bits - 53);
}

bool smallPrime(long n)
{
    if (n < 2) return false;
    for (long d = 2; d * d <= n; d++) if (n % d == 0) return false;
    return true;
}

//The prime factors of a small integer and their exponents, from the smallest
std::vector<std::pair<long, long>> factorSmall(long n)
{
    std::vector<std::pair<long, long>> factors;
    for (long d = 2; d * d <= n; d++) {
        long k = 0;
        while (n % d == 0) {
            n /= d;
            k++;
        }
        if (k) factors.push_back({d, k});
    }
    if (n > 1) factors.push_back({n, 1});
    return factors;
}

//One variable

bool dupSqfP(const Dup &f)
{
    if (f.empty()) return true;
    return dup_degree(dupGcd(f, dup_diff(f, 1))) == 0;
}

Dup dupSqfPart(Dup f)
{
    if (f.empty()) return f;
    if (dup_LC(f) < 0) f = dup_neg(f);
    const Dup sqf = dup_quo(f, dupGcd(f, dup_diff(f, 1)));
    Z content;
    return dup_primitive(sqf, content);
}

Factors dupTrialDivision(Dup f, const std::vector<Dup> &factors)
{
    Factors result;
    for (const Dup &factor : factors) {
        long k = 0;
        for (;;) {
            Dup q, r;
            dup_rr_div(f, factor, q, r);
            if (!r.empty()) break;
            f = q;
            k++;
        }
        if (k == 0) internal("trial division");
        result.push_back({dmp_from_dup(factor), k});
    }
    sortFactors(result, 0);
    return result;
}

void dupHenselStep(const Z &m, const Dup &f, Dup &g, Dup &h, Dup &s, Dup &t)
{
    const Z M = m * m;
    const Dup e = dup_trunc(dup_sub(f, dup_mul(g, h)), M);
    Dup q, r;
    dup_rr_div(dup_mul(s, e), h, q, r);
    q = dup_trunc(q, M);
    r = dup_trunc(r, M);
    Dup u = dup_add(dup_mul(t, e), dup_mul(q, g));
    const Dup G = dup_trunc(dup_add(g, u), M), H = dup_trunc(dup_add(h, r), M);
    u = dup_add(dup_mul(s, G), dup_mul(t, H));
    const Dup b = dup_trunc(dup_sub(u, {Z(1)}), M);
    Dup c, d;
    dup_rr_div(dup_mul(s, b), H, c, d);
    c = dup_trunc(c, M);
    d = dup_trunc(d, M);
    u = dup_add(dup_mul(t, b), dup_mul(c, G));
    s = dup_trunc(dup_sub(s, d), M);
    t = dup_trunc(dup_sub(t, u), M);
    g = G;
    h = H;
}

std::vector<Dup> dupHenselLift(const Z &p, const Dup &f, const std::vector<Dup> &list, long l)
{
    const std::size_t r = list.size();
    const Z lc = dup_LC(f), pl = power(p, l);
    if (r == 1) {
        Z g, s, t;
        SymEngine::mp_gcdext(g, s, t, lc, pl);
        return {dup_trunc(dup_mul_ground(f, s), pl)};
    }
    Z m = p;
    const std::size_t k = r / 2;
    long d = 0;
    while ((1L << d) < l) d++;
    const SmallField field{static_cast<SmallField::T>(p)};
    Gf<SmallField> g = gf_from_int_poly(field, Dup{lc});
    for (std::size_t i = 0; i < k; i++) g = gf_mul(field, g, gf_from_int_poly(field, list[i]));
    Gf<SmallField> h = gf_from_int_poly(field, list[k]);
    for (std::size_t i = k + 1; i < r; i++) h = gf_mul(field, h, gf_from_int_poly(field, list[i]));
    Gf<SmallField> s, t, ignored;
    gf_gcdex(field, g, h, s, t, ignored);
    Dup G = gf_to_int_poly(field, g), H = gf_to_int_poly(field, h), S = gf_to_int_poly(field, s), T = gf_to_int_poly(field, t);
    for (long i = 1; i <= d; i++) {
        dupHenselStep(m, f, G, H, S, T);
        m = m * m;
    }
    std::vector<Dup> left = dupHenselLift(p, G, std::vector<Dup>(list.begin(), list.begin() + static_cast<std::ptrdiff_t>(k)), l);
    const std::vector<Dup> right = dupHenselLift(p, H, std::vector<Dup>(list.begin() + static_cast<std::ptrdiff_t>(k), list.end()), l);
    left.insert(left.end(), right.begin(), right.end());
    return left;
}

bool testPl(const Z &fc, Z q, const Z &pl)
{
    if (q > floorDiv(pl, 2)) q -= pl;
    if (q == 0) return true;
    return floorMod(fc, q) == 0;
}

std::vector<Dup> dupZassenhaus(Dup f)
{
    const long n = dup_degree(f);
    if (n == 1) return {f};
    const Z fc = dup_TC(f), A = dup_max_norm(f);
    Z b = dup_LC(f);
    const Z B = SymEngine::mp_abs(isqrt(Z(n + 1)) * power(Z(2), n) * A * b);
    //C = (n + 1)^(2n) A^(2n - 1), its logarithm
    const double log2C = 2.0 * static_cast<double>(n) * std::log2(static_cast<double>(n + 1)) + static_cast<double>(2 * n - 1) * log2Of(A);
    const long gamma = static_cast<long>(std::ceil(2 * log2C));
    const long bound = static_cast<long>(2 * static_cast<double>(gamma) * std::log(static_cast<double>(gamma)));
    //A prime of which f is square free, of the fewest factors among a few
    std::vector<std::pair<long, std::vector<Gf<SmallField>>>> candidates;
    for (long px = 3; px <= std::max(bound, 3L); px++) {
        if (!smallPrime(px) || floorMod(b, Z(px)) == 0) continue;
        checkpoint();
        const SmallField field{static_cast<SmallField::T>(px)};
        const Gf<SmallField> F = gf_from_int_poly(field, f);
        if (!gf_sqf_p(field, F)) continue;
        SmallField::T lc;
        std::vector<Gf<SmallField>> factors = gf_factor_sqf(field, F, lc);
        const std::size_t count = factors.size();
        candidates.push_back({px, std::move(factors)});
        if (count < 15 || candidates.size() > 4) break;
    }
    if (candidates.empty()) internal("no prime for Zassenhaus' algorithm");
    std::size_t best = 0;
    for (std::size_t i = 1; i < candidates.size(); i++) if (candidates[i].second.size() < candidates[best].second.size()) best = i;
    const long p = candidates[best].first;
    const SmallField field{static_cast<SmallField::T>(p)};
    //p^l at least 2B + 1
    long l = 0;
    Z pl(1);
    while (pl < 2 * B + 1) {
        pl *= p;
        l++;
    }
    std::vector<Dup> modular;
    for (const Gf<SmallField> &factor : candidates[best].second) modular.push_back(gf_to_int_poly(field, factor));
    const std::vector<Dup> g = dupHenselLift(Z(p), f, modular, l);
    std::vector<std::size_t> sortedT(g.size());
    for (std::size_t i = 0; i < g.size(); i++) sortedT[i] = i;
    std::set<std::size_t> T(sortedT.begin(), sortedT.end());
    std::vector<Dup> factors;
    std::size_t s = 1;
    while (2 * s <= T.size()) {
        bool found = false;
        //The subsets of s indices, in lexicographic order
        std::vector<std::size_t> pick(s);
        for (std::size_t i = 0; i < s; i++) pick[i] = i;
        for (;;) {
            checkpoint();
            std::vector<std::size_t> S;
            for (const std::size_t i : pick) S.push_back(sortedT[i]);
            bool candidate = true;
            Dup G;
            if (b == 1) {
                Z q(1);
                for (const std::size_t i : S) q *= dup_TC(g[i]);
                q = floorMod(q, pl);
                candidate = testPl(fc, q, pl);
            } else {
                G = {b};
                for (const std::size_t i : S) G = dup_mul(G, g[i]);
                Z content;
                G = dup_primitive(dup_trunc(G, pl), content);
                const Z q = dup_TC(G);
                if (q != 0 && floorMod(fc, q) != 0) candidate = false;
            }
            if (candidate) {
                Dup H = {b};
                if (b == 1) {
                    G = {b};
                    for (const std::size_t i : S) G = dup_mul(G, g[i]);
                    G = dup_trunc(G, pl);
                }
                for (const std::size_t i : T) {
                    if (std::find(S.begin(), S.end(), i) == S.end()) H = dup_mul(H, g[i]);
                }
                H = dup_trunc(H, pl);
                if (dup_l1_norm(G) * dup_l1_norm(H) <= B) {
                    for (const std::size_t i : S) T.erase(i);
                    std::vector<std::size_t> remaining;
                    for (const std::size_t i : sortedT) if (std::find(S.begin(), S.end(), i) == S.end()) remaining.push_back(i);
                    sortedT = remaining;
                    Z content;
                    factors.push_back(dup_primitive(G, content));
                    f = dup_primitive(H, content);
                    b = dup_LC(f);
                    found = true;
                    break;
                }
            }
            //The next subset
            std::size_t i = s;
            while (i > 0 && pick[i - 1] == sortedT.size() - s + i - 1) i--;
            if (i == 0) break;
            pick[i - 1]++;
            for (std::size_t j = i; j < s; j++) pick[j] = pick[j - 1] + 1;
        }
        if (!found) s++;
    }
    factors.push_back(f);
    return factors;
}

std::vector<Dup> cyclotomicDecompose(long n)
{
    std::vector<Dup> H = {{Z(1), Z(-1)}};
    for (const auto &[p, k] : factorSmall(n)) {
        std::vector<Dup> Q;
        for (const Dup &h : H) Q.push_back(dup_quo(dup_inflate(h, p), h));
        H.insert(H.end(), Q.begin(), Q.end());
        for (long i = 1; i < k; i++) {
            for (Dup &q : Q) q = dup_inflate(q, p);
            H.insert(H.end(), Q.begin(), Q.end());
        }
    }
    return H;
}

std::optional<std::vector<Dup>> dupCyclotomicFactor(const Dup &f)
{
    if (dup_degree(f) <= 0) return std::nullopt;
    const Z lc = dup_LC(f), tc = dup_TC(f);
    if (lc != 1 || (tc != -1 && tc != 1)) return std::nullopt;
    for (std::size_t i = 1; i + 1 < f.size(); i++) if (f[i] != 0) return std::nullopt;
    const long n = dup_degree(f);
    //Bounded: x^n - 1 has the divisors of n as its cyclotomic factors
    if (n > 100000) return std::nullopt;
    const std::vector<Dup> F = cyclotomicDecompose(n);
    if (tc != 1) return F;
    std::vector<Dup> H;
    for (const Dup &h : cyclotomicDecompose(2 * n)) if (std::find(F.begin(), F.end(), h) == F.end()) H.push_back(h);
    return H;
}

std::pair<Z, std::vector<Dup>> dupFactorSqf(const Dup &f)
{
    Z content;
    Dup g = dup_primitive(f, content);
    const long n = dup_degree(g);
    if (dup_LC(g) < 0) {
        content = -content;
        g = dup_neg(g);
    }
    if (n <= 0) return {content, {}};
    if (n == 1) return {content, {g}};
    std::optional<std::vector<Dup>> factors = dupCyclotomicFactor(g);
    if (!factors) factors = dupZassenhaus(g);
    sortDups(*factors);
    return {content, *factors};
}

std::pair<Z, Factors> dupFactor(const Dup &f)
{
    Z content;
    Dup g = dup_primitive(f, content);
    const long n = dup_degree(g);
    if (dup_LC(g) < 0) {
        content = -content;
        g = dup_neg(g);
    }
    if (n <= 0) return {content, {}};
    if (n == 1) return {content, {{dmp_from_dup(g), 1}}};
    g = dupSqfPart(g);
    std::optional<std::vector<Dup>> H = dupCyclotomicFactor(g);
    if (!H) H = dupZassenhaus(g);
    return {content, dupTrialDivision(f, *H)};
}

//Several variables

Factors dmpTrialDivision(Dmp f, const std::vector<Dmp> &factors, long u)
{
    Factors result;
    for (const Dmp &factor : factors) {
        long k = 0;
        for (;;) {
            Dmp q, r;
            dmp_rr_div(f, factor, u, q, r);
            if (!dmp_zero_p(r, u)) break;
            f = q;
            k++;
        }
        if (k == 0) internal("trial division");
        result.push_back({factor, k});
    }
    sortFactors(result, u);
    return result;
}

Z dmpMignotteBound(const Dmp &f, long u)
{
    const Z a = dmp_max_norm(f, u), b = SymEngine::mp_abs(dmp_ground_LC(f, u));
    long n = 0;
    for (const long d : dmp_degree_list(f, u)) n += d;
    return isqrt(Z(n + 1)) * power(Z(2), n) * a * b;
}

//The integer of a constant of the level 0
Z groundOf(const Dmp &f)
{
    return f.g.empty() ? Z(0) : f.g.back();
}

std::optional<std::vector<Z>> nonDivisors(const std::vector<Z> &E, const Z &cs, const Z &ct)
{
    std::vector<Z> result = {cs * ct};
    for (Z q : E) {
        q = SymEngine::mp_abs(q);
        //A value of 0 (SymPy would loop): the points are not taken
        if (q == 0) return std::nullopt;
        for (auto r = result.rbegin(); r != result.rend(); ++r) {
            Z value = *r;
            while (value != 1) {
                value = gcd(value, q);
                q = floorDiv(q, value);
            }
            if (q == 1) return std::nullopt;
        }
        result.push_back(q);
    }
    return std::vector<Z>(result.begin() + 1, result.end());
}

struct TestPoints {
    Z c;
    Dup h;
    std::vector<Z> E;
};

std::optional<TestPoints> testPoints(const Dmp &f, const Factors &T, const Z &ct, const std::vector<Z> &A, long u)
{
    if (dmp_zero_p(dmp_eval_tail(dmp_LC(f, u), A, u - 1), 0)) return std::nullopt;
    const Dup g = dmp_eval_tail(f, A, u).g;
    if (!dupSqfP(g)) return std::nullopt;
    TestPoints points;
    points.h = dup_primitive(g, points.c);
    if (dup_LC(points.h) < 0) {
        points.c = -points.c;
        points.h = dup_neg(points.h);
    }
    for (const auto &[t, k] : T) points.E.push_back(groundOf(dmp_eval_tail(t, A, u - 1)));
    if (!nonDivisors(points.E, points.c, ct)) return std::nullopt;
    return points;
}

//dmp_zz_wang_lead_coeffs: the polynomial (multiplied when needed), the univariate factors and their leading coefficients
void leadCoeffs(Dmp &f, const Factors &T, Z cs, const std::vector<Z> &E, std::vector<Dup> &H, const std::vector<Z> &A, long u, std::vector<Dmp> &LC)
{
    const long v = u - 1;
    std::vector<Dmp> C;
    std::vector<int> J(E.size(), 0);
    for (const Dup &h : H) {
        Dmp c = dmp_one(v);
        Z d = dup_LC(h) * cs;
        for (std::size_t i = E.size(); i-- > 0;) {
            long k = 0;
            const Z &e = E[i];
            while (floorMod(d, e) == 0) {
                d = floorDiv(d, e);
                k++;
            }
            if (k != 0) {
                c = dmp_mul(c, dmp_pow(T[i].first, static_cast<unsigned long>(k), v), v);
                J[i] = 1;
            }
        }
        C.push_back(c);
    }
    if (!std::all_of(J.begin(), J.end(), [](int j) { return j != 0; })) throw ExtraneousFactors();
    std::vector<Dmp> CC;
    std::vector<Dup> HH;
    for (std::size_t i = 0; i < H.size(); i++) {
        Dmp c = C[i];
        Dup h = H[i];
        Z d = groundOf(dmp_eval_tail(c, A, v));
        const Z lc = dup_LC(h);
        Z cc;
        if (cs == 1) {
            cc = floorDiv(lc, d);
        } else {
            const Z g = gcd(lc, d);
            d = floorDiv(d, g);
            cc = floorDiv(lc, g);
            h = dup_mul_ground(h, d);
            cs = floorDiv(cs, d);
        }
        CC.push_back(dmp_mul_ground(c, cc, v));
        HH.push_back(h);
    }
    if (cs == 1) {
        H = HH;
        LC = CC;
        return;
    }
    LC.clear();
    H.clear();
    for (std::size_t i = 0; i < CC.size(); i++) {
        LC.push_back(dmp_mul_ground(CC[i], cs, v));
        H.push_back(dup_mul_ground(HH[i], cs));
    }
    f = dmp_mul_ground(f, power(cs, static_cast<long>(HH.size()) - 1), u);
}

std::vector<Dmp> dmpDiophantine(const std::vector<Dmp> &F, const Dmp &c, const std::vector<Z> &A, long d, const Z &p, long u);

//dup_zz_diophantine: s_i with sum s_i prod_{j != i} F_j = x^m modulo p
std::vector<Dup> dupDiophantine(const std::vector<Dup> &F, long m, const Z &p)
{
    const BigField field{p};
    std::vector<Dup> result;
    if (F.size() == 2) {
        const Gf<BigField> f = gf_from_int_poly(field, F[0]), g = gf_from_int_poly(field, F[1]);
        Gf<BigField> s, t, G;
        gf_gcdex(field, g, f, s, t, G);
        s = gf_lshift<BigField>(s, m);
        t = gf_lshift<BigField>(t, m);
        Gf<BigField> q, r;
        gf_div(field, s, f, q, r);
        s = r;
        t = gf_add_mul(field, t, q, g);
        result = {gf_to_int_poly(field, s), gf_to_int_poly(field, t)};
        return result;
    }
    std::vector<Dup> G = {F.back()};
    for (std::size_t i = F.size() - 1; i-- > 1;) G.insert(G.begin(), dup_mul(F[i], G.front()));
    std::vector<Dup> S, T = {{Z(1)}};
    for (std::size_t i = 0; i < G.size(); i++) {
        const std::vector<Dmp> pair = dmpDiophantine({dmp_from_dup(G[i]), dmp_from_dup(F[i])}, dmp_from_dup(T.back()), {}, 0, p, 1);
        T.push_back(pair[0].g);
        S.push_back(pair[1].g);
    }
    S.push_back(T.back());
    for (std::size_t i = 0; i < F.size(); i++) {
        const Gf<BigField> s = gf_from_int_poly(field, S[i]), f = gf_from_int_poly(field, F[i]);
        result.push_back(gf_to_int_poly(field, gf_rem(field, gf_lshift<BigField>(s, m), f)));
    }
    return result;
}

std::vector<Dmp> dmpDiophantine(const std::vector<Dmp> &F, const Dmp &c, const std::vector<Z> &A, long d, const Z &p, long u)
{
    if (A.empty()) {
        std::vector<Dup> S(F.size());
        std::vector<Dup> Fd;
        for (const Dmp &f : F) Fd.push_back(f.g);
        const long n = dup_degree(c.g);
        for (std::size_t i = 0; i < c.g.size(); i++) {
            const Z &coeff = c.g[i];
            if (coeff == 0) continue;
            const std::vector<Dup> T = dupDiophantine(Fd, n - static_cast<long>(i), p);
            for (std::size_t j = 0; j < S.size(); j++) S[j] = dup_trunc(dup_add(S[j], dup_mul_ground(T[j], coeff)), p);
        }
        std::vector<Dmp> result;
        for (const Dup &s : S) result.push_back(dmp_from_dup(s));
        return result;
    }
    const long n = static_cast<long>(A.size());
    const Dmp e = dmp_expand(F, u);
    const Z a = A.back();
    const std::vector<Z> rest(A.begin(), A.end() - 1);
    std::vector<Dmp> B, G;
    for (const Dmp &f : F) {
        B.push_back(dmp_quo(e, f, u));
        G.push_back(dmp_eval_in(f, a, n, u));
    }
    const Dmp C0 = dmp_eval_in(c, a, n, u);
    const long v = u - 1;
    std::vector<Dmp> S = dmpDiophantine(G, C0, rest, d, p, v);
    for (Dmp &s : S) s = dmp_raise(s, 1, v);
    Dmp cc = c;
    for (std::size_t i = 0; i < S.size(); i++) cc = dmp_sub_mul(cc, S[i], B[i], u);
    cc = dmp_ground_trunc(cc, p, u);
    const Dmp m = dmp_nest({Z(1), Z(-a)}, n);
    Dmp M = dmp_one(n);
    for (long k = 0; k < d; k++) {
        if (dmp_zero_p(cc, u)) break;
        checkpoint();
        M = dmp_mul(M, m, u);
        Dmp C = dmp_diff_eval_in(cc, k + 1, a, n, u);
        if (!dmp_zero_p(C, v)) {
            C = dmp_quo_ground(C, factorial(k + 1), v);
            std::vector<Dmp> T = dmpDiophantine(G, C, rest, d, p, v);
            for (Dmp &t : T) t = dmp_mul(dmp_raise(t, 1, v), M, u);
            for (std::size_t i = 0; i < S.size(); i++) S[i] = dmp_add(S[i], T[i], u);
            for (std::size_t i = 0; i < T.size(); i++) cc = dmp_sub_mul(cc, T[i], B[i], u);
            cc = dmp_ground_trunc(cc, p, u);
        }
    }
    for (Dmp &s : S) s = dmp_ground_trunc(s, p, u);
    return S;
}

std::vector<Dmp> wangHenselLifting(const Dmp &f, const std::vector<Dup> &H0, const std::vector<Dmp> &LC, const std::vector<Z> &A, const Z &p, long u)
{
    const long n = static_cast<long>(A.size()), v = u - 1;
    std::vector<Dmp> S = {f};
    for (long i = 0; i + 1 < n; i++) {
        const Z &a = A[static_cast<std::size_t>(n - 1 - i)];
        const Dmp s = dmp_eval_in(S.front(), a, n - i, u - i);
        S.insert(S.begin(), dmp_ground_trunc(s, p, v - i));
    }
    long d = 0;
    const std::vector<long> degrees = dmp_degree_list(f, u);
    for (std::size_t i = 1; i < degrees.size(); i++) d = std::max(d, degrees[i]);
    std::vector<Dmp> H;
    for (const Dup &h : H0) H.push_back(dmp_from_dup(h));
    for (long j = 2; j <= n + 1; j++) {
        const Dmp &s = S[static_cast<std::size_t>(j - 2)];
        const Z &a = A[static_cast<std::size_t>(j - 2)];
        const std::vector<Dmp> G = H;
        const long w = j - 1;
        const std::vector<Z> I(A.begin(), A.begin() + (j - 2)), Jtail(A.begin() + (j - 1), A.end());
        for (std::size_t i = 0; i < H.size(); i++) {
            const Dmp lc = dmp_ground_trunc(dmp_eval_tail(LC[i], Jtail, v), p, w - 1);
            Dmp tail;
            if (w - 1 == 0) {
                tail.g.assign(H[i].g.begin() + 1, H[i].g.end());
            } else {
                tail.c.assign(H[i].c.begin() + 1, H[i].c.end());
            }
            Dmp lifted = dmp_raise(tail, 1, w - 1);
            lifted.c.insert(lifted.c.begin(), lc);
            H[i] = lifted;
        }
        const Dmp m = dmp_nest({Z(1), Z(-a)}, w);
        Dmp M = dmp_one(w);
        Dmp c = dmp_sub(s, dmp_expand(H, w), w);
        const long dj = dmp_degree_in(s, w, w);
        for (long k = 0; k < dj; k++) {
            if (dmp_zero_p(c, w)) break;
            checkpoint();
            M = dmp_mul(M, m, w);
            Dmp C = dmp_diff_eval_in(c, k + 1, a, w, w);
            if (!dmp_zero_p(C, w - 1)) {
                C = dmp_quo_ground(C, factorial(k + 1), w - 1);
                const std::vector<Dmp> T = dmpDiophantine(G, C, I, d, p, w - 1);
                for (std::size_t i = 0; i < H.size(); i++) {
                    H[i] = dmp_ground_trunc(dmp_add_mul(H[i], dmp_raise(T[i], 1, w - 1), M, w), p, w);
                }
                c = dmp_ground_trunc(dmp_sub(s, dmp_expand(H, w), w), p, w);
            }
        }
    }
    if (!dmp_equal(dmp_expand(H, u), f, u)) throw ExtraneousFactors();
    return H;
}

Z nextPrime(const Z &n)
{
    const NumberTheoryResult result = numberTheoryOf("nextPrime", {{n}});
    return result.integers.at(0);
}

std::pair<Z, Factors> dmpZzFactor(const Dmp &f, long u);

//The random evaluation points of Wang's algorithm: a fixed sequence
class WangRandom {
public:
    long next(long mod)
    {
        state = state * 6364136223846793005ULL + 1442695040888963407ULL;
        return static_cast<long>((state >> 33) % static_cast<std::uint64_t>(2 * mod + 1)) - mod;
    }
private:
    std::uint64_t state = 0x77616e67ULL;
};

std::vector<Dmp> dmpWang(const Dmp &f0, long u, long mod = 0, int restarts = 0)
{
    WangRandom random;
    const std::pair<Z, Factors> lead = dmpZzFactor(dmp_LC(f0, u), u - 1);
    const Z &ct = lead.first;
    const Factors &T = lead.second;
    const Z p = nextPrime(dmpMignotteBound(f0, u));
    if (mod == 0) mod = u == 1 ? 2 : 1;
    std::set<std::vector<Z>> history;
    struct Config {
        Dup s;
        Z cs;
        std::vector<Z> E;
        std::vector<Dup> H;
        std::vector<Z> A;
    };
    std::vector<Config> configs;
    std::optional<std::size_t> r;
    std::vector<Z> A(static_cast<std::size_t>(u), Z(0));
    if (const std::optional<TestPoints> points = testPoints(f0, T, ct, A, u)) {
        const std::vector<Dup> H = dupFactorSqf(points->h).second;
        r = H.size();
        if (*r == 1) return {f0};
        configs.push_back({points->h, points->c, points->E, H, A});
    }
    const std::size_t numberOfConfigs = 3, numberOfTries = 5;
    const long modulusStep = 2;
    while (configs.size() < numberOfConfigs) {
        bool complete = false;
        for (std::size_t attempt = 0; attempt < numberOfTries; attempt++) {
            checkpoint();
            for (Z &a : A) a = Z(random.next(mod));
            if (!history.insert(A).second) continue;
            const std::optional<TestPoints> points = testPoints(f0, T, ct, A, u);
            if (!points) continue;
            const std::vector<Dup> H = dupFactorSqf(points->h).second;
            const std::size_t rr = H.size();
            if (r) {
                if (rr != *r) {
                    if (rr < *r) {
                        configs.clear();
                        r = rr;
                    } else {
                        continue;
                    }
                }
            } else {
                r = rr;
            }
            if (*r == 1) return {f0};
            configs.push_back({points->h, points->c, points->E, H, A});
            if (configs.size() == numberOfConfigs) {
                complete = true;
                break;
            }
        }
        if (!complete) mod += modulusStep;
    }
    std::size_t chosen = 0;
    for (std::size_t i = 1; i < configs.size(); i++) if (dup_max_norm(configs[i].s) < dup_max_norm(configs[chosen].s)) chosen = i;
    Config config = configs[chosen];
    std::vector<Dmp> factors;
    try {
        Dmp f = f0;
        std::vector<Dmp> LC;
        leadCoeffs(f, T, config.cs, config.E, config.H, config.A, u, LC);
        factors = wangHenselLifting(f, config.H, LC, config.A, p, u);
    } catch (const ExtraneousFactors &) {
        //Other evaluation points, a few times (SymPy restarts without a bound)
        if (restarts >= 20) internal("Wang's algorithm found extraneous factors");
        return dmpWang(f0, u, mod + 1, restarts + 1);
    }
    std::vector<Dmp> result;
    for (const Dmp &factor : factors) {
        Z content;
        Dmp g = dmp_ground_primitive(factor, u, content);
        if (dmp_ground_LC(g, u) < 0) g = dmp_neg(g, u);
        result.push_back(g);
    }
    return result;
}

std::pair<Z, Factors> dmpZzFactor(const Dmp &f, long u)
{
    if (u == 0) return dupFactor(f.g);
    if (dmp_zero_p(f, u)) return {Z(0), {}};
    Z content;
    Dmp g = dmp_ground_primitive(f, u, content);
    if (dmp_ground_LC(g, u) < 0) {
        content = -content;
        g = dmp_neg(g, u);
    }
    const std::vector<long> degrees = dmp_degree_list(g, u);
    if (std::all_of(degrees.begin(), degrees.end(), [](long d) { return d <= 0; })) return {content, {}};
    Dmp G;
    g = dmp_primitive(g, u, G);
    Factors factors;
    if (dmp_degree(g, u) > 0) {
        g = dmp_sqf_part(g, u);
        const std::vector<Dmp> H = dmpWang(g, u);
        factors = dmpTrialDivision(f, H, u);
    }
    for (const auto &[h, k] : dmpZzFactor(G, u - 1).second) {
        Dmp lifted;
        lifted.c.push_back(h);
        factors.insert(factors.begin(), {lifted, k});
    }
    sortFactors(factors, u);
    return {content, factors};
}

}

bool dmp_sqf_p(const Dmp &f, long u)
{
    if (u == 0) return dupSqfP(f.g);
    if (dmp_zero_p(f, u)) return true;
    for (long i = 0; i <= u; i++) {
        const Dmp fp = dmp_diff_in(f, 1, i, u);
        if (dmp_zero_p(fp, u)) continue;
        if (dmp_degree_in(dmp_gcd(f, fp, u), i, u) != 0) return false;
    }
    return true;
}

Dmp dmp_sqf_part(const Dmp &f0, long u)
{
    if (u == 0) return dmp_from_dup(dupSqfPart(f0.g));
    if (dmp_zero_p(f0, u)) return f0;
    Dmp f = dmp_ground_LC(f0, u) < 0 ? dmp_neg(f0, u) : f0;
    Dmp g = f;
    for (long i = 0; i <= u; i++) g = dmp_gcd(g, dmp_diff_in(f, 1, i, u), u);
    Z content;
    return dmp_ground_primitive(dmp_quo(f, g, u), u, content);
}

Factorization dmp_sqf_list(const Dmp &f0, long u)
{
    Factorization result;
    Dmp f = dmp_ground_primitive(f0, u, result.coefficient);
    if (dmp_zero_p(f0, u)) result.coefficient = 0;
    if (dmp_ground_LC(f, u) < 0) {
        f = dmp_neg(f, u);
        result.coefficient = -result.coefficient;
    }
    const long degree = dmp_degree(f, u);
    if (degree < 0) return result;
    if (u == 0) {
        if (degree <= 0) return result;
        long i = 1;
        Cofactors gpq = dmp_inner_gcd(f, dmp_diff(f, 1, 0), 0);
        for (;;) {
            checkpoint();
            const Dmp h = dmp_sub(gpq.cfg, dmp_diff(gpq.cff, 1, 0), 0);
            if (dmp_zero_p(h, 0)) {
                result.factors.push_back({gpq.cff, i});
                break;
            }
            gpq = dmp_inner_gcd(gpq.cff, h, 0);
            if (dmp_degree(gpq.h, 0) > 0) result.factors.push_back({gpq.h, i});
            i++;
        }
        return result;
    }
    //Yun's algorithm on the primitive part in the first variable, the content decomposed in the others
    Dmp content;
    f = dmp_primitive(f, u, content);
    std::vector<std::pair<long, Dmp>> found;
    if (degree != 0) {
        long i = 1;
        Cofactors gpq = dmp_inner_gcd(f, dmp_diff(f, 1, u), u);
        for (;;) {
            checkpoint();
            const Dmp h = dmp_sub(gpq.cfg, dmp_diff(gpq.cff, 1, u), u);
            if (dmp_zero_p(h, u)) {
                found.push_back({i, gpq.cff});
                break;
            }
            gpq = dmp_inner_gcd(gpq.cff, h, u);
            if (dmp_degree(gpq.h, u) > 0) found.push_back({i, gpq.h});
            i++;
        }
    }
    const Factorization inner = dmp_sqf_list(content, u - 1);
    result.coefficient *= inner.coefficient;
    for (const auto &entry : inner.factors) {
        const long k = entry.second;
        Dmp lifted;
        lifted.c.push_back(entry.first);
        const auto same = std::find_if(found.begin(), found.end(), [k](const std::pair<long, Dmp> &other) { return other.first == k; });
        if (same != found.end()) {
            same->second = dmp_mul(same->second, lifted, u);
        } else {
            found.push_back({k, lifted});
        }
    }
    std::sort(found.begin(), found.end(), [](const std::pair<long, Dmp> &a, const std::pair<long, Dmp> &b) { return a.first < b.first; });
    for (const auto &[k, factor] : found) result.factors.push_back({factor, k});
    return result;
}

Factorization dmp_factor_list(const Dmp &f0, long u)
{
    Factorization result;
    Dmp f = f0;
    const std::vector<long> J = dmp_terms_gcd(f, u);
    Z content;
    f = dmp_ground_primitive(f, u, content);
    long v = u;
    const std::vector<long> levels = dmp_exclude(f, v);
    const std::pair<Z, Factors> factored = dmpZzFactor(f, v);
    result.coefficient = factored.first * content;
    for (const auto &[factor, k] : factored.second) result.factors.push_back({dmp_include(factor, levels, v), k});
    //The monomials taken out: x_i^j
    for (std::size_t i = J.size(); i-- > 0;) {
        if (!J[i]) continue;
        std::vector<long> exponents(J.size(), 0);
        exponents[i] = 1;
        result.factors.insert(result.factors.begin(), {dmp_from_terms({{exponents, Z(1)}}, u), J[i]});
    }
    sortFactors(result.factors, u);
    return result;
}

}
}
