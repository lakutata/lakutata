//The functions of the decimals mpdecimal has not: the trigonometric and hyperbolic ones and their inverses, the
//constants of Euler and Catalan. Each one works with guard digits (more for the digits a reduction loses) and rounds
//its result to the digits of its context.
#include "Decimal.h"
#include "DecimalSupport.h"

#include <climits>
#include <cmath>
#include <string>

#include "../async/Pool.h"
#include "../core/Errors.h"

namespace math {

namespace {

//Whether e^-|a| is below the last guard digit of a context: e^|a| ± e^-|a| is e^|a| there (and e^-|a| may be beyond
//the exponents of the decimals)
bool negligibleInverse(const DecimalContext &g, const Decimal &a)
{
    return g.compare(g.abs(a), g.integer(g.digits() * 3 + 10)) > 0;
}

//The Taylor series of sin (odd) or cos (even) at r, |r| <= pi/4
Decimal sinCosSeries(const DecimalContext &g, const Decimal &r, bool cosine)
{
    const Decimal square = g.mul(r, r);
    const Decimal limit = negligible(g);
    Decimal term = cosine ? g.integer(1) : r;
    Decimal sum = term;
    for (long long power = cosine ? 0 : 1;; power += 2) {
        term = g.neg(g.div(g.mul(term, square), g.integer((power + 1) * (power + 2))));
        if (g.compare(g.abs(term), limit) < 0) break;
        sum = g.add(sum, term);
        if (power % 128 == 1 || power % 128 == 0) checkpoint();
    }
    return sum;
}

//sin(x) or cos(x) at the precision of g: x reduced by the multiples of pi/2 to |r| <= pi/4, with the digits of x above
//its point added to g (the reduction loses them)
Decimal sinOrCos(const DecimalContext &context, const Decimal &x, bool cosine)
{
    if (context.isZero(x)) return context.integer(cosine ? 1 : 0);
    const DecimalContext g(context.digits() + integerDigits(context, x) + 15);
    const Decimal turns = g.roundToInteger(g.div(x, g.div(g.pi(), g.integer(2))));
    const Decimal four = g.integer(4);
    const long long quadrant = smallInteger(g.sub(turns, g.mul(four, g.floor(g.div(turns, four)))));
    //sin(r + q pi/2) is sin(r), cos(r), -sin(r), -cos(r); cos(t) is sin(t + pi/2)
    const long long shift = cosine ? (quadrant + 1) % 4 : quadrant;
    Decimal r = g.sub(x, g.mul(turns, g.div(g.pi(), g.integer(2))));
    //sin(r) of a small r (x near a multiple of pi): r again with its digits below the point more, the digits of the
    //value being below them
    const int64_t small = smallDigits(g, r);
    const DecimalContext h(g.digits() + (shift % 2 == 1 ? 0 : small));
    if (shift % 2 == 0 && small > 0) r = h.sub(x, h.mul(turns, h.div(h.pi(), h.integer(2))));
    Decimal value = sinCosSeries(h, r, shift % 2 == 1);
    if (shift >= 2) value = h.neg(value);
    return context.round(value);
}

}

Decimal DecimalContext::sin(const Decimal &a) const
{
    return sinOrCos(*this, a, false);
}

Decimal DecimalContext::cos(const Decimal &a) const
{
    return sinOrCos(*this, a, true);
}

Decimal DecimalContext::tan(const Decimal &a) const
{
    const DecimalContext g(digits() + 10);
    const Decimal cosine = g.cos(a);
    if (g.isZero(cosine)) notReal("the tangent of an odd multiple of pi/2");
    return round(g.div(g.sin(a), cosine));
}

Decimal DecimalContext::atan(const Decimal &a) const
{
    if (isZero(a)) return integer(0);
    if (isNegative(a)) return neg(atan(neg(a)));
    const DecimalContext g(digits() + 15);
    //atan(a) = pi/2 - atan(1/a) above 1
    if (compare(a, integer(1)) > 0) return round(g.sub(g.div(g.pi(), g.integer(2)), g.atan(g.div(g.integer(1), a))));
    //atan(x) = 2 atan(x / (1 + sqrt(1 + x^2))): halved below 0.01, then the series x - x^3/3 + x^5/5…
    Decimal x = g.round(a);
    long long doublings = 0;
    const Decimal small = g.parse("0.01");
    while (g.compare(x, small) > 0) {
        x = g.div(x, g.add(g.integer(1), g.sqrt(g.add(g.integer(1), g.mul(x, x)))));
        doublings++;
    }
    const Decimal square = g.mul(x, x);
    const Decimal limit = negligible(g);
    Decimal power = x;
    Decimal sum = x;
    for (long long k = 1;; k++) {
        power = g.neg(g.mul(power, square));
        const Decimal term = g.div(power, g.integer(2 * k + 1));
        if (g.compare(g.abs(term), limit) < 0) break;
        sum = g.add(sum, term);
        if (k % 128 == 0) checkpoint();
    }
    return round(g.mul(sum, g.integer(1LL << doublings)));
}

Decimal DecimalContext::asin(const Decimal &a) const
{
    const int size = compare(abs(a), integer(1));
    if (size > 0) notReal("asin of a number beyond 1");
    const DecimalContext g(digits() + 15);
    const Decimal halfPi = g.div(g.pi(), g.integer(2));
    if (size == 0) return round(isNegative(a) ? g.neg(halfPi) : halfPi);
    //asin(a) = atan(a / sqrt((1 - a)(1 + a)))
    const Decimal one = g.integer(1);
    return round(g.atan(g.div(a, g.sqrt(g.mul(g.sub(one, a), g.add(one, a))))));
}

Decimal DecimalContext::acos(const Decimal &a) const
{
    if (compare(abs(a), integer(1)) > 0) notReal("acos of a number beyond 1");
    const DecimalContext g(digits() + 15);
    if (compare(a, integer(-1)) == 0) return round(g.pi());
    //acos(a) = 2 atan(sqrt((1 - a)/(1 + a))): no cancellation near 1
    const Decimal one = g.integer(1);
    return round(g.mul(g.integer(2), g.atan(g.sqrt(g.div(g.sub(one, a), g.add(one, a))))));
}

Decimal DecimalContext::atan2(const Decimal &y, const Decimal &x) const
{
    const DecimalContext g(digits() + 15);
    if (isZero(x)) {
        if (isZero(y)) notReal("the argument of 0");
        const Decimal halfPi = g.div(g.pi(), g.integer(2));
        return round(isNegative(y) ? g.neg(halfPi) : halfPi);
    }
    const Decimal angle = g.atan(g.div(y, x));
    if (!isNegative(x)) return round(angle);
    return round(isNegative(y) ? g.sub(angle, g.pi()) : g.add(angle, g.pi()));
}

Decimal DecimalContext::sinh(const Decimal &a) const
{
    if (isZero(a)) return integer(0);
    const DecimalContext g(digits() + 15);
    //Below 1, the series a + a^3/3! + …: (e^a - e^-a)/2 cancels there
    if (compare(abs(a), integer(1)) < 0) {
        const Decimal square = g.mul(a, a);
        const Decimal limit = negligible(g);
        Decimal term = g.round(a);
        Decimal sum = term;
        for (long long power = 1;; power += 2) {
            term = g.div(g.mul(term, square), g.integer((power + 1) * (power + 2)));
            if (g.compare(g.abs(term), g.mul(limit, g.abs(sum))) < 0) break;
            sum = g.add(sum, term);
            if (power % 128 == 1) checkpoint();
        }
        return round(sum);
    }
    if (negligibleInverse(g, a)) return round(isNegative(a) ? g.neg(g.div(g.exp(g.abs(a)), g.integer(2))) : g.div(g.exp(a), g.integer(2)));
    const Decimal e = g.exp(a);
    return round(g.div(g.sub(e, g.div(g.integer(1), e)), g.integer(2)));
}

Decimal DecimalContext::cosh(const Decimal &a) const
{
    const DecimalContext g(digits() + 15);
    if (negligibleInverse(g, a)) return round(g.div(g.exp(g.abs(a)), g.integer(2)));
    const Decimal e = g.exp(a);
    return round(g.div(g.add(e, g.div(g.integer(1), e)), g.integer(2)));
}

Decimal DecimalContext::tanh(const Decimal &a) const
{
    if (isZero(a)) return integer(0);
    const DecimalContext g(digits() + 15);
    if (compare(abs(a), integer(1)) < 0) return round(g.div(g.sinh(a), g.cosh(a)));
    //1 - 2e^-2|a| within the last guard digit of 1
    if (negligibleInverse(g, a)) return integer(isNegative(a) ? -1 : 1);
    //(1 - e^-2|a|)/(1 + e^-2|a|), of the sign of a
    const Decimal e = g.exp(g.mul(g.integer(-2), abs(a)));
    const Decimal value = g.div(g.sub(g.integer(1), e), g.add(g.integer(1), e));
    return round(isNegative(a) ? g.neg(value) : value);
}

Decimal DecimalContext::asinh(const Decimal &a) const
{
    if (isZero(a)) return integer(0);
    if (isNegative(a)) return neg(asinh(neg(a)));
    //ln(a + sqrt(a^2 + 1)): ln(1 + a) of a small a loses its digits below 1
    const DecimalContext g(digits() + smallDigits(*this, a) + 15);
    return round(g.ln(g.add(a, g.sqrt(g.add(g.mul(a, a), g.integer(1))))));
}

Decimal DecimalContext::acosh(const Decimal &a) const
{
    const int size = compare(a, integer(1));
    if (size < 0) notReal("acosh of a number below 1");
    if (size == 0) return integer(0);
    const DecimalContext g(digits() + smallDigits(*this, sub(a, integer(1))) + 15);
    const Decimal one = g.integer(1);
    return round(g.ln(g.add(a, g.sqrt(g.mul(g.sub(a, one), g.add(a, one))))));
}

Decimal DecimalContext::atanh(const Decimal &a) const
{
    if (compare(abs(a), integer(1)) >= 0) notReal("atanh of a number not between -1 and 1");
    if (isZero(a)) return integer(0);
    //ln((1 + a)/(1 - a))/2
    const DecimalContext g(digits() + smallDigits(*this, a) + 15);
    const Decimal one = g.integer(1);
    return round(g.div(g.ln(g.div(g.add(one, a), g.sub(one, a))), g.integer(2)));
}

Decimal DecimalContext::eulerGamma() const
{
    //Brent and McMillan: B(k) = (n^k/k!)^2, A(k) = (A(k - 1) n^2/k + B(k))/k from A(0) = -ln(n), γ = ΣA/ΣB within
    //pi e^(-4n); the terms grow to e^(2n) before they fall, their digits added
    const long n = static_cast<long>(std::ceil(digits() * 2.302585092994046 / 4)) + 2;
    const DecimalContext g(digits() + static_cast<long>(std::ceil(2 * n / 2.302585092994046)) + 15);
    const Decimal square = g.integer(static_cast<long long>(n) * n);
    const Decimal limit = negligible(g);
    Decimal a = g.neg(g.ln(g.integer(n)));
    Decimal b = g.integer(1);
    Decimal u = a;
    Decimal v = b;
    for (long long k = 1;; k++) {
        b = g.div(g.mul(b, square), g.integer(k * k));
        a = g.div(g.add(g.div(g.mul(a, square), g.integer(k)), b), g.integer(k));
        u = g.add(u, a);
        v = g.add(v, b);
        if (k > n && g.compare(g.abs(b), g.mul(limit, v)) < 0 && g.compare(g.abs(a), g.mul(limit, g.abs(u))) < 0) break;
        if (k % 64 == 0) checkpoint();
    }
    return round(g.div(u, v));
}

Decimal DecimalContext::catalan() const
{
    //Ramanujan: G = pi/8 ln(2 + sqrt(3)) + 3/8 Σ (n!)^2/((2n)! (2n + 1)^2)
    const DecimalContext g(digits() + 15);
    const Decimal limit = negligible(g);
    Decimal coefficient = g.integer(1);
    Decimal sum = g.integer(0);
    for (long long n = 0;; n++) {
        const Decimal term = g.div(coefficient, g.integer((2 * n + 1) * (2 * n + 1)));
        if (g.compare(term, limit) < 0) break;
        sum = g.add(sum, term);
        coefficient = g.div(g.mul(coefficient, g.integer(n + 1)), g.integer(2 * (2 * n + 1)));
        if (n % 128 == 0) checkpoint();
    }
    const Decimal logarithm = g.ln(g.add(g.integer(2), g.sqrt(g.integer(3))));
    return round(g.add(g.div(g.mul(g.pi(), logarithm), g.integer(8)), g.div(g.mul(g.integer(3), sum), g.integer(8))));
}

}
