//The simplification of expressions (see Simplify.h)
#include "Simplify.h"

#include <algorithm>
#include <atomic>
#include <functional>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include <symengine/add.h>
#include <symengine/constants.h>
#include <symengine/functions.h>
#include <symengine/integer.h>
#include <symengine/logic.h>
#include <symengine/mul.h>
#include <symengine/pow.h>
#include <symengine/rational.h>
#include <symengine/simplify.h>
#include <symengine/subs.h>
#include <symengine/symbol.h>
#include <symengine/visitor.h>

#include "../async/Pool.h"
#include "../core/Errors.h"
#include "../ops/Operations.h"
#include "../poly/Poly.h"
#include "../poly/Rational.h"
#include "../printer/Printer.h"

namespace math {

using namespace SymEngine;

namespace {

using Variable = RCP<const Symbol>;

//Past this measure the fractions are not tried (their gcds are slow on large expressions)
constexpr unsigned long LARGEST_MEASURE = 400;
//The multiples of an angle expanded at most (sin(8x) as a polynomial in sin(x) and cos(x)), of an exponential
constexpr long LARGEST_MULTIPLE = 8;
constexpr long LARGEST_POWER = 16;
//The largest integer power of a sum expanded (higher, the fractions and the expansion are not tried: (sin(x) +
//cos(x))^40 took seconds)
constexpr long LARGEST_EXPANDED_POWER = 16;
//The largest numerator of a numeric exponent in the fractions: e^(6561/256) is a polynomial of degree 6561 in e^(1/256),
//factored in seconds
constexpr long LARGEST_DEGREE = 256;
//The square roots taken out of a denominator at most
constexpr size_t LARGEST_ROOTS = 3;

//A generator of the fractions: a name no other has (no name of the parser has @; the polynomials know variables by
//their names)
Variable fresh(const std::string &name)
{
    static std::atomic<size_t> count{0};
    return symbol("@" + name + std::to_string(++count));
}

//Whether a generator is left in an expression (a form written back incompletely: not taken)
bool internal(const Expr &e)
{
    for (const auto &atom : free_symbols(*e)) {
        if (down_cast<const Symbol &>(*atom).get_name().rfind('@', 0) == 0) return true;
    }
    return false;
}

//Whether an expression has an integer power of a sum above LARGEST_EXPANDED_POWER, or a power whose numeric exponent
//has a numerator above LARGEST_DEGREE
bool largePower(const Expr &e)
{
    if (is_a<Pow>(*e) && is_a<Add>(*down_cast<const Pow &>(*e).get_base()) && is_a<Integer>(*down_cast<const Pow &>(*e).get_exp())) {
        const integer_class &exponent = down_cast<const Integer &>(*down_cast<const Pow &>(*e).get_exp()).as_integer_class();
        if (exponent > LARGEST_EXPANDED_POWER || exponent < -LARGEST_EXPANDED_POWER) return true;
    }
    if (is_a<Pow>(*e) && (is_a<Integer>(*down_cast<const Pow &>(*e).get_exp()) || is_a<Rational>(*down_cast<const Pow &>(*e).get_exp()))) {
        const Expr exponent = down_cast<const Pow &>(*e).get_exp();
        const integer_class numerator = is_a<Integer>(*exponent) ? down_cast<const Integer &>(*exponent).as_integer_class() : get_num(down_cast<const Rational &>(*exponent).as_rational_class());
        if (numerator > LARGEST_DEGREE || numerator < -LARGEST_DEGREE) return true;
    }
    for (const Expr &argument : e->get_args()) {
        if (largePower(argument)) return true;
    }
    return false;
}

bool shorter(const Expr &a, const Expr &b)
{
    const unsigned long ma = measureOf(a), mb = measureOf(b);
    if (ma != mb) return ma < mb;
    return toText(a).size() < toText(b).size();
}

//A power b^e of a positive exponent: e is not counted where it is 1, nor where it is 1/2 (a square root)
unsigned long powerMeasure(const Expr &base, const Expr &exponent)
{
    if (eq(*exponent, *one)) return measureOf(base);
    if (eq(*exponent, *rational(1, 2))) return 1 + measureOf(base);
    return 1 + measureOf(base) + measureOf(exponent);
}

bool negativeNumber(const Expr &e)
{
    return is_a_Number(*e) && down_cast<const Number &>(*e).is_negative();
}

Expr functionOf(const Expr &e, const vec_basic &arguments)
{
    if (is_a_sub<OneArgFunction>(*e)) return down_cast<const OneArgFunction &>(*e).create(arguments[0]);
    if (is_a_sub<TwoArgFunction>(*e)) return down_cast<const TwoArgFunction &>(*e).create(arguments[0], arguments[1]);
    if (is_a_sub<MultiArgFunction>(*e)) return down_cast<const MultiArgFunction &>(*e).create(arguments);
    if (is_a_sub<FunctionWrapper>(*e)) return down_cast<const FunctionWrapper &>(*e).create(arguments);
    return e;
}

//The parts simplified: the arguments of the functions, the exponents with variables, the bases of powers that are not
//integers (sqrt(sin(x)^2 + cos(x)^2) is 1), the values of a piecewise expression; sums and products of the addon left
//as they are (their bound variables are known by name in the fractions)
Expr partsSimplified(const Expr &e)
{
    if (is_a<Add>(*e) || is_a<Mul>(*e)) {
        const bool sum = is_a<Add>(*e);
        Expr result = sum ? Expr(zero) : Expr(one);
        for (const Expr &part : e->get_args()) result = sum ? add(result, partsSimplified(part)) : mul(result, partsSimplified(part));
        return result;
    }
    if (is_a<Pow>(*e)) {
        const Expr base = down_cast<const Pow &>(*e).get_base(), exponent = down_cast<const Pow &>(*e).get_exp();
        const Expr newExponent = free_symbols(*exponent).empty() ? exponent : simplifiedOf(exponent);
        const Expr newBase = is_a<Integer>(*exponent) ? partsSimplified(base) : simplifiedOf(base);
        return pow(newBase, newExponent);
    }
    if (is_a<Piecewise>(*e)) {
        PiecewiseVec cases;
        for (const auto &[value, condition] : down_cast<const Piecewise &>(*e).get_vec()) cases.emplace_back(simplifiedOf(value), condition);
        return piecewise(std::move(cases));
    }
    if (is_a_sub<FunctionWrapper>(*e)) {
        const std::string &name = down_cast<const FunctionWrapper &>(*e).get_name();
        if (name == "sum" || name == "product") return e;
    }
    if (is_a_sub<Function>(*e) && !is_a<Derivative>(*e) && !is_a<Subs>(*e)) {
        vec_basic arguments;
        for (const Expr &argument : e->get_args()) arguments.push_back(simplifiedOf(argument));
        return functionOf(e, arguments);
    }
    return e;
}

//The exponent of a variable in a term of a polynomial
long degreeIn(const Expr &term, const Variable &v)
{
    if (eq(*term, *v)) return 1;
    if (is_a<Pow>(*term) && eq(*down_cast<const Pow &>(*term).get_base(), *v) && is_a<Integer>(*down_cast<const Pow &>(*term).get_exp())) {
        return static_cast<long>(mp_get_si(down_cast<const Integer &>(*down_cast<const Pow &>(*term).get_exp()).as_integer_class()));
    }
    if (is_a<Mul>(*term)) {
        const auto &dict = down_cast<const Mul &>(*term).get_dict();
        const auto found = dict.find(v);
        if (found != dict.end() && is_a<Integer>(*found->second)) return static_cast<long>(mp_get_si(down_cast<const Integer &>(*found->second).as_integer_class()));
    }
    return 0;
}

vec_basic termsOf(const Expr &e)
{
    return is_a<Add>(*e) ? e->get_args() : vec_basic{e};
}

//A polynomial with v^2 replaced by r, until v has degree 1 at most in each term
Expr reduced(const Expr &p, const Variable &v, const Expr &r)
{
    Expr result = zero;
    for (const Expr &term : termsOf(expand(p))) {
        const long n = degreeIn(term, v);
        if (n < 2) {
            result = add(result, term);
            continue;
        }
        result = add(result, mul(div(term, pow(v, integer(n - n % 2))), pow(r, integer(n / 2))));
    }
    return expand(result);
}

//An argument as q m + c: q rational, m without a number in front, c a number (of an angle, a multiple of pi by 1, 2,
//3, 4 or 6, whose sine and cosine are known); otherwise the argument is m
struct Decomposed {
    rational_class q;
    Expr m;
    Expr c;
};

std::optional<Decomposed> decomposed(const Expr &a, bool angle)
{
    Expr constant = zero, rest = a;
    if (is_a<Add>(*a)) {
        const Add &sum = down_cast<const Add &>(*a);
        Expr multipleOfPi = zero;
        rest = zero;
        for (const auto &[term, coefficient] : sum.get_dict()) {
            if (angle && eq(*term, *pi) && is_a<Rational>(*coefficient)) multipleOfPi = add(multipleOfPi, coefficient);
            else if (angle && eq(*term, *pi) && is_a<Integer>(*coefficient)) multipleOfPi = add(multipleOfPi, coefficient);
            else rest = add(rest, mul(coefficient, term));
        }
        constant = angle ? mul(multipleOfPi, pi) : Expr(sum.get_coef());
        const bool known = angle ? eq(*sum.get_coef(), *zero) && (is_a<Integer>(*multipleOfPi) || (is_a<Rational>(*multipleOfPi) && [&multipleOfPi] {
            const integer_class &d = get_den(down_cast<const Rational &>(*multipleOfPi).as_rational_class());
            return d == 2 || d == 3 || d == 4 || d == 6;
        }())) : true;
        if (!known || eq(*rest, *zero)) {
            rest = a;
            constant = zero;
        }
    }
    if (free_symbols(*rest).empty()) return std::nullopt;
    rational_class q(1);
    Expr m = rest;
    if (is_a<Mul>(*rest)) {
        const RCP<const Number> &coefficient = down_cast<const Mul &>(*rest).get_coef();
        if (is_a<Integer>(*coefficient)) {
            q = rational_class(down_cast<const Integer &>(*coefficient).as_integer_class());
            m = div(rest, coefficient);
        } else if (is_a<Rational>(*coefficient)) {
            q = down_cast<const Rational &>(*coefficient).as_rational_class();
            m = div(rest, coefficient);
        }
    }
    return Decomposed{q, m, constant};
}

enum class Kind { Angle, Hyperbolic, Exponential };

std::optional<Kind> kindOf(const Expr &e)
{
    if (is_a<Sin>(*e) || is_a<Cos>(*e) || is_a<Tan>(*e) || is_a<Cot>(*e) || is_a<Sec>(*e) || is_a<Csc>(*e)) return Kind::Angle;
    if (is_a<Sinh>(*e) || is_a<Cosh>(*e) || is_a<Tanh>(*e) || is_a<Coth>(*e) || is_a<Sech>(*e) || is_a<Csch>(*e)) return Kind::Hyperbolic;
    if (is_a<Pow>(*e) && eq(*down_cast<const Pow &>(*e).get_base(), *E)) return Kind::Exponential;
    return std::nullopt;
}

//The nodes the fractions see: through sums, products and integer powers
void nodesOf(const Expr &e, std::vector<Expr> &nodes)
{
    if (is_a<Add>(*e) || is_a<Mul>(*e)) {
        for (const Expr &part : e->get_args()) nodesOf(part, nodes);
        return;
    }
    if (kindOf(e)) {
        nodes.push_back(e);
        return;
    }
    if (is_a<Pow>(*e) && is_a<Integer>(*down_cast<const Pow &>(*e).get_exp())) nodesOf(down_cast<const Pow &>(*e).get_base(), nodes);
}

//The functions of multiples of one argument: m, the kind, the generators (the sine and the cosine of the angle g m, or
//the exponential of g m), g the gcd of the multiples
struct Group {
    Kind kind;
    Expr m;
    std::vector<rational_class> multiples;
    rational_class g;
    Variable s, c;
    Expr v;
};

rational_class gcdOf(const std::vector<rational_class> &values)
{
    integer_class numerator(0), denominator(1);
    for (const rational_class &value : values) {
        integer_class n, d;
        mp_gcd(n, numerator, get_num(value));
        mp_lcm(d, denominator, get_den(value));
        numerator = n;
        denominator = d;
    }
    if (numerator < 0) numerator = -numerator;
    return rational_class(numerator, denominator);
}

//sin(k v) and cos(k v) as polynomials in s = sin(v), c = cos(v) (sinh and cosh in sinh(v), cosh(v))
std::pair<Expr, Expr> multipleAngle(long k, const Expr &s, const Expr &c, bool hyperbolic)
{
    Expr sine = zero, cosine = one;
    for (long i = 0; i < std::abs(k); i++) {
        const Expr nextSine = expand(add(mul(sine, c), mul(cosine, s)));
        const Expr nextCosine = expand(hyperbolic ? add(mul(cosine, c), mul(sine, s)) : sub(mul(cosine, c), mul(sine, s)));
        sine = nextSine;
        cosine = nextCosine;
    }
    return {k < 0 ? neg(sine) : sine, cosine};
}

//The written-back form of a fraction: the generators replaced by their functions
Expr writtenBack(const Expr &f, const std::vector<Group> &groups)
{
    map_basic_basic back;
    for (const Group &group : groups) {
        if (group.kind == Kind::Exponential) {
            back[group.s] = exp(group.v);
        } else if (group.kind == Kind::Angle) {
            back[group.s] = sin(group.v);
            back[group.c] = cos(group.v);
        } else {
            back[group.s] = sinh(group.v);
            back[group.c] = cosh(group.v);
        }
    }
    return xreplace(f, back);
}

//A polynomial with the squares and the products of the sine and the cosine of each angle written with the double
//angle (s c = sin(2v)/2, s^2 = (1 - cos(2v))/2, c^2 = (1 + cos(2v))/2; for the hyperbolic ones sinh(2v)/2, (cosh(2v) -
//1)/2, (cosh(2v) + 1)/2), where their degree in each term is 2 at most
std::optional<Expr> doubleAngles(const Expr &p, const std::vector<Group> &groups)
{
    Expr result = zero;
    for (Expr term : termsOf(expand(p))) {
        for (const Group &group : groups) {
            if (group.kind == Kind::Exponential) continue;
            const long a = degreeIn(term, group.s), b = degreeIn(term, group.c);
            if (a + b > 2) return std::nullopt;
            if (a + b < 2) continue;
            const bool hyperbolic = group.kind == Kind::Hyperbolic;
            const Expr twice = mul(integer(2), group.v);
            Expr replacement;
            if (a == 1) replacement = div(hyperbolic ? sinh(twice) : sin(twice), integer(2));
            else if (a == 2) replacement = hyperbolic ? div(sub(cosh(twice), one), integer(2)) : div(sub(one, cos(twice)), integer(2));
            else replacement = div(add(hyperbolic ? cosh(twice) : cos(twice), one), integer(2));
            term = mul(div(term, mul(pow(group.s, integer(a)), pow(group.c, integer(b)))), replacement);
        }
        result = add(result, term);
    }
    return expand(result);
}

//A reduced polynomial with pairs of terms that differ by the square of a sine or a cosine and have opposite numbers
//written as one, by sin^2 + cos^2 = 1 (cosh^2 - sinh^2 = 1): a c^(k+2) M - a c^k M is -a c^k s^2 M (cos(x)^3 - cos(x)
//is -cos(x)*sin(x)^2; for the hyperbolic ones a c^k s^2 M, and a s^(k+2) M + a s^k M is a s^k c^2 M)
Expr contracted(const Expr &p, const std::vector<Group> &groups)
{
    if (eq(*expand(p), *zero)) return zero;
    std::vector<std::pair<Expr, Expr>> terms;
    for (const Expr &term : termsOf(expand(p))) {
        const Expr number = is_a<Mul>(*term) ? Expr(down_cast<const Mul &>(*term).get_coef()) : is_a_Number(*term) ? term : Expr(one);
        terms.emplace_back(div(term, number), number);
    }
    for (const Group &group : groups) {
        if (group.kind == Kind::Exponential) continue;
        const bool hyperbolic = group.kind == Kind::Hyperbolic;
        for (const Variable &v : {group.c, group.s}) {
            const Variable &other = eq(*v, *group.c) ? group.s : group.c;
            //cos: a c^(k+2) - a c^k (hyperbolic: also); sinh: a s^(k+2) + a s^k
            const bool sum = hyperbolic && eq(*v, *group.s);
            for (bool changed = true; changed;) {
                changed = false;
                for (size_t i = 0; i < terms.size() && !changed; i++) {
                    if (degreeIn(terms[i].first, v) < 2) continue;
                    const Expr lower = div(terms[i].first, mul(v, v));
                    for (size_t j = 0; j < terms.size(); j++) {
                        if (j == i || !eq(*terms[j].first, *lower)) continue;
                        const Expr expected = sum ? terms[i].second : neg(terms[i].second);
                        if (!eq(*terms[j].second, *expected)) continue;
                        //Their sum: a v^k M (v^2 - 1) or a v^k M (v^2 + 1), the other function squared (its sign changed for
                        //the circular ones)
                        terms[i] = {mul(lower, mul(other, other)), hyperbolic ? terms[i].second : neg(terms[i].second)};
                        terms.erase(terms.begin() + static_cast<long>(j));
                        changed = true;
                        break;
                    }
                }
            }
        }
    }
    Expr result = zero;
    for (const auto &[monomial, number] : terms) result = add(result, mul(number, monomial));
    return result;
}

//A polynomial factored, its factors c^2 - 1 and s^2 - 1 written as -s^2 and -c^2 (cosh^2 - 1 and sinh^2 + 1 as sinh^2
//and cosh^2)
Expr factoredWithIdentities(const Expr &p, const std::vector<Group> &groups)
{
    if (eq(*expand(p), *zero)) return zero;
    FactoredPolynomial factored = factorPolynomial(p);
    //(c - 1)(c + 1) as c^2 - 1, as many times as both are there
    for (const Group &group : groups) {
        if (group.kind == Kind::Exponential) continue;
        for (const Variable &v : {group.s, group.c}) {
            const auto at = [&factored](const Expr &wanted) {
                return std::find_if(factored.factors.begin(), factored.factors.end(), [&wanted](const auto &f) { return eq(*expand(sub(f.first, wanted)), *zero); });
            };
            const auto below = at(sub(v, one)), above = at(add(v, one));
            if (below == factored.factors.end() || above == factored.factors.end()) continue;
            const long both = std::min(below->second, above->second);
            below->second -= both;
            above->second -= both;
            factored.factors.emplace_back(sub(mul(v, v), one), both);
        }
    }
    std::vector<std::pair<Expr, Expr>> factors;
    Expr coefficient = factored.coefficient;
    for (const auto &[factor, multiplicity] : factored.factors) {
        if (multiplicity == 0) continue;
        Expr written = factor;
        for (const Group &group : groups) {
            if (group.kind == Kind::Exponential) continue;
            const Expr s2 = mul(group.s, group.s), c2 = mul(group.c, group.c);
            if (group.kind == Kind::Angle) {
                if (eq(*expand(sub(factor, sub(c2, one))), *zero)) written = neg(s2);
                if (eq(*expand(sub(factor, sub(s2, one))), *zero)) written = neg(c2);
            } else {
                if (eq(*expand(sub(factor, sub(c2, one))), *zero)) written = s2;
                if (eq(*expand(sub(factor, add(s2, one))), *zero)) written = c2;
            }
        }
        //A factor that is a sum, its terms contracted where that is shorter (3cos(x)^2 - 3 is -3sin(x)^2)
        if (is_a<Add>(*written)) {
            //(compared written back, in the generators a function counts nothing; whatever their signs, which the
            //coefficient takes)
            const Expr shorterFactor = contracted(written, groups);
            const Expr a = writtenBack(shorterFactor, groups), b = writtenBack(written, groups);
            const auto signless = [](const Expr &e) { return std::min(measureOf(e), measureOf(neg(e))); };
            if (signless(a) < signless(b) || (signless(a) == signless(b) && toText(a).size() < toText(b).size())) written = shorterFactor;
        }
        if (is_a_Number(*written) || (is_a<Mul>(*written) && down_cast<const Mul &>(*written).get_coef()->is_negative())) {
            coefficient = mul(coefficient, pow(integer(-1), integer(multiplicity)));
            written = neg(written);
        }
        factors.emplace_back(written, integer(multiplicity));
    }
    return productOf(coefficient, factors);
}

//A reduced polynomial with its terms grouped by their factors other than the sines and the cosines, each group
//factored, and its factors cos^2 - 1 and sin^2 - 1 written as -sin^2 and -cos^2 (cosh^2 - 1 and sinh^2 + 1 as sinh^2
//and cosh^2): -3cos(x)^2 + 3cos(x)^4 is -3cos(x)^2*sin(x)^2
Expr identitiesFactored(const Expr &p, const std::vector<Group> &groups)
{
    if (eq(*expand(p), *zero)) return zero;
    std::vector<std::pair<Expr, Expr>> parts;
    for (const Expr &term : termsOf(expand(p))) {
        Expr angles = one;
        for (const Group &group : groups) {
            if (group.kind == Kind::Exponential) continue;
            angles = mul(angles, mul(pow(group.s, integer(degreeIn(term, group.s))), pow(group.c, integer(degreeIn(term, group.c)))));
        }
        //(the number in front goes with the polynomial)
        const Expr number = is_a<Mul>(*term) ? Expr(down_cast<const Mul &>(*term).get_coef()) : is_a_Number(*term) ? term : Expr(one);
        angles = mul(angles, number);
        const Expr rest = div(term, angles);
        const auto found = std::find_if(parts.begin(), parts.end(), [&rest](const auto &part) { return eq(*part.first, *rest); });
        if (found == parts.end()) parts.emplace_back(rest, angles);
        else found->second = add(found->second, angles);
    }
    std::vector<Expr> terms;
    for (const auto &[rest, angles] : parts) terms.push_back(mul(factoredWithIdentities(angles, groups), rest));
    return sumOf(terms);
}

//The quotients of the sines and the cosines of one angle as tangents (cotangents), in the products of an expression
//and of its sums: sin(x)/cos(x) is tan(x)
Expr withTangents(const Expr &e)
{
    if (is_a<Add>(*e)) {
        Expr sum = zero;
        for (const Expr &term : e->get_args()) sum = add(sum, withTangents(term));
        return sum;
    }
    if (!is_a<Mul>(*e)) return e;
    const Mul &product = down_cast<const Mul &>(*e);
    map_basic_basic dict(product.get_dict().begin(), product.get_dict().end());
    Expr extra = one;
    for (const auto &[base, exponent] : product.get_dict()) {
        if (!is_a<Integer>(*exponent)) continue;
        const bool circular = is_a<Sin>(*base), hyperbolic = is_a<Sinh>(*base);
        if (!circular && !hyperbolic) continue;
        const Expr argument = base->get_args()[0];
        const Expr partner = circular ? cos(argument) : cosh(argument);
        const auto found = dict.find(partner);
        if (found == dict.end() || !is_a<Integer>(*found->second)) continue;
        const integer_class a = down_cast<const Integer &>(*exponent).as_integer_class(), b = down_cast<const Integer &>(*found->second).as_integer_class();
        if ((a > 0) == (b > 0)) continue;
        //sin^a cos^b with a and b of opposite signs: tan^t (cot^t) for t the smaller of |a| and |b|
        const integer_class t = a > 0 ? std::min(a, integer_class(-b)) : std::min(integer_class(-a), b);
        const Expr tangent = a > 0 ? (circular ? tan(argument) : tanh(argument)) : (circular ? cot(argument) : coth(argument));
        extra = mul(extra, pow(tangent, integer(t)));
        dict[base] = integer(a > 0 ? a - t : a + t);
        dict[partner] = integer(a > 0 ? b + t : b - t);
    }
    if (eq(*extra, *one)) return e;
    Expr result = mul(product.get_coef(), extra);
    for (const auto &[base, exponent] : dict) result = mul(result, pow(base, exponent));
    return result;
}

//The forms of an expression as a fraction (see Simplify.h): the exponentials and the functions of angles written
//with generators, cancelled, reduced by sin^2 + cos^2 = 1 both ways (by cosh^2 - sinh^2 = 1), then written back, also
//with double angles and with tangents; halved, the angles are half the gcd of their multiples ((1 - cos(2x))/2 is
//sin(x)^2)
std::vector<Expr> fractionForms(const Expr &e, bool halved)
{
    std::vector<Expr> nodes;
    nodesOf(e, nodes);
    std::vector<Group> groups;
    std::vector<std::pair<Expr, std::pair<size_t, Decomposed>>> decided;
    for (const Expr &node : nodes) {
        const Kind kind = *kindOf(node);
        const Expr argument = kind == Kind::Exponential ? down_cast<const Pow &>(*node).get_exp() : node->get_args()[0];
        const std::optional<Decomposed> parts = decomposed(argument, kind == Kind::Angle);
        if (!parts) continue;
        size_t index = groups.size();
        for (size_t i = 0; i < groups.size(); i++) {
            if (groups[i].kind == kind && eq(*groups[i].m, *parts->m)) index = i;
        }
        if (index == groups.size()) groups.push_back(Group{kind, parts->m, {}, rational_class(1), Variable(), Variable(), Expr()});
        groups[index].multiples.push_back(parts->q);
        decided.emplace_back(node, std::make_pair(index, *parts));
    }
    std::vector<bool> usable(groups.size(), true);
    for (size_t i = 0; i < groups.size(); i++) {
        Group &group = groups[i];
        group.g = gcdOf(group.multiples);
        if (halved && group.kind != Kind::Exponential) {
            //Halved where the gcd is even (cos(2x) toward sin(x)), not from sin(x) toward sin(x/2): those forms are longer
            if (get_num(group.g) % 2 != 0) usable[i] = false;
            group.g /= 2;
        }
        const long largest = group.kind == Kind::Exponential ? LARGEST_POWER : LARGEST_MULTIPLE;
        for (const rational_class &q : group.multiples) {
            const rational_class k = q / group.g;
            if (get_den(k) != 1 || abs(get_num(k)) > largest) usable[i] = false;
        }
        group.v = mul(Rational::from_mpq(group.g), group.m);
        group.s = fresh(group.kind == Kind::Exponential ? "G" : "S");
        group.c = fresh("C");
    }
    if (halved && std::none_of(groups.begin(), groups.end(), [&](const Group &group) { return group.kind != Kind::Exponential && usable[static_cast<size_t>(&group - groups.data())]; })) return {};
    map_basic_basic replacements;
    for (const auto &[node, found] : decided) {
        const auto &[index, parts] = found;
        if (!usable[index]) continue;
        const Group &group = groups[index];
        const long k = static_cast<long>(mp_get_si(get_num(parts.q / group.g)));
        if (group.kind == Kind::Exponential) {
            replacements[node] = mul(exp(parts.c), pow(group.s, integer(k)));
            continue;
        }
        const bool hyperbolic = group.kind == Kind::Hyperbolic;
        auto [sine, cosine] = multipleAngle(k, group.s, group.c, hyperbolic);
        if (!eq(*parts.c, *zero)) {
            const Expr shiftedSine = add(mul(sine, cos(parts.c)), mul(cosine, sin(parts.c)));
            cosine = sub(mul(cosine, cos(parts.c)), mul(sine, sin(parts.c)));
            sine = shiftedSine;
        }
        Expr value;
        if (is_a<Sin>(*node) || is_a<Sinh>(*node)) value = sine;
        else if (is_a<Cos>(*node) || is_a<Cosh>(*node)) value = cosine;
        else if (is_a<Tan>(*node) || is_a<Tanh>(*node)) value = div(sine, cosine);
        else if (is_a<Cot>(*node) || is_a<Coth>(*node)) value = div(cosine, sine);
        else if (is_a<Sec>(*node) || is_a<Sech>(*node)) value = div(one, cosine);
        else value = div(one, sine);
        replacements[node] = value;
    }
    std::vector<Expr> forms;
    //Each form on its own: one that fails (a factorization not supported) leaves the others
    const auto attempt = [&forms](const std::function<Expr()> &form) {
        try {
            forms.push_back(form());
        } catch (const MathError &error) {
            if (error.code() == ErrorCode::Cancelled || error.code() == ErrorCode::Timeout) throw;
        } catch (SymEngineException &) {
        }
    };
    //The cancelled fraction factored ((x^2 - 1)^3/(x - 1)^3 is (x + 1)^3)
    const auto factored = [](const Expr &fraction) {
        const auto [numerator, denominator] = fractionOf(fraction);
        return factoredFraction(numerator, denominator);
    };
    if (replacements.empty()) {
        const Expr cancelled = cancelOf(e);
        forms.push_back(cancelled);
        attempt([&] { return factored(cancelled); });
        return forms;
    }
    std::vector<Group> used;
    for (size_t i = 0; i < groups.size(); i++) {
        if (usable[i]) used.push_back(groups[i]);
    }
    const Expr f = cancelOf(xreplace(e, replacements));
    std::vector<Expr> fractions{f};
    const bool angles = std::any_of(used.begin(), used.end(), [](const Group &group) { return group.kind != Kind::Exponential; });
    if (angles) {
        //Reduced both ways: s^2 = 1 - c^2 (sinh^2 = cosh^2 - 1), c^2 = 1 - s^2 (cosh^2 = 1 + sinh^2)
        for (const bool sines : {true, false}) {
            const auto [numerator, denominator] = fractionOf(f);
            Expr n = numerator, d = denominator;
            for (const Group &group : used) {
                if (group.kind == Kind::Exponential) continue;
                const bool hyperbolic = group.kind == Kind::Hyperbolic;
                const Expr s2 = mul(group.s, group.s), c2 = mul(group.c, group.c);
                if (sines) {
                    const Expr r = hyperbolic ? sub(c2, one) : sub(one, c2);
                    n = reduced(n, group.s, r);
                    d = reduced(d, group.s, r);
                } else {
                    const Expr r = hyperbolic ? add(one, s2) : sub(one, s2);
                    n = reduced(n, group.c, r);
                    d = reduced(d, group.c, r);
                }
            }
            fractions.push_back(cancelOf(div(n, d)));
        }
    }
    for (const Expr &fraction : fractions) {
        forms.push_back(writtenBack(fraction, used));
        attempt([&] {
            const auto [numerator, denominator] = fractionOf(fraction);
            return writtenBack(div(factoredWithIdentities(numerator, used), factoredWithIdentities(denominator, used)), used);
        });
        if (!angles) continue;
        //(not structured bindings: lambdas capture them only from C++20)
        const std::pair<Expr, Expr> split = fractionOf(fraction);
        const Expr &numerator = split.first, &denominator = split.second;
        attempt([&] { return writtenBack(div(identitiesFactored(numerator, used), identitiesFactored(denominator, used)), used); });
        const Expr contractedNumerator = contracted(numerator, used), contractedDenominator = contracted(denominator, used);
        forms.push_back(writtenBack(div(contractedNumerator, contractedDenominator), used));
        attempt([&] { return writtenBack(div(identitiesFactored(contractedNumerator, used), identitiesFactored(contractedDenominator, used)), used); });
        attempt([&] {
            const std::optional<Expr> n = doubleAngles(numerator, used), d = doubleAngles(denominator, used);
            if (!n || !d) return writtenBack(fraction, used);
            return writtenBack(cancelOf(div(*n, *d)), used);
        });
    }
    if (angles) {
        const size_t count = forms.size();
        for (size_t i = 0; i < count; i++) forms.push_back(withTangents(forms[i]));
    }
    return forms;
}

//The functions of sums of angles expanded (sin(x + y) is sin(x)cos(y) + cos(x)sin(y)), tangents as quotients, where the
//fractions see them
Expr anglesSeparated(const Expr &e)
{
    std::vector<Expr> nodes;
    nodesOf(e, nodes);
    map_basic_basic replacements;
    //sin and cos (sinh and cosh) of a + b, b the other terms
    std::function<std::pair<Expr, Expr>(const Expr &, bool)> parts = [&parts](const Expr &a, bool hyperbolic) -> std::pair<Expr, Expr> {
        if (!is_a<Add>(*a)) return {hyperbolic ? sinh(a) : sin(a), hyperbolic ? cosh(a) : cos(a)};
        const vec_basic terms = a->get_args();
        Expr rest = zero;
        for (size_t i = 1; i < terms.size(); i++) rest = add(rest, terms[i]);
        const auto [s1, c1] = parts(terms[0], hyperbolic);
        const auto [s2, c2] = parts(rest, hyperbolic);
        return {add(mul(s1, c2), mul(c1, s2)), hyperbolic ? add(mul(c1, c2), mul(s1, s2)) : sub(mul(c1, c2), mul(s1, s2))};
    };
    for (const Expr &node : nodes) {
        const std::optional<Kind> kind = kindOf(node);
        if (*kind == Kind::Exponential) continue;
        const Expr argument = node->get_args()[0];
        if (!is_a<Add>(*argument)) continue;
        const auto [sine, cosine] = parts(argument, *kind == Kind::Hyperbolic);
        if (is_a<Sin>(*node) || is_a<Sinh>(*node)) replacements[node] = sine;
        else if (is_a<Cos>(*node) || is_a<Cosh>(*node)) replacements[node] = cosine;
        else if (is_a<Tan>(*node) || is_a<Tanh>(*node)) replacements[node] = div(sine, cosine);
        else if (is_a<Cot>(*node) || is_a<Coth>(*node)) replacements[node] = div(cosine, sine);
        else if (is_a<Sec>(*node) || is_a<Sech>(*node)) replacements[node] = div(one, cosine);
        else replacements[node] = div(one, sine);
    }
    return replacements.empty() ? e : xreplace(e, replacements);
}

//The hyperbolic functions as exponentials (cosh(x) + sinh(x) is e^x), or the exponentials as hyperbolic functions
//(e^u = cosh(u) + sinh(u): (e^x + e^(-x))/2 is cosh(x)), where the fractions see them
Expr exponentialsExchanged(const Expr &e, bool toExponentials)
{
    std::vector<Expr> nodes;
    nodesOf(e, nodes);
    map_basic_basic replacements;
    for (const Expr &node : nodes) {
        const Kind kind = *kindOf(node);
        if (toExponentials && kind == Kind::Hyperbolic) {
            const Expr u = node->get_args()[0];
            const Expr sine = div(sub(exp(u), exp(neg(u))), integer(2)), cosine = div(add(exp(u), exp(neg(u))), integer(2));
            if (is_a<Sinh>(*node)) replacements[node] = sine;
            else if (is_a<Cosh>(*node)) replacements[node] = cosine;
            else if (is_a<Tanh>(*node)) replacements[node] = div(sine, cosine);
            else if (is_a<Coth>(*node)) replacements[node] = div(cosine, sine);
            else if (is_a<Sech>(*node)) replacements[node] = div(one, cosine);
            else replacements[node] = div(one, sine);
        } else if (!toExponentials && kind == Kind::Exponential) {
            const Expr u = down_cast<const Pow &>(*node).get_exp();
            if (!free_symbols(*u).empty()) replacements[node] = add(cosh(u), sinh(u));
        }
        //(a function of a number stays: tanh(25) as exponentials is no shorter)
        if (replacements.count(node) && free_symbols(*node).empty()) replacements.erase(node);
    }
    return replacements.empty() ? e : xreplace(e, replacements);
}

//The square roots of positive rationals in an expression (at any depth)
void rootsOf(const Expr &e, std::vector<Expr> &roots)
{
    if (is_a<Pow>(*e) && eq(*down_cast<const Pow &>(*e).get_exp(), *rational(1, 2)) && is_a_Number(*down_cast<const Pow &>(*e).get_base())
        && down_cast<const Number &>(*down_cast<const Pow &>(*e).get_base()).is_positive()) {
        if (std::none_of(roots.begin(), roots.end(), [&e](const Expr &root) { return eq(*root, *e); })) roots.push_back(e);
        return;
    }
    for (const Expr &argument : e->get_args()) rootsOf(argument, roots);
}

//A denominator of numbers with square roots made rational: multiplied by its conjugate for each root, a + b sqrt(c) by
//a - b sqrt(c) (1/(1 + sqrt(2)) is sqrt(2) - 1)
Expr rationalized(const Expr &e)
{
    auto [n, d] = fractionOf(e);
    if (!free_symbols(*d).empty()) return e;
    std::vector<Expr> roots;
    rootsOf(d, roots);
    if (roots.empty() || roots.size() > LARGEST_ROOTS) return e;
    for (const Expr &root : roots) {
        const Variable r = fresh("R");
        const Expr square = down_cast<const Pow &>(*root).get_base();
        const Expr withR = reduced(xreplace(d, {{root, r}}), r, square);
        const Expr b = expand(SymEngine::diff(withR, r, true));
        if (eq(*b, *zero) || has_symbol(*b, *r)) continue;
        const Expr a = expand(sub(withR, mul(b, r)));
        n = xreplace(reduced(mul(xreplace(n, {{root, r}}), sub(a, mul(b, r))), r, square), {{r, root}});
        d = expand(sub(mul(a, a), mul(mul(b, b), square)));
    }
    if (eq(*d, *zero)) return e;
    return free_symbols(*d).empty() && is_a_Number(*d) ? expand(div(n, d)) : div(n, d);
}

//sqrt(a + b sqrt(c)) as sqrt((a + r)/2) ± sqrt((a - r)/2), r^2 = a^2 - b^2 c a rational square not above a^2 (sqrt(3 +
//2sqrt(2)) is sqrt(2) + 1)
class Denesting : public TransformVisitor {
public:
    using TransformVisitor::bvisit;

    RCP<const Basic> apply(const RCP<const Basic> &x) override
    {
        const RCP<const Basic> rebuilt = TransformVisitor::apply(x);
        if (!is_a<Pow>(*rebuilt) || !eq(*down_cast<const Pow &>(*rebuilt).get_exp(), *rational(1, 2))) return rebuilt;
        const Expr base = down_cast<const Pow &>(*rebuilt).get_base();
        if (!is_a<Add>(*base)) return rebuilt;
        const Add &sum = down_cast<const Add &>(*base);
        if (sum.get_dict().size() != 1) return rebuilt;
        const auto &[root, b] = *sum.get_dict().begin();
        const Expr a = sum.get_coef();
        if (!is_a_Number(*a) || !(is_a<Integer>(*a) || is_a<Rational>(*a)) || !(is_a<Integer>(*b) || is_a<Rational>(*b))) return rebuilt;
        if (!is_a<Pow>(*root) || !eq(*down_cast<const Pow &>(*root).get_exp(), *rational(1, 2)) || !is_a<Integer>(*down_cast<const Pow &>(*root).get_base())) return rebuilt;
        const Expr c = down_cast<const Pow &>(*root).get_base();
        const Expr r2 = sub(mul(a, a), mul(mul(b, b), c));
        if (!is_a<Integer>(*r2) && !is_a<Rational>(*r2)) return rebuilt;
        const rational_class square = is_a<Integer>(*r2) ? rational_class(down_cast<const Integer &>(*r2).as_integer_class()) : down_cast<const Rational &>(*r2).as_rational_class();
        if (square < 0 || !mp_perfect_square_p(get_num(square)) || !mp_perfect_square_p(get_den(square))) return rebuilt;
        const integer_class rn = mp_sqrt(get_num(square)), rd = mp_sqrt(get_den(square));
        const Expr r = Rational::from_mpq(rational_class(rn, rd));
        if (compareOf(a, r) == -1) return rebuilt;
        const Expr first = sqrt(div(add(a, r), integer(2))), second = sqrt(div(sub(a, r), integer(2)));
        return down_cast<const Number &>(*b).is_negative() ? sub(first, second) : add(first, second);
    }
};

//The logarithms of positive rationals with integer coefficients in a sum combined (ln(2) + ln(3) is ln(6), 2ln(3) is
//ln(9)), into the logarithm of a number of 20 digits at most
Expr logarithmsCombined(const Expr &e)
{
    std::vector<std::pair<Expr, Expr>> terms;
    if (is_a<Add>(*e)) {
        terms.emplace_back(down_cast<const Add &>(*e).get_coef(), one);
        for (const auto &[term, coefficient] : down_cast<const Add &>(*e).get_dict()) terms.emplace_back(term, coefficient);
    } else if (is_a<Mul>(*e) && down_cast<const Mul &>(*e).get_dict().size() == 1) {
        const auto &[base, exponent] = *down_cast<const Mul &>(*e).get_dict().begin();
        if (!eq(*exponent, *one)) return e;
        terms.emplace_back(base, down_cast<const Mul &>(*e).get_coef());
    } else {
        return e;
    }
    Expr product = one, rest = zero;
    size_t count = 0;
    for (const auto &[term, coefficient] : terms) {
        if (is_a<Log>(*term) && is_a<Integer>(*coefficient)) {
            const Expr argument = down_cast<const Log &>(*term).get_arg();
            if ((is_a<Integer>(*argument) || is_a<Rational>(*argument)) && down_cast<const Number &>(*argument).is_positive()) {
                product = mul(product, pow(argument, coefficient));
                count++;
                continue;
            }
        }
        rest = add(rest, mul(coefficient, term));
    }
    if (count == 0 || (count == 1 && is_a<Add>(*e))) return e;
    //Not a number of more than 20 digits (243 ln(10) is no simpler as the logarithm of 10^243)
    const rational_class value = is_a<Integer>(*product) ? rational_class(down_cast<const Integer &>(*product).as_integer_class()) : down_cast<const Rational &>(*product).as_rational_class();
    const integer_class limit = integer_class(100000) * integer_class(100000) * integer_class(100000) * integer_class(100000);
    if (abs(get_num(value)) >= limit || get_den(value) >= limit) return e;
    return add(rest, log(product));
}

}

unsigned long measureOf(const Expr &e)
{
    if (is_a<Integer>(*e)) return down_cast<const Integer &>(*e).is_negative() ? 1 : 0;
    if (is_a<Rational>(*e)) return down_cast<const Rational &>(*e).is_negative() ? 2 : 1;
    if (is_a_Number(*e)) return 1;
    if (is_a_sub<Symbol>(*e) || is_a<Constant>(*e)) return 0;
    if (is_a<Add>(*e)) {
        //Whatever the order of the terms: a - b is one subtraction, not an addition and a sign; one sign where all the
        //terms are negative
        unsigned long total = 0, count = 0, negatives = 0;
        for (const Expr &term : e->get_args()) {
            const bool negative = negativeNumber(term) || (is_a<Mul>(*term) && down_cast<const Mul &>(*term).get_coef()->is_negative());
            total += measureOf(negative ? neg(term) : term);
            negatives += negative;
            count++;
        }
        return total + count - 1 + (negatives == count ? 1 : 0);
    }
    if (is_a<Mul>(*e)) {
        const Mul &product = down_cast<const Mul &>(*e);
        unsigned long total = 0;
        size_t numerators = 0, denominators = 0;
        RCP<const Number> coefficient = product.get_coef();
        if (coefficient->is_negative()) {
            total++;
            coefficient = coefficient->mul(*minus_one);
        }
        if (is_a<Rational>(*coefficient)) {
            numerators += get_num(down_cast<const Rational &>(*coefficient).as_rational_class()) != 1;
            denominators++;
        } else if (!coefficient->is_one()) {
            total += measureOf(coefficient);
            numerators++;
        }
        for (const auto &[base, exponent] : product.get_dict()) {
            if (negativeNumber(exponent)) {
                total += powerMeasure(base, neg(exponent));
                denominators++;
            } else {
                total += powerMeasure(base, exponent);
                numerators++;
            }
        }
        if (numerators > 1) total += numerators - 1;
        if (denominators > 0) total += denominators;
        return total;
    }
    if (is_a<Pow>(*e)) {
        const Expr base = down_cast<const Pow &>(*e).get_base(), exponent = down_cast<const Pow &>(*e).get_exp();
        if (negativeNumber(exponent)) return 1 + powerMeasure(base, neg(exponent));
        return powerMeasure(base, exponent);
    }
    unsigned long total = 1;
    for (const Expr &argument : e->get_args()) total += measureOf(argument);
    return total;
}

Expr simplifiedOf(const Expr &given)
{
    checkpoint();
    if (is_a_Number(*given) || is_a_sub<Symbol>(*given) || is_a<Constant>(*given)) return given;
    //(the parts rebuilt only where that is shorter: SymEngine moves a number into a sum again, and a result simplified
    //again would change)
    Expr best = partsSimplified(given);
    if (!shorter(best, given)) best = given;
    const auto consider = [&best](const Expr &candidate) {
        if (!internal(candidate) && shorter(candidate, best)) best = candidate;
    };
    //Each candidate on its own: one that fails leaves the others
    const auto attempt = [&consider](const std::function<Expr()> &candidate) {
        try {
            consider(candidate());
        } catch (const MathError &error) {
            if (error.code() == ErrorCode::Cancelled || error.code() == ErrorCode::Timeout) throw;
        } catch (SymEngineException &) {
        }
    };
    for (int round = 0; round < 2; round++) {
        checkpoint();
        const Expr start = best;
        const bool small = !largePower(best) && measureOf(best) <= LARGEST_MEASURE;
        attempt([&best] { return simplify(best); });
        if (small) attempt([&best] { return expand(best); });
        if (small) {
            //From the expression, its angles separated, its exponentials and hyperbolic functions exchanged
            std::vector<Expr> sources{best, anglesSeparated(best), exponentialsExchanged(best, true), exponentialsExchanged(best, false)};
            for (size_t i = 0; i < sources.size(); i++) {
                if ((i > 0 && eq(*sources[i], *best)) || largePower(sources[i])) continue;
                for (const bool halved : {false, true}) {
                    try {
                        for (const Expr &form : fractionForms(sources[i], halved)) consider(form);
                    } catch (const MathError &error) {
                        if (error.code() == ErrorCode::Cancelled || error.code() == ErrorCode::Timeout) throw;
                    } catch (SymEngineException &) {
                    }
                }
            }
        }
        attempt([&best] {
            Denesting denesting;
            return denesting.apply(best);
        });
        attempt([&best] { return rationalized(best); });
        attempt([&best] { return logarithmsCombined(best); });
        if (eq(*best, *start)) break;
    }
    return best;
}

}
