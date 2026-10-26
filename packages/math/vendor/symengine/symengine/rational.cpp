#include <symengine/rational.h>
#include <symengine/pow.h>
#include <symengine/symengine_exception.h>
#include <symengine/prime_sieve.h>
#include <symengine/mul.h>
#include <symengine/complex.h>
#include <symengine/limits.h>

namespace SymEngine
{

bool Rational::is_canonical(const rational_class &i) const
{
    rational_class x = i;
    canonicalize(x);
    // If 'x' is an integer, it should not be Rational:
    if (SymEngine::get_den(x) == 1)
        return false;
    // if 'i' is not in canonical form:
    if (SymEngine::get_num(x) != SymEngine::get_num(i))
        return false;
    if (SymEngine::get_den(x) != SymEngine::get_den(i))
        return false;
    return true;
}

RCP<const Number> Rational::from_mpq(const rational_class &i)
{
    // If the result is an Integer, return an Integer:
    if (SymEngine::get_den(i) == 1) {
        return integer(SymEngine::get_num(i));
    } else {
        rational_class j(i);
        return make_rcp<const Rational>(std::move(j));
    }
}

RCP<const Number> Rational::from_mpq(rational_class &&i)
{
    // If the result is an Integer, return an Integer:
    if (SymEngine::get_den(i) == 1) {
        return integer(SymEngine::get_num(i));
    } else {
        return make_rcp<const Rational>(std::move(i));
    }
}

RCP<const Number> Rational::from_two_ints(const Integer &n, const Integer &d)
{
    if (d.as_integer_class() == 0) {
        if (n.as_integer_class() == 0) {
            return Nan;
        } else {
            return ComplexInf;
        }
    }
#if SYMENGINE_INTEGER_CLASS == SYMENGINE_BOOSTMP
    // workaround https://github.com/boostorg/rational/issues/27
    rational_class q;
    if (d.as_integer_class() < 0) {
        q = rational_class(-n.as_integer_class(), -d.as_integer_class());
    } else {
        q = rational_class(n.as_integer_class(), d.as_integer_class());
    }
#else
    rational_class q(n.as_integer_class(), d.as_integer_class());
#endif
    // This is potentially slow, but has to be done, since 'n/d' might not be
    // in canonical form.
    canonicalize(q);

    return Rational::from_mpq(std::move(q));
}

RCP<const Number> Rational::from_two_ints(long n, long d)
{
    if (d == 0) {
        if (n == 0) {
            return Nan;
        } else {
            return ComplexInf;
        }
    }
#if SYMENGINE_INTEGER_CLASS == SYMENGINE_BOOSTMP
    // workaround https://github.com/boostorg/rational/issues/27
    if (d < 0) {
        d *= -1;
        n *= -1;
    }
#endif
    rational_class q(n, d);

    // This is potentially slow, but has to be done, since 'n/d' might not be
    // in canonical form.
    canonicalize(q);

    return Rational::from_mpq(q);
}

hash_t Rational::__hash__() const
{
    // only the least significant bits that fit into "signed long int" are
    // hashed:
    hash_t seed = SYMENGINE_RATIONAL;
    hash_combine<long long int>(seed, mp_get_si(SymEngine::get_num(this->i)));
    hash_combine<long long int>(seed, mp_get_si(SymEngine::get_den(this->i)));
    return seed;
}

bool Rational::__eq__(const Basic &o) const
{
    if (is_a<Rational>(o)) {
        const Rational &s = down_cast<const Rational &>(o);
        return this->i == s.i;
    }
    return false;
}

int Rational::compare(const Basic &o) const
{
    if (is_a<Rational>(o)) {
        const Rational &s = down_cast<const Rational &>(o);
        if (i == s.i)
            return 0;
        return i < s.i ? -1 : 1;
    }
    if (is_a<Integer>(o)) {
        const Integer &s = down_cast<const Integer &>(o);
        return i < s.as_integer_class() ? -1 : 1;
    }
    throw NotImplementedError("unhandled comparison of Rational");
}

void get_num_den(const Rational &rat, const Ptr<RCP<const Integer>> &num,
                 const Ptr<RCP<const Integer>> &den)
{
    *num = integer(SymEngine::get_num(rat.as_rational_class()));
    *den = integer(SymEngine::get_den(rat.as_rational_class()));
}

bool Rational::is_perfect_power(bool is_expected) const
{
    const integer_class &num = SymEngine::get_num(i);
    if (num == 1)
        return mp_perfect_power_p(SymEngine::get_den(i));

    const integer_class &den = SymEngine::get_den(i);
    // TODO: fix this
    if (not is_expected) {
        if (mp_cmpabs(num, den) > 0) {
            if (!mp_perfect_power_p(den))
                return false;
        } else {
            if (!mp_perfect_power_p(num))
                return false;
        }
    }
    integer_class prod = num * den;
    return mp_perfect_power_p(prod);
}

bool Rational::nth_root(const Ptr<RCP<const Number>> &the_rat,
                        unsigned long n) const
{
    if (n == 0)
        throw SymEngineException("i_nth_root: Can not find Zeroth root");

#if SYMENGINE_INTEGER_CLASS != SYMENGINE_BOOSTMP
    rational_class r;
    int ret = mp_root(SymEngine::get_num(r), SymEngine::get_num(i), n);
    if (ret == 0)
        return false;
    ret = mp_root(SymEngine::get_den(r), SymEngine::get_den(i), n);
    if (ret == 0)
        return false;
#else
    // boost::multiprecision::cpp_rational doesn't provide
    // non-const get_num and get_den
    integer_class num, den;
    int ret = mp_root(num, SymEngine::get_num(i), n);
    if (ret == 0)
        return false;
    ret = mp_root(den, SymEngine::get_den(i), n);
    if (ret == 0)
        return false;
    rational_class r(num, den);
#endif
    // No need to canonicalize since `this` is in canonical form
    *the_rat = make_rcp<const Rational>(std::move(r));
    return true;
}

RCP<const Basic> Rational::powrat(const Rational &other) const
{
    return SymEngine::mul(other.rpowrat(*this->get_num()),
                          other.neg()->rpowrat(*this->get_den()));
}

namespace
{

// lakutata: the factors of |base| below 2**15 by trial division, then the
// rest when it is a perfect power (its factors are all above 2**15, so its
// exponent is small)
std::vector<std::pair<integer_class, unsigned long>>
root_factors(const integer_class &base)
{
    std::vector<std::pair<integer_class, unsigned long>> factors;
    integer_class rest = base, quotient, remainder, root;
    Sieve::iterator primes(32768);
    for (unsigned long prime = primes.next_prime(); prime <= 32768;
         prime = primes.next_prime()) {
        const integer_class divisor(prime);
        if (divisor * divisor > rest)
            break;
        unsigned long exponent = 0;
        while (true) {
            mp_fdiv_qr(quotient, remainder, rest, divisor);
            if (remainder != 0)
                break;
            rest = quotient;
            exponent++;
        }
        if (exponent > 0)
            factors.emplace_back(divisor, exponent);
    }
    unsigned long power = 1;
    bool found = rest > 32768;
    while (found) {
        found = false;
        Sieve::iterator roots(4096);
        for (unsigned long k = roots.next_prime();
             k <= 4096 and (integer_class(1) << (15 * k)) <= rest;
             k = roots.next_prime()) {
            if (mp_root(root, rest, k)) {
                rest = root;
                power *= k;
                found = true;
                break;
            }
        }
    }
    if (rest > 1)
        factors.emplace_back(rest, power);
    return factors;
}

}

// lakutata: base**(r/den) (0 < r < den) as coef * the surds, the powers of
// the factors of the base taken out of the root, as SymPy's
// Integer._eval_power: false when nothing is taken out (the root is kept)
static bool extract_root_factors(RCP<const Number> &coef, map_basic_basic &surd,
                          const integer_class &base, const integer_class &r,
                          const integer_class &den)
{
    const integer_class magnitude = mp_abs(base);
    // Not for the roots above 2**15: the powers left under the root could be
    // too large to compute (x**(r/den) with r and den of 16 digits)
    if (magnitude <= 1 or den > 32768
        or exact_power_too_large(magnitude, den))
        return false;
    integer_class taken = 1, left = 1, common = 0, power;
    std::vector<std::pair<integer_class, integer_class>> remaining;
    map_basic_basic radicals;
    for (const auto &factor : root_factors(magnitude)) {
        const integer_class exponent = factor.second * r;
        integer_class whole, part, g;
        mp_fdiv_qr(whole, part, exponent, den);
        if (whole > 0) {
            mp_pow_ui(power, factor.first, mp_get_ui(whole));
            taken *= power;
        }
        if (part == 0)
            continue;
        mp_gcd(g, part, den);
        if (g != 1) {
            insert(radicals, integer(factor.first),
                   Rational::from_mpq(rational_class(part / g, den / g)));
        } else {
            remaining.emplace_back(factor.first, part);
            mp_gcd(common, common, part);
        }
    }
    for (const auto &factor : remaining) {
        mp_pow_ui(power, factor.first, mp_get_ui(factor.second / common));
        left *= power;
    }
    if (left == magnitude and taken == 1 and radicals.empty())
        return false;
    const bool negative = base < 0;
    coef = mulnum(coef, integer(std::move(taken)));
    if (negative and den == 2)
        imulnum(outArg(coef), I);
    for (const auto &radical : radicals)
        insert(surd, radical.first, radical.second);
    if (left > 1) {
        // A negative base keeps its sign under an odd root: (-24)**(1/3)
        // is 2*(-3)**(1/3)
        insert(surd, integer(negative and den != 2 ? integer_class(-left) : left),
               Rational::from_mpq(rational_class(common, den)));
    } else if (negative and den != 2) {
        insert(surd, minus_one, Rational::from_mpq(rational_class(r, den)));
    }
    return true;
}

RCP<const Basic> Rational::rpowrat(const Integer &other) const
{
    if (other.is_one()) {
        return one;
    }
    RCP<const Integer> res;
    if (mp_fits_ulong_p(SymEngine::get_den(i))) {
        unsigned long den = mp_get_ui(SymEngine::get_den(i));
        if (other.is_negative()) {
            RCP<const Integer> neg_other = other.neg();
            if (not other.is_minus_one()
                and i_nth_root(outArg(res), *neg_other, den)) {
                return SymEngine::mul(this->rpowrat(*minus_one),
                                      res->powint(*get_num()));
            }
        } else if (i_nth_root(outArg(res), other, den)) {
            // res == other**(1/den)
            // return res**num
            return res->powint(*get_num());
        }
    }
    integer_class q, r;
    auto num = SymEngine::get_num(i);
    auto den = SymEngine::get_den(i);

    mp_fdiv_qr(q, r, num, den);
    // lakutata: a whole part of the exponent too large to compute: the power
    // stays as written
    if (exact_power_too_large(other.as_integer_class(), q))
        return make_rcp<const Pow>(other.rcp_from_this(), rcp_from_this());
    // Here we make the exponent postive and a fraction between
    // 0 and 1. We multiply numerator and denominator appropriately
    // to achieve this
    RCP<const Number> coef = other.powint(*integer(q));
    map_basic_basic surd;

    // lakutata: the powers in the base taken out of the root, as SymPy
    // does (sqrt(8) is 2*sqrt(2), 8**(1/4) is 2**(3/4))
    if (extract_root_factors(coef, surd, other.as_integer_class(), r, den))
        return Mul::from_dict(coef, std::move(surd));

    if ((other.is_negative()) and den == 2) {
        imulnum(outArg(coef), I);
        // if other.neg() is one, no need to add it to dict
        if (not other.is_minus_one())
            insert(surd, other.neg(),
                   Rational::from_mpq(rational_class(r, den)));
    } else {
        insert(surd, other.rcp_from_this(),
               Rational::from_mpq(rational_class(r, den)));
    }
    return Mul::from_dict(coef, std::move(surd));
}

} // namespace SymEngine
