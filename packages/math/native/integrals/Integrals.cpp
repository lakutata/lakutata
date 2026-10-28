//The integrals of expressions (see Integrals.h)
#include "Integrals.h"

#include <algorithm>
#include <atomic>
#include <functional>
#include <cmath>
#include <math.h>
#include <complex>
#include <map>
#include <optional>
#include <vector>

#include <symengine/add.h>
#include <symengine/constants.h>
#include <symengine/functions.h>
#include <symengine/infinity.h>
#include <symengine/integer.h>
#include <symengine/logic.h>
#include <symengine/mul.h>
#include <symengine/nan.h>
#include <symengine/polys/basic_conversions.h>
#include <symengine/polys/uexprpoly.h>
#include <symengine/pow.h>
#include <symengine/rational.h>
#include <symengine/subs.h>
#include <symengine/symbol.h>

#include "../async/Pool.h"
#include "../core/Errors.h"
#include "../limits/Gruntz.h"
#include "../numeric/Numeric.h"
#include "../ops/Operations.h"
#include "../ops/Piecewise.h"
#include "../parser/Parser.h"
#include "../poly/Poly.h"
#include "../poly/Rational.h"
#include "../printer/Printer.h"
#include "../simplify/Simplify.h"

namespace math {

using namespace SymEngine;

namespace {

using Variable = RCP<const Symbol>;

//The nesting of the rules at most (substitutions within parts within substitutions…)
constexpr unsigned LARGEST_DEPTH = 12;
//The candidates of a substitution tried at most
constexpr size_t LARGEST_CANDIDATES = 24;

MathError notFound(const std::string &why)
{
    return MathError(ErrorCode::NotSupported, "The integral is not found: " + why);
}

//A variable of a substitution: a name no other has (the polynomials and the series know variables by their names)
Variable fresh(const std::string &name)
{
    static std::atomic<size_t> count{0};
    return symbol("@" + name + std::to_string(++count));
}

bool has(const Expr &e, const Variable &x)
{
    return has_symbol(*e, *x);
}

//A name of the parser that no variable of an expression has (u1, u2…)
Variable plainName(const Expr &e)
{
    const auto symbols = free_symbols(*e);
    for (size_t i = 1;; i++) {
        const Variable candidate = symbol("u" + std::to_string(i));
        if (!symbols.count(candidate)) return candidate;
    }
}

Expr replaced(const Expr &e, const Expr &from, const Expr &to)
{
    map_basic_basic replacement;
    replacement[from] = to;
    return xreplace(e, replacement);
}

//The coefficients of a polynomial in x whose coefficients have no x, from the constant term up, or nothing (by the
//symbol: the variables of the substitutions have names no parser takes)
std::optional<std::vector<Expr>> polynomialIn(const Expr &e, const Variable &x)
{
    try {
        const RCP<const UExprPoly> polynomial = from_basic<UExprPoly>(expand(e), x);
        std::vector<Expr> c;
        for (const auto &[power, coefficient] : polynomial->get_poly().get_dict()) {
            if (power < 0 || power > 200 || has(coefficient.get_basic(), x)) return std::nullopt;
            if (static_cast<size_t>(power) >= c.size()) c.resize(static_cast<size_t>(power) + 1, zero);
            c[static_cast<size_t>(power)] = coefficient.get_basic();
        }
        if (c.empty()) c.push_back(zero);
        return c;
    } catch (SymEngineException &) {
        return std::nullopt;
    }
}

//a x + b: (a, b), a not 0
std::optional<std::pair<Expr, Expr>> linearIn(const Expr &e, const Variable &x)
{
    if (!has(e, x)) return std::nullopt;
    const auto c = polynomialIn(e, x);
    if (!c || c->size() != 2) return std::nullopt;
    return std::make_pair((*c)[1], (*c)[0]);
}

//Whether an expression is a fraction of polynomials in x: x by sums, products and integer powers
bool rationalIn(const Expr &e, const Variable &x)
{
    if (!has(e, x) || eq(*e, *x)) return true;
    if (is_a<Add>(*e) || is_a<Mul>(*e)) {
        for (const Expr &part : e->get_args()) {
            if (!rationalIn(part, x)) return false;
        }
        return true;
    }
    if (is_a<Pow>(*e)) return is_a<Integer>(*down_cast<const Pow &>(*e).get_exp()) && rationalIn(down_cast<const Pow &>(*e).get_base(), x);
    return false;
}

//The sign of a value without variables: 1, -1, 0, or 2 where it is not decided (parameters, complex values)
int signOf(const Expr &e)
{
    if (!free_symbols(*e).empty()) return 2;
    return compareOf(e, zero);
}

bool isExp(const Expr &e)
{
    return is_a<Pow>(*e) && eq(*down_cast<const Pow &>(*e).get_base(), *E);
}

//An antiderivative checked by its derivative: equal to the integrand where both are real at several points (the
//other variables at fixed values); points where they are complex count only where they agree (a branch cut may differ)
bool verified(const Expr &F, const Expr &f, const Variable &x)
{
    const Expr derivative = SymEngine::diff(F, x, true);
    if (eq(*expand(sub(derivative, f)), *zero)) return true;
    std::vector<Expr> others;
    for (const auto &symbolFound : free_symbols(*add(F, f))) {
        if (!eq(*symbolFound, *x)) others.push_back(symbolFound);
    }
    static const long points[][2] = {{37, 100}, {61, 100}, {-29, 100}, {17, 10}, {23, 10}, {-16, 10}, {39, 10}, {-31, 10}};
    int agreeing = 0;
    for (const auto &point : points) {
        checkpoint();
        map_basic_basic values;
        values[x] = rational(point[0], point[1]);
        for (size_t j = 0; j < others.size(); j++) values[others[j]] = rational(113 + 37 * static_cast<long>(j), 100);
        std::complex<double> a, b;
        try {
            a = toComplex(subs(derivative, values));
            b = toComplex(subs(f, values));
        } catch (const MathError &error) {
            if (error.code() == ErrorCode::Cancelled || error.code() == ErrorCode::Timeout) throw;
            continue;
        } catch (SymEngineException &) {
            continue;
        }
        if (!std::isfinite(a.real()) || !std::isfinite(a.imag()) || !std::isfinite(b.real()) || !std::isfinite(b.imag())) continue;
        const bool close = std::abs(a - b) <= 1e-8 * std::max(1.0, std::abs(b));
        const bool real = std::abs(a.imag()) <= 1e-12 * std::max(1.0, std::abs(a)) && std::abs(b.imag()) <= 1e-12 * std::max(1.0, std::abs(b));
        if (real && !close) return false;
        if (close) agreeing++;
    }
    return agreeing >= 2;
}

class Integrator {
public:
    explicit Integrator(const Variable &x, unsigned depth = 0) : x_(x), depth_(depth)
    {
    }

    //An antiderivative of f in x, or nothing
    std::optional<Expr> integral(const Expr &f)
    {
        checkpoint();
        if (!has(f, x_)) return mul(f, x_);
        if (depth_ >= LARGEST_DEPTH) return std::nullopt;
        if (std::any_of(active_.begin(), active_.end(), [&f](const Expr &a) { return eq(*a, *f); })) return std::nullopt;
        const auto cached = memo_.find(f);
        if (cached != memo_.end()) return cached->second;
        depth_++;
        active_.push_back(f);
        std::optional<Expr> result;
        try {
            result = attempt(f);
        } catch (SymEngineException &) {
            result = std::nullopt;
        }
        active_.pop_back();
        depth_--;
        memo_[f] = result;
        return result;
    }

private:
    Variable x_;
    unsigned depth_;
    std::vector<Expr> active_;
    std::map<Expr, std::optional<Expr>, RCPBasicKeyLess> memo_;

    //The rules in order, each on its own: one that fails (an operation SymEngine does not do) leaves the others
    std::optional<Expr> attempt(const Expr &f)
    {
        if (eq(*f, *x_)) return div(mul(x_, x_), integer(2));
        using Rule = std::optional<Expr> (Integrator::*)(const Expr &);
        std::vector<Rule> rules;
        if (is_a<Add>(*f)) rules.push_back(&Integrator::termwise);
        if (is_a<Mul>(*f)) rules.push_back(&Integrator::constantFactor);
        if (rationalIn(f, x_)) rules.push_back(&Integrator::rational);
        for (const Rule rule : {&Integrator::table, &Integrator::substitution, &Integrator::trigonometric, &Integrator::exponentialTrigonometric, &Integrator::parts, &Integrator::rewritten}) rules.push_back(rule);
        for (const Rule rule : rules) {
            try {
                if (auto found = (this->*rule)(f)) return found;
            } catch (const MathError &error) {
                if (error.code() == ErrorCode::Cancelled || error.code() == ErrorCode::Timeout) throw;
            } catch (SymEngineException &) {
            }
        }
        return std::nullopt;
    }

    std::optional<Expr> termwise(const Expr &f)
    {
        Expr sum = zero;
        for (const Expr &term : f->get_args()) {
            const auto found = integral(term);
            if (!found) return std::nullopt;
            sum = add(sum, *found);
        }
        return sum;
    }

    //c g: c times the integral of g, c the factors without x
    std::optional<Expr> constantFactor(const Expr &f)
    {
        Expr constant = down_cast<const Mul &>(*f).get_coef(), rest = one;
        for (const auto &[base, exponent] : down_cast<const Mul &>(*f).get_dict()) {
            const Expr factor = pow(base, exponent);
            if (has(factor, x_)) rest = mul(rest, factor);
            else constant = mul(constant, factor);
        }
        if (eq(*constant, *one)) return std::nullopt;
        const auto found = integral(rest);
        if (!found) return std::nullopt;
        return mul(constant, *found);
    }

    //A fraction of polynomials: its polynomial part, then its partial fractions: c/(a x + b)^k as a power or a
    //logarithm, (B x + C)/q^k for an irreducible quadratic q by the reduction formula (a logarithm and an arctangent,
    //an inverse hyperbolic tangent where the roots of q are real); a fraction over an irreducible factor of a higher
    //degree only where its numerator is a multiple of the derivative of the factor
    std::optional<Expr> rational(const Expr &f)
    {
        const Expr cancelled = cancelOf(togetherOf(f));
        const auto [numerator, denominator] = fractionOf(cancelled);
        if (!has(denominator, x_)) {
            const auto c = polynomialIn(expand(cancelled), x_);
            if (!c) return std::nullopt;
            Expr sum = zero;
            for (size_t k = 0; k < c->size(); k++) sum = add(sum, div(mul((*c)[k], pow(x_, integer(static_cast<long>(k + 1)))), integer(static_cast<long>(k + 1))));
            return sum;
        }
        //(apart() takes a name of the parser: the variable of a substitution is named as one for it)
        Expr parts;
        try {
            const Variable plain = plainName(cancelled);
            parts = replaced(apartOf(replaced(cancelled, x_, plain), plain->get_name()), plain, x_);
        } catch (const MathError &error) {
            if (error.code() == ErrorCode::Cancelled || error.code() == ErrorCode::Timeout) throw;
            return std::nullopt;
        }
        Expr sum = zero;
        for (const Expr &term : is_a<Add>(*parts) ? parts->get_args() : vec_basic{parts}) {
            const auto found = partialFraction(term);
            if (!found) return std::nullopt;
            sum = add(sum, *found);
        }
        return sum;
    }

    std::optional<Expr> partialFraction(const Expr &term)
    {
        const auto [numerator, denominator] = fractionOf(term);
        if (!has(denominator, x_)) {
            const auto c = polynomialIn(expand(term), x_);
            if (!c) return std::nullopt;
            Expr sum = zero;
            for (size_t k = 0; k < c->size(); k++) sum = add(sum, div(mul((*c)[k], pow(x_, integer(static_cast<long>(k + 1)))), integer(static_cast<long>(k + 1))));
            return sum;
        }
        const FactoredPolynomial factored = factorPolynomial(denominator);
        Expr q;
        long k = 0;
        Expr scale = factored.coefficient;
        for (const auto &[factor, multiplicity] : factored.factors) {
            if (!has(factor, x_)) {
                scale = mul(scale, pow(factor, integer(multiplicity)));
                continue;
            }
            if (!q.is_null()) return std::nullopt;
            q = factor;
            k = multiplicity;
        }
        if (q.is_null()) return std::nullopt;
        const Expr p = div(numerator, scale);
        const auto qc = polynomialIn(q, x_);
        const auto pc = polynomialIn(p, x_);
        if (!qc || !pc) return std::nullopt;
        if (qc->size() == 2) {
            //p/(a x + b)^k, p without x
            if (pc->size() > 1) return std::nullopt;
            const Expr a = (*qc)[1];
            if (k == 1) return div(mul(p, log(q)), a);
            return div(mul(p, pow(q, integer(1 - k))), mul(integer(1 - k), a));
        }
        if (qc->size() == 3) return quadraticFraction(pc->size() > 1 ? (*pc)[1] : Expr(zero), (*pc)[0], *qc, q, k);
        //p a multiple of q'
        if (k == 1) {
            const Expr derivative = SymEngine::diff(q, x_, true);
            const Expr ratio = cancelOf(div(p, derivative));
            if (!has(ratio, x_)) return mul(ratio, log(q));
        }
        return std::nullopt;
    }

    //(B x + C)/q^k, q = a x^2 + b x + c irreducible: B/(2a) q'/q^k + (C - B b/(2a))/q^k
    std::optional<Expr> quadraticFraction(const Expr &B, const Expr &C, const std::vector<Expr> &qc, const Expr &q, long k)
    {
        const Expr a = qc[2], b = qc[1];
        Expr result = zero;
        if (!eq(*B, *zero)) {
            const Expr factor = div(B, mul(integer(2), a));
            result = add(result, mul(factor, k == 1 ? log(q) : div(pow(q, integer(1 - k)), integer(1 - k))));
        }
        const Expr rest = sub(C, div(mul(B, b), mul(integer(2), a)));
        if (eq(*rest, *zero)) return result;
        const auto j = reciprocalPower(qc, q, k);
        if (!j) return std::nullopt;
        return add(result, mul(rest, *j));
    }

    //The integral of 1/q^k: 2/sqrt(4ac - b^2) atan((2a x + b)/sqrt(4ac - b^2)) for k = 1 (for 4ac - b^2 < 0 a number,
    //-2/sqrt(b^2 - 4ac) atanh((2a x + b)/sqrt(b^2 - 4ac))); for k > 1, J_k = (2a x + b)/((k - 1)(4ac - b^2) q^(k - 1)) +
    //(2k - 3) 2a/((k - 1)(4ac - b^2)) J_(k - 1)
    std::optional<Expr> reciprocalPower(const std::vector<Expr> &qc, const Expr &q, long k)
    {
        const Expr a = qc[2], b = qc[1], c = qc[0];
        const Expr d = expand(sub(mul(integer(4), mul(a, c)), mul(b, b)));
        if (eq(*d, *zero)) return std::nullopt;
        const Expr line = add(mul(integer(2), mul(a, x_)), b);
        if (k == 1) {
            if (signOf(d) == -1) {
                const Expr r = sqrt(neg(d));
                return mul(div(integer(-2), r), atanh(div(line, r)));
            }
            const Expr r = sqrt(d);
            return mul(div(integer(2), r), atan(div(line, r)));
        }
        const auto previous = reciprocalPower(qc, q, k - 1);
        if (!previous) return std::nullopt;
        const Expr kk = integer(k);
        const Expr first = div(line, mul(mul(sub(kk, one), d), pow(q, integer(k - 1))));
        const Expr second = mul(div(mul(sub(mul(integer(2), kk), integer(3)), mul(integer(2), a)), mul(sub(kk, one), d)), *previous);
        return add(first, second);
    }

    //The table: powers and exponentials of a linear argument, the elementary functions of one, the squares of the
    //functions whose derivatives they are, the square roots of quadratics and their reciprocals, e^(quadratic) by erf
    std::optional<Expr> table(const Expr &f)
    {
        if (is_a<Pow>(*f)) {
            const Expr base = down_cast<const Pow &>(*f).get_base(), exponent = down_cast<const Pow &>(*f).get_exp();
            if (!has(exponent, x_)) {
                if (const auto line = linearIn(base, x_)) {
                    const Expr &a = line->first;
                    const Expr logarithm = div(log(base), a);
                    const Expr power = div(pow(base, add(exponent, one)), mul(add(exponent, one), a));
                    if (eq(*exponent, *minus_one)) return logarithm;
                    if (is_a_Number(*exponent)) return power;
                    //x^n of a parameter n: ln(x) where n = -1
                    return SymEngine::piecewise({{logarithm, relationOf("=", exponent, minus_one)}, {power, boolTrue}});
                }
                if (const auto found = quadraticRoot(base, exponent)) return found;
                if (const auto found = functionPower(base, exponent)) return found;
            }
            if (!has(base, x_)) {
                const auto line = linearIn(exponent, x_);
                if (line) {
                    if (eq(*base, *E)) return div(f, line->first);
                    return div(f, mul(line->first, log(base)));
                }
                if (eq(*base, *E)) return gaussian(exponent);
            }
            return std::nullopt;
        }
        if (is_a_sub<OneArgFunction>(*f)) {
            const Expr u = f->get_args()[0];
            const auto line = linearIn(u, x_);
            if (!line) return std::nullopt;
            const Expr &a = line->first;
            std::optional<Expr> F;
            if (is_a<Sin>(*f)) F = neg(cos(u));
            else if (is_a<Cos>(*f)) F = sin(u);
            else if (is_a<Tan>(*f)) F = neg(log(cos(u)));
            else if (is_a<Cot>(*f)) F = log(sin(u));
            else if (is_a<Sec>(*f)) F = log(add(sec(u), tan(u)));
            else if (is_a<Csc>(*f)) F = neg(log(add(csc(u), cot(u))));
            else if (is_a<Sinh>(*f)) F = cosh(u);
            else if (is_a<Cosh>(*f)) F = sinh(u);
            else if (is_a<Tanh>(*f)) F = log(cosh(u));
            else if (is_a<Coth>(*f)) F = log(sinh(u));
            else if (is_a<Sech>(*f)) F = mul(integer(2), atan(tanh(div(u, integer(2)))));
            else if (is_a<Csch>(*f)) F = log(tanh(div(u, integer(2))));
            else if (is_a<Log>(*f)) F = sub(mul(u, log(u)), u);
            else if (is_a<ATan>(*f)) F = sub(mul(u, atan(u)), div(log(add(mul(u, u), one)), integer(2)));
            else if (is_a<ACot>(*f)) F = add(mul(u, acot(u)), div(log(add(mul(u, u), one)), integer(2)));
            else if (is_a<ASin>(*f)) F = add(mul(u, asin(u)), sqrt(sub(one, mul(u, u))));
            else if (is_a<ACos>(*f)) F = sub(mul(u, acos(u)), sqrt(sub(one, mul(u, u))));
            else if (is_a<ASinh>(*f)) F = sub(mul(u, asinh(u)), sqrt(add(mul(u, u), one)));
            else if (is_a<ACosh>(*f)) F = sub(mul(u, acosh(u)), mul(sqrt(sub(u, one)), sqrt(add(u, one))));
            else if (is_a<ATanh>(*f)) F = add(mul(u, atanh(u)), div(log(sub(one, mul(u, u))), integer(2)));
            else if (is_a<Erf>(*f)) F = add(mul(u, erf(u)), div(exp(neg(mul(u, u))), sqrt(pi)));
            if (!F) return std::nullopt;
            return div(*F, a);
        }
        return std::nullopt;
    }

    //g(u)^n of a linear u: sec^2, csc^2, sech^2, csch^2, tan^2, cot^2, the reciprocals of cos and sin and their squares
    std::optional<Expr> functionPower(const Expr &g, const Expr &n)
    {
        if (!is_a_sub<OneArgFunction>(*g)) return std::nullopt;
        const Expr u = g->get_args()[0];
        const auto line = linearIn(u, x_);
        if (!line) return std::nullopt;
        const Expr &a = line->first;
        std::optional<Expr> F;
        if (eq(*n, *integer(2))) {
            if (is_a<Sec>(*g)) F = tan(u);
            else if (is_a<Csc>(*g)) F = neg(cot(u));
            else if (is_a<Sech>(*g)) F = tanh(u);
            else if (is_a<Csch>(*g)) F = neg(coth(u));
            else if (is_a<Tan>(*g)) F = sub(tan(u), u);
            else if (is_a<Cot>(*g)) F = sub(neg(cot(u)), u);
            else if (is_a<Sin>(*g)) F = sub(div(u, integer(2)), div(sin(mul(integer(2), u)), integer(4)));
            else if (is_a<Cos>(*g)) F = add(div(u, integer(2)), div(sin(mul(integer(2), u)), integer(4)));
            else if (is_a<Tanh>(*g)) F = sub(u, tanh(u));
            else if (is_a<Coth>(*g)) F = sub(u, coth(u));
        } else if (eq(*n, *minus_one)) {
            if (is_a<Cos>(*g)) F = log(add(sec(u), tan(u)));
            else if (is_a<Sin>(*g)) F = neg(log(add(csc(u), cot(u))));
            else if (is_a<Cosh>(*g)) F = mul(integer(2), atan(tanh(div(u, integer(2)))));
            else if (is_a<Sinh>(*g)) F = log(tanh(div(u, integer(2))));
        } else if (eq(*n, *integer(-2))) {
            if (is_a<Cos>(*g)) F = tan(u);
            else if (is_a<Sin>(*g)) F = neg(cot(u));
            else if (is_a<Cosh>(*g)) F = tanh(u);
            else if (is_a<Sinh>(*g)) F = neg(coth(u));
        }
        if (!F) return std::nullopt;
        return div(*F, a);
    }

    //(a x^2 + b x + c)^(±1/2), its coefficients numbers: with t = x + b/(2a) and k = c - b^2/(4a), a > 0: 1/sqrt(a t^2 + k)
    //is asinh(sqrt(a) t/sqrt(k))/sqrt(a) (acosh(sqrt(a) t/sqrt(-k))/sqrt(a) for k < 0), sqrt(a t^2 + k) is t sqrt(…)/2
    //+ k/(2 sqrt(a)) of the same; a < 0 and k > 0: asin(sqrt(-a) t/sqrt(k))/sqrt(-a), t sqrt(…)/2 + k/(2 sqrt(-a)) asin(…)
    std::optional<Expr> quadraticRoot(const Expr &base, const Expr &exponent)
    {
        const bool reciprocal = eq(*exponent, *SymEngine::rational(-1, 2));
        if (!reciprocal && !eq(*exponent, *SymEngine::rational(1, 2))) return std::nullopt;
        const auto c = polynomialIn(base, x_);
        if (!c || c->size() != 3) return std::nullopt;
        const Expr a = (*c)[2];
        const Expr t = add(x_, div((*c)[1], mul(integer(2), a)));
        const Expr k = expand(sub((*c)[0], div(mul((*c)[1], (*c)[1]), mul(integer(4), a))));
        const int sa = signOf(a), sk = signOf(k);
        if (sa != 1 && sa != -1) return std::nullopt;
        if (sk == 2 || sk == 0) return std::nullopt;
        Expr inverse;
        if (sa == 1) {
            inverse = sk == 1 ? asinh(div(mul(sqrt(a), t), sqrt(k))) : acosh(div(mul(sqrt(a), t), sqrt(neg(k))));
        } else {
            if (sk != 1) return std::nullopt;
            inverse = asin(div(mul(sqrt(neg(a)), t), sqrt(k)));
        }
        const Expr root = sqrt(sa == 1 ? a : neg(a));
        if (reciprocal) return div(inverse, root);
        return add(div(mul(t, sqrt(base)), integer(2)), div(mul(k, inverse), mul(integer(2), root)));
    }

    //e^(a x^2 + b x + c), a < 0 a number: e^(c - b^2/(4a)) sqrt(pi)/(2 sqrt(-a)) erf(sqrt(-a)(x + b/(2a)))
    std::optional<Expr> gaussian(const Expr &exponent)
    {
        const auto c = polynomialIn(exponent, x_);
        if (!c || c->size() != 3 || signOf((*c)[2]) != -1) return std::nullopt;
        const Expr a = (*c)[2], b = (*c)[1];
        const Expr root = sqrt(neg(a));
        const Expr shift = expand(sub((*c)[0], div(mul(b, b), mul(integer(4), a))));
        return mul(div(mul(exp(shift), sqrt(pi)), mul(integer(2), root)), erf(mul(root, add(x_, div(b, mul(integer(2), a))))));
    }

    //The parts an expression may be a function of: the arguments of its functions, the bases and the exponents of its
    //powers, the expression of each (a sum, a power), not x nor linear in x
    void candidatesOf(const Expr &e, std::vector<Expr> &found)
    {
        if (!has(e, x_) || eq(*e, *x_)) return;
        const auto add = [&found, this](const Expr &candidate) {
            if (!has(candidate, x_) || eq(*candidate, *x_) || linearIn(candidate, x_)) return;
            if (std::none_of(found.begin(), found.end(), [&candidate](const Expr &c) { return eq(*c, *candidate); })) found.push_back(candidate);
        };
        if (is_a<Pow>(*e)) {
            const Expr base = down_cast<const Pow &>(*e).get_base(), exponent = down_cast<const Pow &>(*e).get_exp();
            add(base);
            if (has(exponent, x_)) {
                add(exponent);
                add(e);
            }
            candidatesOf(base, found);
            candidatesOf(exponent, found);
            return;
        }
        if (is_a_sub<Function>(*e)) {
            add(e);
            for (const Expr &argument : e->get_args()) {
                add(argument);
                candidatesOf(argument, found);
            }
            return;
        }
        for (const Expr &part : e->get_args()) candidatesOf(part, found);
    }

    //u-substitution: f/u' a function of u alone, its integral in u written with u
    std::optional<Expr> substitution(const Expr &f)
    {
        std::vector<Expr> candidates;
        candidatesOf(f, candidates);
        if (candidates.size() > LARGEST_CANDIDATES) candidates.resize(LARGEST_CANDIDATES);
        for (const Expr &u : candidates) {
            checkpoint();
            const Expr derivative = SymEngine::diff(u, x_, true);
            if (eq(*derivative, *zero)) continue;
            Expr g = div(f, derivative);
            const Variable U = fresh("u");
            Expr inU = replaced(g, u, U);
            if (has(inU, x_)) {
                //Cancelled first (x/(x^2 + 1)^3 over 2x)
                try {
                    g = cancelOf(g);
                } catch (const MathError &error) {
                    if (error.code() == ErrorCode::Cancelled || error.code() == ErrorCode::Timeout) throw;
                    continue;
                }
                inU = replaced(g, u, U);
                if (has(inU, x_)) continue;
            }
            Integrator inner(U, depth_ + 1);
            const auto found = inner.integral(inU);
            if (found) return replaced(*found, U, u);
        }
        return std::nullopt;
    }

    //The factors of a product, each to its power
    std::vector<Expr> factorsOf(const Expr &f)
    {
        std::vector<Expr> factors;
        if (is_a<Mul>(*f)) {
            const Mul &product = down_cast<const Mul &>(*f);
            if (!eq(*product.get_coef(), *one)) factors.push_back(product.get_coef());
            for (const auto &[base, exponent] : product.get_dict()) factors.push_back(pow(base, exponent));
        } else {
            factors.push_back(f);
        }
        return factors;
    }

    //sin and cos of linear arguments: (argument, power of sin, power of cos) of one argument
    struct SineCosine {
        Expr argument;
        long sine = 0, cosine = 0;
    };

    //The products of sines and cosines: of one angle, sin^m cos^n with an odd power by the substitution of the other
    //function, even powers by the double angle; tan^n by tan^2 = sec^2 - 1; of two angles by the sums of angles
    std::optional<Expr> trigonometric(const Expr &f)
    {
        Expr constant = one;
        std::vector<std::pair<Expr, long>> functions;
        for (const Expr &factor : factorsOf(f)) {
            if (!has(factor, x_)) {
                constant = mul(constant, factor);
                continue;
            }
            Expr base = factor;
            long power = 1;
            if (is_a<Pow>(*factor) && is_a<Integer>(*down_cast<const Pow &>(*factor).get_exp())) {
                base = down_cast<const Pow &>(*factor).get_base();
                power = mp_get_si(down_cast<const Integer &>(*down_cast<const Pow &>(*factor).get_exp()).as_integer_class());
            }
            if (!(is_a<Sin>(*base) || is_a<Cos>(*base) || is_a<Tan>(*base) || is_a<Sec>(*base) || is_a<Csc>(*base) || is_a<Cot>(*base))) return std::nullopt;
            if (!linearIn(base->get_args()[0], x_)) return std::nullopt;
            functions.emplace_back(base, power);
        }
        if (functions.empty()) return std::nullopt;
        //tan^n, n >= 3: tan^(n - 2) sec^2 - tan^(n - 2)
        if (functions.size() == 1 && is_a<Tan>(*functions[0].first) && functions[0].second >= 3) {
            const Expr t = functions[0].first, u = t->get_args()[0];
            const auto first = integral(mul(pow(t, integer(functions[0].second - 2)), pow(sec(u), integer(2))));
            const auto second = integral(pow(t, integer(functions[0].second - 2)));
            if (!first || !second) return std::nullopt;
            return mul(constant, sub(*first, *second));
        }
        //In sines and cosines, by argument
        std::vector<SineCosine> angles;
        for (const auto &[function, power] : functions) {
            const Expr u = function->get_args()[0];
            long s = 0, c = 0;
            if (is_a<Sin>(*function)) s = power;
            else if (is_a<Cos>(*function)) c = power;
            else if (is_a<Tan>(*function)) s = power, c = -power;
            else if (is_a<Cot>(*function)) s = -power, c = power;
            else if (is_a<Sec>(*function)) c = -power;
            else s = -power;
            auto found = std::find_if(angles.begin(), angles.end(), [&u](const SineCosine &a) { return eq(*a.argument, *u); });
            if (found == angles.end()) {
                angles.push_back({u, s, c});
            } else {
                found->sine += s;
                found->cosine += c;
            }
        }
        if (angles.size() == 2 && std::all_of(angles.begin(), angles.end(), [](const SineCosine &a) { return a.sine + a.cosine == 1 && a.sine >= 0 && a.cosine >= 0; })) {
            //sin A cos B = (sin(A + B) + sin(A - B))/2, sin A sin B = (cos(A - B) - cos(A + B))/2, cos A cos B = (cos(A - B) +
            //cos(A + B))/2
            const Expr A = angles[0].argument, B = angles[1].argument;
            Expr sum;
            if (angles[0].sine == 1 && angles[1].cosine == 1) sum = div(add(sin(add(A, B)), sin(sub(A, B))), integer(2));
            else if (angles[0].cosine == 1 && angles[1].sine == 1) sum = div(add(sin(add(A, B)), sin(sub(B, A))), integer(2));
            else if (angles[0].sine == 1) sum = div(sub(cos(sub(A, B)), cos(add(A, B))), integer(2));
            else sum = div(add(cos(sub(A, B)), cos(add(A, B))), integer(2));
            const auto found = integral(expand(sum));
            if (!found) return std::nullopt;
            return mul(constant, *found);
        }
        if (angles.size() != 1) return std::nullopt;
        const Expr u = angles[0].argument;
        const long m = angles[0].sine, n = angles[0].cosine;
        const Expr a = linearIn(u, x_)->first;
        const Variable U = fresh("u");
        Expr inU;
        if (m > 0 && m % 2 == 1) {
            //sin^m cos^n = sin (1 - cos^2)^((m - 1)/2) cos^n: -1/a of the integral in U = cos
            inU = neg(div(mul(pow(sub(one, mul(U, U)), integer((m - 1) / 2)), pow(U, integer(n))), a));
            Integrator inner(U, depth_ + 1);
            const auto found = inner.integral(expand(inU));
            if (found) return mul(constant, replaced(*found, U, cos(u)));
        }
        if (n > 0 && n % 2 == 1) {
            inU = div(mul(pow(U, integer(m)), pow(sub(one, mul(U, U)), integer((n - 1) / 2))), a);
            Integrator inner(U, depth_ + 1);
            const auto found = inner.integral(expand(inU));
            if (found) return mul(constant, replaced(*found, U, sin(u)));
        }
        if (n < 0 && (-n - m) % 2 == 0 && -n - m >= 2 && m >= 0) {
            //tan^m sec^(2j): (1/a) the integral of U^m (1 + U^2)^(j - 1) in U = tan
            const long j = (-n - m) / 2;
            inU = div(mul(pow(U, integer(m)), pow(add(one, mul(U, U)), integer(j - 1))), a);
            Integrator inner(U, depth_ + 1);
            const auto found = inner.integral(expand(inU));
            if (found) return mul(constant, replaced(*found, U, tan(u)));
        }
        if (m >= 0 && n >= 0 && m % 2 == 0 && n % 2 == 0 && m + n >= 2) {
            //sin^2 = (1 - cos(2u))/2, cos^2 = (1 + cos(2u))/2
            const Expr twice = cos(mul(integer(2), u));
            const Expr reduced = expand(mul(pow(div(sub(one, twice), integer(2)), integer(m / 2)), pow(div(add(one, twice), integer(2)), integer(n / 2))));
            const auto found = integral(reduced);
            if (found) return mul(constant, *found);
        }
        return std::nullopt;
    }

    //e^(a x + b) sin(c x + d) and with cos: e^(…)(a sin(…) - c cos(…))/(a^2 + c^2), e^(…)(a cos(…) + c sin(…))/(a^2 + c^2)
    std::optional<Expr> exponentialTrigonometric(const Expr &f)
    {
        Expr constant = one, exponential, trigonometric;
        for (const Expr &factor : factorsOf(f)) {
            if (!has(factor, x_)) constant = mul(constant, factor);
            else if (isExp(factor) && exponential.is_null()) exponential = factor;
            else if ((is_a<Sin>(*factor) || is_a<Cos>(*factor)) && trigonometric.is_null()) trigonometric = factor;
            else return std::nullopt;
        }
        if (exponential.is_null() || trigonometric.is_null()) return std::nullopt;
        const auto e = linearIn(down_cast<const Pow &>(*exponential).get_exp(), x_);
        const auto t = linearIn(trigonometric->get_args()[0], x_);
        if (!e || !t) return std::nullopt;
        const Expr a = e->first, c = t->first, u = trigonometric->get_args()[0];
        const Expr norm = add(mul(a, a), mul(c, c));
        const Expr inside = is_a<Sin>(*trigonometric) ? sub(mul(a, sin(u)), mul(c, cos(u))) : add(mul(a, cos(u)), mul(c, sin(u)));
        return mul(constant, div(mul(exponential, inside), norm));
    }

    //The order of the factors taken as u in parts (LIATE): logarithms, inverse functions, algebraic, trigonometric,
    //exponential; a larger number first
    int priority(const Expr &factor)
    {
        Expr base = factor;
        if (is_a<Pow>(*factor) && is_a<Integer>(*down_cast<const Pow &>(*factor).get_exp()) && down_cast<const Integer &>(*down_cast<const Pow &>(*factor).get_exp()).is_positive()) base = down_cast<const Pow &>(*factor).get_base();
        if (is_a<Log>(*base)) return 5;
        if (is_a<ATan>(*base) || is_a<ASin>(*base) || is_a<ACos>(*base) || is_a<ACot>(*base) || is_a<ASinh>(*base) || is_a<ACosh>(*base) || is_a<ATanh>(*base) || is_a<Erf>(*base)) return 4;
        if (polynomialIn(factor, x_)) return 3;
        if (is_a<Sin>(*base) || is_a<Cos>(*base) || is_a<Sinh>(*base) || is_a<Cosh>(*base)) return 2;
        if (isExp(base)) return 1;
        return 0;
    }

    //Integration by parts: u the factor first in LIATE, dv the rest: u v - the integral of v u'
    std::optional<Expr> parts(const Expr &f)
    {
        std::vector<Expr> factors;
        Expr constant = one;
        for (const Expr &factor : factorsOf(f)) {
            if (has(factor, x_)) factors.push_back(factor);
            else constant = mul(constant, factor);
        }
        //A function alone (ln(x)^2, atan(x)^2…): u it, dv dx
        if (factors.size() == 1) {
            if (priority(factors[0]) < 4) return std::nullopt;
            factors.push_back(one);
        }
        if (factors.size() != 2) return std::nullopt;
        const int p0 = priority(factors[0]), p1 = priority(factors[1]);
        if (p0 == 0 && p1 == 0) return std::nullopt;
        const Expr u = p0 >= p1 ? factors[0] : factors[1], dv = p0 >= p1 ? factors[1] : factors[0];
        const auto v = integral(dv);
        if (!v) return std::nullopt;
        const auto rest = integral(expand(mul(*v, SymEngine::diff(u, x_, true))));
        if (!rest) return std::nullopt;
        return mul(constant, sub(mul(u, *v), *rest));
    }

    //Other forms: expanded; tan, cot, sec, csc as sines and cosines; the hyperbolic functions as exponentials; a
    //function of e^(x/q) alone, the substitution u = e^(x/q) (dx = q du/u)
    std::optional<Expr> rewritten(const Expr &f)
    {
        const Expr expanded = expand(f);
        if (!eq(*expanded, *f)) {
            if (const auto found = integral(expanded)) return found;
        }
        if (const auto found = exponentialSubstitution(f)) return found;
        if (const auto found = hyperbolicAsExponentials(f)) return found;
        if (const auto found = halfAngleTangent(f)) return found;
        return std::nullopt;
    }

    //sinh, cosh, tanh… of linear arguments as exponentials (cosh(x)^2 is (e^(2x) + 2 + e^(-2x))/4)
    std::optional<Expr> hyperbolicAsExponentials(const Expr &f)
    {
        map_basic_basic replacements;
        std::function<void(const Expr &)> collect = [&](const Expr &e) {
            if (is_a<Sinh>(*e) || is_a<Cosh>(*e) || is_a<Tanh>(*e) || is_a<Coth>(*e) || is_a<Sech>(*e) || is_a<Csch>(*e)) {
                const Expr u = e->get_args()[0];
                const Expr p = exp(u), m = exp(neg(u));
                const Expr s = div(sub(p, m), integer(2)), c = div(add(p, m), integer(2));
                if (is_a<Sinh>(*e)) replacements[e] = s;
                else if (is_a<Cosh>(*e)) replacements[e] = c;
                else if (is_a<Tanh>(*e)) replacements[e] = div(s, c);
                else if (is_a<Coth>(*e)) replacements[e] = div(c, s);
                else if (is_a<Sech>(*e)) replacements[e] = div(one, c);
                else replacements[e] = div(one, s);
                return;
            }
            for (const Expr &argument : e->get_args()) collect(argument);
        };
        collect(f);
        if (replacements.empty()) return std::nullopt;
        return integral(expand(xreplace(f, replacements)));
    }

    //A fraction of polynomials in sin(u) and cos(u) of one linear u: t = tan(u/2), sin = 2t/(1 + t^2), cos = (1 - t^2)/(1 +
    //t^2), dx = 2/(a(1 + t^2)) dt (Weierstrass; the definite integrals split at the poles of tan(u/2))
    std::optional<Expr> halfAngleTangent(const Expr &f)
    {
        Expr angle;
        bool usable = true;
        std::function<void(const Expr &)> collect = [&](const Expr &e) {
            if (!usable || !has(e, x_)) return;
            if (is_a<Sin>(*e) || is_a<Cos>(*e) || is_a<Tan>(*e) || is_a<Cot>(*e) || is_a<Sec>(*e) || is_a<Csc>(*e)) {
                const Expr u = e->get_args()[0];
                if (!linearIn(u, x_) || (!angle.is_null() && !eq(*angle, *u))) usable = false;
                angle = u;
                return;
            }
            if (is_a<Add>(*e) || is_a<Mul>(*e)) {
                for (const Expr &part : e->get_args()) collect(part);
                return;
            }
            if (is_a<Pow>(*e) && is_a<Integer>(*down_cast<const Pow &>(*e).get_exp())) {
                collect(down_cast<const Pow &>(*e).get_base());
                return;
            }
            usable = false;
        };
        collect(f);
        if (!usable || angle.is_null()) return std::nullopt;
        const Variable T = fresh("t");
        const Expr square = add(one, mul(T, T));
        const Expr s = div(mul(integer(2), T), square), c = div(sub(one, mul(T, T)), square);
        map_basic_basic replacements;
        replacements[sin(angle)] = s;
        replacements[cos(angle)] = c;
        replacements[tan(angle)] = div(s, c);
        replacements[cot(angle)] = div(c, s);
        replacements[sec(angle)] = div(one, c);
        replacements[csc(angle)] = div(one, s);
        const Expr a = linearIn(angle, x_)->first;
        const Expr inT = cancelOf(togetherOf(div(mul(xreplace(f, replacements), integer(2)), mul(a, square))));
        if (has(inT, x_) || !rationalIn(inT, T)) return std::nullopt;
        Integrator inner(T, depth_ + 1);
        const auto found = inner.integral(inT);
        if (!found) return std::nullopt;
        return replaced(*found, T, tan(div(angle, integer(2))));
    }

    std::optional<Expr> exponentialSubstitution(const Expr &f)
    {
        //The exponentials of the integrand: their exponents k x/q
        std::vector<Expr> exponents;
        std::function<bool(const Expr &)> collect = [&](const Expr &e) -> bool {
            if (!has(e, x_)) return true;
            if (eq(*e, *x_)) return false;
            if (isExp(e)) {
                const auto line = linearIn(down_cast<const Pow &>(*e).get_exp(), x_);
                if (!line || !(is_a<Integer>(*line->first) || is_a<Rational>(*line->first))) return false;
                exponents.push_back(down_cast<const Pow &>(*e).get_exp());
                return true;
            }
            if (is_a<Add>(*e) || is_a<Mul>(*e)) {
                for (const Expr &part : e->get_args()) {
                    if (!collect(part)) return false;
                }
                return true;
            }
            if (is_a<Pow>(*e) && is_a<Integer>(*down_cast<const Pow &>(*e).get_exp())) return collect(down_cast<const Pow &>(*e).get_base());
            return false;
        };
        if (!collect(f) || exponents.empty()) return std::nullopt;
        //The gcd of the coefficients of x: e^(g x) the new variable
        integer_class numerator(0), denominator(1);
        for (const Expr &exponent : exponents) {
            const Expr k = linearIn(exponent, x_)->first;
            const rational_class value = is_a<Integer>(*k) ? rational_class(down_cast<const Integer &>(*k).as_integer_class()) : down_cast<const Rational &>(*k).as_rational_class();
            integer_class n, d;
            mp_gcd(n, numerator, get_num(value));
            mp_lcm(d, denominator, get_den(value));
            numerator = n;
            denominator = d;
        }
        if (numerator < 0) numerator = -numerator;
        const Expr g = Rational::from_mpq(rational_class(numerator, denominator));
        const Variable U = fresh("u");
        //e^(k x + b) = e^b U^(k/g)
        map_basic_basic replacements;
        std::function<Expr(const Expr &)> written = [&](const Expr &e) -> Expr {
            if (!has(e, x_)) return e;
            if (isExp(e)) {
                const auto line = linearIn(down_cast<const Pow &>(*e).get_exp(), x_);
                return mul(exp(line->second), pow(U, div(line->first, g)));
            }
            if (is_a<Add>(*e)) {
                Expr sum = zero;
                for (const Expr &part : e->get_args()) sum = add(sum, written(part));
                return sum;
            }
            if (is_a<Mul>(*e)) {
                Expr product = one;
                for (const Expr &part : e->get_args()) product = mul(product, written(part));
                return product;
            }
            return pow(written(down_cast<const Pow &>(*e).get_base()), down_cast<const Pow &>(*e).get_exp());
        };
        const Expr inU = div(written(f), mul(g, U));
        if (has(inU, x_) || !rationalIn(inU, U)) return std::nullopt;
        Integrator inner(U, depth_ + 1);
        const auto found = inner.integral(inU);
        if (!found) return std::nullopt;
        return replaced(*found, U, exp(mul(g, x_)));
    }
};

//The jumps of an antiderivative inside (low, high), numbers: the poles of tan, cot, sec and csc of linear arguments in it
//(tan(x/2) of the substitution of the half angle), exactly
void jumpsOf(const Expr &F, const Variable &x, double low, double high, std::vector<Expr> &points)
{
    if (is_a<Tan>(*F) || is_a<Cot>(*F) || is_a<Sec>(*F) || is_a<Csc>(*F)) {
        const Expr v = F->get_args()[0];
        const auto line = linearIn(v, x);
        if (line && free_symbols(*line->first).empty() && free_symbols(*line->second).empty()) {
            //v = a x + b at the poles: pi/2 + k pi (tan, sec), k pi (cot, csc)
            const Expr offset = is_a<Tan>(*F) || is_a<Sec>(*F) ? div(pi, integer(2)) : Expr(zero);
            const double a = toDouble(line->first), b = toDouble(line->second), o = toDouble(offset);
            const double first = (std::min(a * low, a * high) + b - o) / M_PI, last = (std::max(a * low, a * high) + b - o) / M_PI;
            if (std::isfinite(first) && std::isfinite(last) && last - first < 1000) {
                for (long k = static_cast<long>(std::floor(first)); k <= static_cast<long>(std::ceil(last)); k++) {
                    const Expr point = div(sub(add(offset, mul(integer(k), pi)), line->second), line->first);
                    const double value = toDouble(point);
                    if (value > low && value < high && std::none_of(points.begin(), points.end(), [&point](const Expr &p) { return eq(*p, *point); })) points.push_back(point);
                }
            }
        }
    }
    for (const Expr &argument : F->get_args()) jumpsOf(argument, x, low, high, points);
}

}

Expr antiderivativeOf(const Expr &given, const std::string &name)
{
    if (!isName(name) || isBuiltin(name)) throw MathError(ErrorCode::Argument, name + " is not a variable");
    const Variable x = symbol(name);
    const Expr f = evaluatedOf(given);
    Integrator integrator(x);
    const std::optional<Expr> found = integrator.integral(f);
    if (!found) throw notFound("no rule of the package gives an antiderivative of " + toText(given) + " (numeric.integrate() computes definite integrals)");
    //Tidied where that is shorter, and checked
    Expr result = *found;
    try {
        const Expr tidy = simplifiedOf(result);
        if (verified(tidy, f, x)) return tidy;
    } catch (const MathError &error) {
        if (error.code() == ErrorCode::Cancelled || error.code() == ErrorCode::Timeout) throw;
    }
    if (!verified(result, f, x)) throw notFound("the antiderivative found for " + toText(given) + " is not checked by its derivative");
    return result;
}

Expr definiteIntegralOf(const Expr &given, const std::string &name, const Expr &from, const Expr &to)
{
    if (!isName(name) || isBuiltin(name)) throw MathError(ErrorCode::Argument, name + " is not a variable");
    const Variable x = symbol(name);
    if (has(from, x) || has(to, x)) throw MathError(ErrorCode::Argument, "The ends of an integral are not of its variable");
    for (const Expr &end : {from, to}) {
        if (is_a<NaN>(*end) || (is_a<Infty>(*end) && down_cast<const Infty &>(*end).is_unsigned_infinity())) throw MathError(ErrorCode::Argument, "The ends of an integral are numbers, inf or -inf");
    }
    if (eq(*from, *to)) return zero;
    const int order = compareOf(from, to);
    if (order == 1) return neg(definiteIntegralOf(given, name, to, from));
    const Expr f = evaluatedOf(given);
    const Expr F = antiderivativeOf(f, name);
    //Split at the poles of the integrand inside and at the jumps of the antiderivative (numbers ends only)
    std::vector<Expr> ends{from};
    const bool numbers = free_symbols(*from).empty() && free_symbols(*to).empty() && free_symbols(*f).size() <= 1;
    double low = 0, high = 0;
    if (numbers) {
        low = is_a<Infty>(*from) ? -INFINITY : toDouble(from);
        high = is_a<Infty>(*to) ? INFINITY : toDouble(to);
        std::vector<Expr> inside;
        for (const double pole : realPolesOf(f, name, std::isfinite(low) ? low : -1e300, std::isfinite(high) ? high : 1e300)) inside.push_back(numberFromDouble(pole));
        if (std::isfinite(low) && std::isfinite(high)) jumpsOf(F, x, low, high, inside);
        std::sort(inside.begin(), inside.end(), [](const Expr &a, const Expr &b) { return toDouble(a) < toDouble(b); });
        ends.insert(ends.end(), inside.begin(), inside.end());
    }
    ends.push_back(to);
    Expr total = zero;
    for (size_t i = 0; i + 1 < ends.size(); i++) {
        const Expr upper = limitOf(F, x, ends[i + 1], "-"), lower = limitOf(F, x, ends[i], "+");
        //(the pieces on both sides of a pole added: inf where both grow toward inf, no value where they go to infinities
        //of opposite signs, as 1/x on [-1, 1])
        total = add(total, sub(upper, lower));
    }
    //An infinity beside a finite part keeps the infinity (the i pi of ln(x) at negative ends: -inf - i pi for 1/x on
    //[-1, 0]); no value for nan or complexInfinity
    if (is_a<Add>(*total)) {
        const vec_basic parts = total->get_args();
        for (const Expr &part : parts) {
            if (is_a<Infty>(*part)) total = part;
        }
        for (const Expr &part : parts) {
            if (is_a<NaN>(*part)) total = part;
        }
    }
    if (is_a<NaN>(*total) || (is_a<Infty>(*total) && down_cast<const Infty &>(*total).is_unsigned_infinity())) {
        throw MathError(ErrorCode::Domain, "The integral of " + toText(given) + " from " + toText(from) + " to " + toText(to) + " has no value");
    }
    //A number checked by the numeric integral where that converges (a jump of the antiderivative not found)
    if (numbers && !is_a<Infty>(*total) && free_symbols(*total).empty()) {
        try {
            const IntegralResult numeric = integralOf(f, name, low, high, {}, 1e-10);
            const std::complex<double> exact = toComplex(total);
            if (numeric.converged && std::abs(exact.imag()) <= 1e-9 * std::max(1.0, std::abs(exact.real()))
                && std::abs(numeric.value - exact.real()) > 1e-6 * std::max(1.0, std::abs(numeric.value)) + 10 * numeric.error) {
                throw notFound("the antiderivative of " + toText(given) + " gives " + toText(total) + ", not the numeric value " + std::to_string(numeric.value) + " (a jump not found)");
            }
        } catch (const MathError &error) {
            if (error.code() != ErrorCode::Domain && error.code() != ErrorCode::Argument) throw;
        }
    }
    return is_a<Infty>(*total) ? total : simplifiedOf(total);
}

}
