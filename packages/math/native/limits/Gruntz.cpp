//The limits by Gruntz's algorithm (see Gruntz.h)
#include "Gruntz.h"

#include <algorithm>
#include <atomic>
#include <cmath>
#include <complex>
#include <functional>
#include <map>
#include <optional>
#include <utility>
#include <vector>

#include <symengine/add.h>
#include <symengine/constants.h>
#include <symengine/functions.h>
#include <symengine/infinity.h>
#include <symengine/integer.h>
#include <symengine/logic.h>
#include <symengine/mul.h>
#include <symengine/nan.h>
#include <symengine/pow.h>
#include <symengine/rational.h>
#include <symengine/subs.h>
#include <symengine/symbol.h>
#include <symengine/visitor.h>

#include "../async/Pool.h"
#include "../core/Errors.h"
#include "../functions/Functions.h"
#include "../functions/Summation.h"
#include "../ops/Operations.h"
#include "../parser/Parser.h"
#include "../poly/Rational.h"
#include "../printer/Printer.h"

namespace math {

using namespace SymEngine;

namespace {

using Variable = RCP<const Symbol>;

//The deepest recursion of the limits at inf: past it, the limit is not found
constexpr unsigned LIMIT_DEPTH = 60;

MathError notFound(const std::string &why)
{
    return MathError(ErrorCode::NotSupported, "The limit is not found: " + why);
}

//A variable of the algorithm: a name no other has (no name of the parser has @; SymEngine's series and the polynomials
//know variables by their names)
Variable fresh(const std::string &name)
{
    static std::atomic<size_t> count{0};
    return symbol("@" + name + std::to_string(++count));
}

//Whether an expression has a variable of the algorithm in it (it is not shown in a message)
bool internal(const Expr &e)
{
    for (const auto &atom : free_symbols(*e)) {
        if (down_cast<const Symbol &>(*atom).get_name().rfind('@', 0) == 0) return true;
    }
    return false;
}

MathError signUnknown(const Expr &e)
{
    return notFound(internal(e) ? "it depends on a sign that is not decided" : "it depends on the sign of " + toText(e));
}

//The name of a function, for a message
std::string nameOf(const Expr &e)
{
    const std::string text = toText(e);
    return text.substr(0, text.find('('));
}

bool has(const Expr &e, const Variable &x)
{
    return has_symbol(*e, *x);
}

bool isExp(const Expr &e)
{
    return is_a<Pow>(*e) && eq(*down_cast<const Pow &>(*e).get_base(), *E);
}

Expr argumentOf(const Expr &e)
{
    return down_cast<const Pow &>(*e).get_exp();
}

Expr replaced(const Expr &e, const Expr &from, const Expr &to)
{
    map_basic_basic replacement;
    replacement[from] = to;
    return xreplace(e, replacement);
}

Expr substituted(const Expr &e, const Expr &from, const Expr &to)
{
    map_basic_basic replacement;
    replacement[from] = to;
    return subs(e, replacement);
}

bool isInfinite(const Expr &e)
{
    if (is_a<Infty>(*e)) return true;
    if (is_a<Mul>(*e)) {
        for (const auto &[base, exponent] : down_cast<const Mul &>(*e).get_dict()) {
            if (is_a<Infty>(*base)) return true;
        }
        return is_a<Infty>(*down_cast<const Mul &>(*e).get_coef());
    }
    return false;
}

//Whether a value is positive where the variables are: x and w positive, the exponentials of real values
bool positive(const Expr &e, const std::vector<Variable> &positives)
{
    if (is_a_Number(*e)) return down_cast<const Number &>(*e).is_positive();
    if (is_a_sub<Symbol>(*e)) return std::any_of(positives.begin(), positives.end(), [&e](const Variable &v) { return eq(*v, *e); });
    if (is_a<Constant>(*e)) return compareOf(e, zero) == 1;
    if (isExp(e)) return true;
    if (is_a<Pow>(*e)) return positive(down_cast<const Pow &>(*e).get_base(), positives);
    if (is_a<Mul>(*e)) {
        if (!down_cast<const Mul &>(*e).get_coef()->is_positive()) return false;
        for (const auto &[base, exponent] : down_cast<const Mul &>(*e).get_dict()) {
            if (!positive(base, positives)) return false;
        }
        return true;
    }
    if (is_a<Add>(*e)) {
        for (const Expr &term : e->get_args()) {
            if (!positive(term, positives)) return false;
        }
        return true;
    }
    return false;
}

Expr logOf(const Expr &a, const std::vector<Variable> &positives);

//A power with the rules of positive values: (a^p)^q is a^(p q), (a b)^p is a^p b^p, e^(u + c log a) is a^c e^u
Expr powerOf(const Expr &base, const Expr &exponent, const std::vector<Variable> &positives)
{
    if (isExp(base)) return powerOf(E, expand(mul(argumentOf(base), exponent)), positives);
    if (eq(*base, *E)) {
        if (is_a<Log>(*exponent)) return down_cast<const Log &>(*exponent).get_arg();
        if (is_a<Add>(*exponent) || is_a<Mul>(*exponent)) {
            Expr rest = zero, factor = one;
            const vec_basic terms = is_a<Add>(*exponent) ? exponent->get_args() : vec_basic{exponent};
            for (const Expr &term : terms) {
                //c log(a)
                Expr c = one, inside;
                if (is_a<Log>(*term)) {
                    inside = down_cast<const Log &>(*term).get_arg();
                } else if (is_a<Mul>(*term)) {
                    const Mul &product = down_cast<const Mul &>(*term);
                    if (product.get_dict().size() == 1 && is_a<Log>(*product.get_dict().begin()->first) && eq(*product.get_dict().begin()->second, *one)) {
                        c = product.get_coef();
                        inside = down_cast<const Log &>(*product.get_dict().begin()->first).get_arg();
                    }
                }
                if (!inside.is_null() && positive(inside, positives)) {
                    factor = mul(factor, powerOf(inside, c, positives));
                } else {
                    rest = add(rest, term);
                }
            }
            if (!eq(*factor, *one)) return mul(factor, pow(E, rest));
        }
        return pow(E, exponent);
    }
    if (is_a<Pow>(*base) && positive(down_cast<const Pow &>(*base).get_base(), positives)) {
        return powerOf(down_cast<const Pow &>(*base).get_base(), mul(down_cast<const Pow &>(*base).get_exp(), exponent), positives);
    }
    if (is_a<Mul>(*base) && !is_a<Integer>(*exponent) && positive(base, positives)) {
        Expr product = pow(down_cast<const Mul &>(*base).get_coef(), exponent);
        for (const auto &[b, e] : down_cast<const Mul &>(*base).get_dict()) product = mul(product, powerOf(b, mul(e, exponent), positives));
        return product;
    }
    return pow(base, exponent);
}

//A logarithm with the rules of positive values: log(e^u) is u, log(a b) is log a + log b, log(a^p) is p log a
Expr logOf(const Expr &a, const std::vector<Variable> &positives)
{
    if (isExp(a)) return argumentOf(a);
    if (eq(*a, *E)) return one;
    if (is_a<Pow>(*a) && positive(down_cast<const Pow &>(*a).get_base(), positives)) {
        return mul(down_cast<const Pow &>(*a).get_exp(), logOf(down_cast<const Pow &>(*a).get_base(), positives));
    }
    if (is_a<Mul>(*a)) {
        const Mul &product = down_cast<const Mul &>(*a);
        Expr sum = zero, rest = one;
        if (product.get_coef()->is_positive()) {
            if (!product.get_coef()->is_one()) sum = add(sum, log(product.get_coef()));
        } else {
            rest = product.get_coef();
        }
        for (const auto &[base, exponent] : product.get_dict()) {
            const Expr factor = pow(base, exponent);
            if (positive(factor, positives)) sum = add(sum, logOf(factor, positives));
            else rest = mul(rest, factor);
        }
        if (!eq(*rest, *one)) sum = add(sum, log(rest));
        return sum;
    }
    return log(a);
}

//The expression with the rules of positive values applied where they change it (as SymPy's powdenest and expand_log
//with positive variables)
class PositiveForm : public TransformVisitor {
public:
    explicit PositiveForm(const std::vector<Variable> &positives) : positives_(positives)
    {
    }

    using TransformVisitor::bvisit;

    //(SymEngine's visitors dispatch on their own class: the rules applied after the arguments are rebuilt)
    RCP<const Basic> apply(const RCP<const Basic> &x) override
    {
        const RCP<const Basic> rebuilt = TransformVisitor::apply(x);
        if (is_a<Pow>(*rebuilt)) return powerOf(down_cast<const Pow &>(*rebuilt).get_base(), down_cast<const Pow &>(*rebuilt).get_exp(), positives_);
        if (is_a<Log>(*rebuilt)) return logOf(down_cast<const Log &>(*rebuilt).get_arg(), positives_);
        return rebuilt;
    }

private:
    const std::vector<Variable> &positives_;
};

Expr positiveForm(const Expr &e, const std::vector<Variable> &positives)
{
    checkpoint();
    PositiveForm visitor(positives);
    return visitor.apply(e);
}

//A function of other arguments
Expr rebuilt(const Expr &e, const vec_basic &arguments)
{
    if (is_a_sub<OneArgFunction>(*e)) return down_cast<const OneArgFunction &>(*e).create(arguments[0]);
    if (is_a_sub<TwoArgFunction>(*e)) return down_cast<const TwoArgFunction &>(*e).create(arguments[0], arguments[1]);
    if (is_a_sub<MultiArgFunction>(*e)) return down_cast<const MultiArgFunction &>(*e).create(arguments);
    if (is_a_sub<FunctionWrapper>(*e)) return down_cast<const FunctionWrapper &>(*e).create(arguments);
    throw notFound("of the function " + nameOf(e));
}

//The most rapidly varying subexpressions: expression to variable, the rewritings of the variables (SymPy's SubsSet)
struct SubsSet {
    std::vector<std::pair<Expr, Variable>> items;
    map_basic_basic rewrites;

    Variable at(const Expr &e)
    {
        for (const auto &[expression, variable] : items) {
            if (eq(*expression, *e)) return variable;
        }
        items.emplace_back(e, fresh("m"));
        return items.back().second;
    }

    bool contains(const Expr &e) const
    {
        return std::any_of(items.begin(), items.end(), [&e](const auto &item) { return eq(*item.first, *e); });
    }

    bool meets(const SubsSet &other) const
    {
        return std::any_of(items.begin(), items.end(), [&other](const auto &item) { return other.contains(item.first); });
    }

    //The variables replaced by their expressions
    Expr expressed(Expr e) const
    {
        for (const auto &[expression, variable] : items) e = replaced(e, variable, expression);
        return e;
    }

    std::pair<SubsSet, Expr> unite(const SubsSet &other, Expr expressions) const
    {
        SubsSet result = *this;
        map_basic_basic renamed;
        for (const auto &[expression, variable] : other.items) {
            if (contains(expression)) {
                const Variable mine = result.at(expression);
                expressions = replaced(expressions, variable, mine);
                renamed[variable] = mine;
            } else {
                result.items.emplace_back(expression, variable);
            }
        }
        for (const auto &[variable, rewrite] : other.rewrites) result.rewrites[variable] = xreplace(rewrite, renamed);
        return {result, expressions};
    }
};

//Whether an expression has nan, an infinity or complexInfinity in it
bool undefinedIn(const Expr &e)
{
    if (is_a<NaN>(*e) || is_a<Infty>(*e)) return true;
    for (const Expr &argument : e->get_args()) {
        if (undefinedIn(argument)) return true;
    }
    return false;
}

//A limit, or an oscillation without one: bounded or not
struct Found {
    Expr value;
    bool bounded = true;
};

class Gruntz {
public:
    explicit Gruntz(const Variable &x) : x_(x), positives_{x}
    {
    }

    //The limit of e for x going to inf (limitinf)
    Expr limitInf(const Expr &given)
    {
        const Found found = limitFound(given);
        if (found.value.is_null()) throw notFound("of an oscillating part");
        return found.value;
    }

    //The limit of e for x going to inf, or its oscillation: by the algorithm, or by the laws of limits where it fails
    //(of functions it takes no series of, of sin and cos of arguments going to infinity)
    Found limitFound(const Expr &given)
    {
        if (++depth_ > LIMIT_DEPTH) {
            depth_--;
            throw notFound("its computation is nested too deep");
        }
        struct Leave {
            unsigned &depth;
            ~Leave() { depth--; }
        } leave{depth_};
        checkpoint();
        if (!has(given, x_)) return {given};
        std::optional<MathError> failure;
        try {
            return {gruntzLimit(given)};
        } catch (const MathError &error) {
            if (error.code() != ErrorCode::NotSupported) throw;
            failure = error;
        } catch (SymEngineException &error) {
            failure = notFound(error.what());
        }
        try {
            return lawsLimit(tractable(positiveForm(given, positives_), false));
        } catch (const MathError &error) {
            if (error.code() != ErrorCode::NotSupported) throw;
        } catch (SymEngineException &) {
        }
        throw *failure;
    }

private:
    Variable x_;
    std::vector<Variable> positives_;
    unsigned depth_ = 0;

    Expr gruntzLimit(const Expr &given)
    {
        const Expr e = tractable(positiveForm(given, positives_));
        if (!has(e, x_)) return e;
        auto [c0, e0] = mrvLeadterm(e);
        const int signOfExponent = sign(e0);
        if (signOfExponent == 1) return zero;
        if (signOfExponent == -1) {
            const int s = sign(c0);
            if (s == 0) throw notFound("its leading term is 0");
            return s > 0 ? Expr(Inf) : Expr(NegInf);
        }
        if (eq(*c0, *e)) c0 = cancelOf(c0);
        return limitInf(c0);
    }

    //The limits of the parts combined: a sum of limits, a product, a power, a function of the limit of its argument
    Found lawsLimit(const Expr &e)
    {
        checkpoint();
        if (!has(e, x_)) return {e};
        if (eq(*e, *x_)) return {Inf};
        if (is_a<Add>(*e) || is_a<Mul>(*e)) {
            const bool sum = is_a<Add>(*e);
            std::vector<Expr> values;
            std::vector<bool> oscillations;
            for (const Expr &part : e->get_args()) {
                const Found found = limitFound(part);
                if (found.value.is_null()) oscillations.push_back(found.bounded);
                else values.push_back(found.value);
            }
            const Expr value = sum ? sumOfLimits(values) : productOfLimits(values);
            if (oscillations.empty()) return {value};
            const bool bounded = std::all_of(oscillations.begin(), oscillations.end(), [](bool b) { return b; });
            const int infinity = infinitySign(value);
            //A bounded oscillation and an infinity, a bounded oscillation times 0
            if (sum && infinity != 0 && bounded) return {value};
            if (!sum && bounded && eq(*value, *zero)) return {zero};
            //One oscillation and a limit (sin(u) + c, sin(u) c with c not 0): no limit
            if (oscillations.size() == 1) {
                if (sum && infinity == 0) return {Expr(), bounded};
                if (!sum && (infinity != 0 || compareOf(value, zero) == 1 || compareOf(value, zero) == -1)) return {Expr(), bounded && infinity == 0};
            }
            throw notFound("of oscillating parts");
        }
        if (is_a<Pow>(*e)) {
            const Expr base = down_cast<const Pow &>(*e).get_base(), exponent = down_cast<const Pow &>(*e).get_exp();
            if (has(exponent, x_)) {
                if (eq(*base, *E)) {
                    const Found found = limitFound(exponent);
                    if (found.value.is_null()) {
                        if (found.bounded) return {Expr(), true};
                        throw notFound("of an oscillating exponent");
                    }
                    const int infinity = infinitySign(found.value);
                    if (infinity != 0) return {infinity > 0 ? Expr(Inf) : Expr(zero)};
                    return {defined(exp(found.value))};
                }
                return lawsLimit(tractable(powerOf(E, mul(exponent, logOf(base, positives_)), positives_), false));
            }
            const Found found = limitFound(base);
            if (found.value.is_null()) {
                if (is_a<Integer>(*exponent) && down_cast<const Integer &>(*exponent).is_positive() && found.bounded) return {Expr(), true};
                throw notFound("of a power of an oscillating base");
            }
            const Expr &v = found.value;
            const int infinity = infinitySign(v);
            const int exponentSign = compareOf(exponent, zero);
            if (exponentSign != 1 && exponentSign != -1) throw signUnknown(exponent);
            if (infinity > 0) return {exponentSign > 0 ? Expr(Inf) : Expr(zero)};
            if (infinity < 0) {
                if (exponentSign < 0) return {zero};
                if (!is_a<Integer>(*exponent)) throw notFound("of a power of a negative infinity");
                return {down_cast<const Integer &>(*exponent).as_integer_class() % 2 == 0 ? Expr(Inf) : Expr(NegInf)};
            }
            if (eq(*v, *zero) && exponentSign < 0) {
                const int s = sign(base);
                if (s > 0) return {Inf};
                if (s < 0 && is_a<Integer>(*exponent)) return {down_cast<const Integer &>(*exponent).as_integer_class() % 2 == 0 ? Expr(Inf) : Expr(NegInf)};
                throw notFound("of a power of a base going to 0");
            }
            return {defined(pow(v, exponent))};
        }
        if (is_a<Log>(*e)) {
            const Found found = limitFound(down_cast<const Log &>(*e).get_arg());
            if (found.value.is_null()) throw notFound("of the logarithm of an oscillation");
            const int infinity = infinitySign(found.value);
            if (infinity > 0) return {Inf};
            if (eq(*found.value, *zero) && sign(down_cast<const Log &>(*e).get_arg()) > 0) return {NegInf};
            if (infinity < 0 || eq(*found.value, *zero)) throw notFound("of the logarithm of a value going to 0 or -inf");
            return {defined(log(found.value))};
        }
        if (is_a_sub<OneArgFunction>(*e)) {
            const Found found = limitFound(e->get_args()[0]);
            if (found.value.is_null()) throw notFound("of a function of an oscillation");
            const int infinity = infinitySign(found.value);
            if (infinity == 0) return {defined(down_cast<const OneArgFunction &>(*e).create(found.value))};
            //The functions at inf and -inf
            if (is_a<Sin>(*e) || is_a<Cos>(*e)) return {Expr(), true};
            if (is_a<ATan>(*e)) return {infinity > 0 ? div(pi, integer(2)) : neg(div(pi, integer(2)))};
            if (is_a<ACot>(*e)) return {zero};
            if (is_a<Erf>(*e)) return {integer(infinity)};
            if (is_a<Erfc>(*e)) return {infinity > 0 ? zero : integer(2)};
            if ((is_a<Gamma>(*e) || is_a<LogGamma>(*e) || is_a<LambertW>(*e)) && infinity > 0) return {Inf};
            if (is_a<Floor>(*e) || is_a<Ceiling>(*e) || is_a<Truncate>(*e)) return {found.value};
            throw notFound("the limit of " + nameOf(e) + " at infinity is not known");
        }
        //zeta(s) for s going to inf
        if (is_a<Zeta>(*e) && !has(e->get_args()[1], x_) && eq(*e->get_args()[1], *one)) {
            const Found found = limitFound(e->get_args()[0]);
            if (!found.value.is_null() && infinitySign(found.value) > 0) return {one};
            if (!found.value.is_null() && infinitySign(found.value) == 0) return {defined(zeta(found.value, one))};
        }
        throw notFound(is_a_sub<Function>(*e) ? "the limit of " + nameOf(e) + " is not known" : "the limit of a part is not known");
    }

    //A value that is not undefined
    static Expr defined(const Expr &value)
    {
        if (undefinedIn(value)) throw notFound("of an undefined value");
        return value;
    }

    //1 for inf, -1 for -inf, 0 for a finite value
    static int infinitySign(const Expr &value)
    {
        if (!is_a<Infty>(*value)) {
            if (undefinedIn(value)) throw notFound("of an undefined value");
            return 0;
        }
        const Infty &infinity = down_cast<const Infty &>(*value);
        if (infinity.is_positive_infinity()) return 1;
        if (infinity.is_negative_infinity()) return -1;
        throw notFound("of complex infinity");
    }

    //The sum of limits: inf - inf is not decided
    static Expr sumOfLimits(const std::vector<Expr> &values)
    {
        Expr sum = zero;
        int infinity = 0;
        for (const Expr &value : values) {
            const int s = infinitySign(value);
            if (s == 0) sum = add(sum, value);
            else if (infinity == -s) throw notFound("of inf - inf");
            else infinity = s;
        }
        if (infinity != 0) return infinity > 0 ? Expr(Inf) : Expr(NegInf);
        return sum;
    }

    //The product of limits: 0 inf is not decided, an infinity times a value of a known sign
    static Expr productOfLimits(const std::vector<Expr> &values)
    {
        Expr product = one;
        int infinity = 0;
        for (const Expr &value : values) {
            const int s = infinitySign(value);
            if (s == 0) product = mul(product, value);
            else infinity = infinity == 0 ? s : infinity * s;
        }
        if (infinity == 0) return product;
        const int s = compareOf(product, zero);
        if (s == 0) throw notFound("of 0 inf");
        if (s != 1 && s != -1) throw signUnknown(product);
        return infinity * s > 0 ? Expr(Inf) : Expr(NegInf);
    }

    //Whether a condition of x holds for x large enough
    bool eventually(const RCP<const Boolean> &condition)
    {
        if (is_a<BooleanAtom>(*condition)) return down_cast<const BooleanAtom &>(*condition).get_val();
        if (is_a<And>(*condition) || is_a<Or>(*condition)) {
            const bool all = is_a<And>(*condition);
            const set_boolean &parts = all ? down_cast<const And &>(*condition).get_container() : down_cast<const Or &>(*condition).get_container();
            for (const auto &part : parts) {
                if (eventually(part) != all) return !all;
            }
            return all;
        }
        if (is_a<Not>(*condition)) return !eventually(down_cast<const Not &>(*condition).get_arg());
        if (is_a_Relational(*condition)) {
            const Relational &relation = down_cast<const Relational &>(*condition);
            const int s = sign(tractable(sub(relation.get_arg1(), relation.get_arg2())));
            if (is_a<Equality>(*condition)) return s == 0;
            if (is_a<Unequality>(*condition)) return s != 0;
            if (is_a<LessThan>(*condition)) return s <= 0;
            if (is_a<StrictLessThan>(*condition)) return s < 0;
        }
        throw notFound(internal(condition) ? "a condition is not decided" : "the condition " + toText(condition) + " is not decided");
    }

    //The functions written as those the algorithm takes, for x large enough: abs(u), sign(u), max and min by signs, floor(u)
    //of u going to a value by its side, piecewise by the conditions that hold, the hyperbolic functions and their inverses
    //by exp and log, sinc(u) as sin(u)/u, root(u, n) as a power (with laws: of the limits of the parts, those that are
    //not eventually constant left as they are)
    Expr tractable(const Expr &e, bool strict = true)
    {
        if (!has(e, x_)) return e;
        if (is_a<Abs>(*e)) {
            const Expr u = tractable(down_cast<const Abs &>(*e).get_arg(), strict);
            return sign(u) >= 0 ? u : neg(u);
        }
        if (is_a<Sign>(*e)) return integer(sign(tractable(down_cast<const Sign &>(*e).get_arg(), strict)));
        if (is_a<Max>(*e) || is_a<Min>(*e)) {
            const bool largest = is_a<Max>(*e);
            Expr chosen;
            for (const Expr &argument : e->get_args()) {
                const Expr u = tractable(argument, strict);
                if (chosen.is_null() || sign(sub(u, chosen)) == (largest ? 1 : -1)) chosen = u;
            }
            return chosen;
        }
        if (is_a<Piecewise>(*e)) {
            for (const auto &[value, condition] : down_cast<const Piecewise &>(*e).get_vec()) {
                if (eventually(condition)) return tractable(value, strict);
            }
            return Nan;
        }
        if (is_a<Floor>(*e) || is_a<Ceiling>(*e) || is_a<Truncate>(*e)) {
            const Expr u = tractable(e->get_args()[0], strict);
            const Expr v = limitInf(u);
            if (infinitySign(v) != 0) {
                if (strict) throw notFound("of " + nameOf(e) + " going to infinity");
                return down_cast<const OneArgFunction &>(*e).create(u);
            }
            //Constant for x large enough: of a value that is not an integer, of an integer from one side
            const Expr atValue = down_cast<const OneArgFunction &>(*e).create(v);
            if (!is_a<Integer>(*v)) {
                if (!is_a_Number(*atValue)) throw notFound("of " + nameOf(e) + " near a value that is not decided");
                return atValue;
            }
            const int side = sign(sub(u, v));
            if (side == 0) return v;
            if (is_a<Floor>(*e)) return side > 0 ? v : sub(v, one);
            if (is_a<Ceiling>(*e)) return side > 0 ? add(v, one) : v;
            if (eq(*v, *zero)) return zero;
            return v;
        }
        if (is_a<Sinh>(*e) || is_a<Cosh>(*e) || is_a<Tanh>(*e) || is_a<Coth>(*e) || is_a<Sech>(*e) || is_a<Csch>(*e)) {
            const Expr u = tractable(e->get_args()[0], strict);
            const Expr a = exp(u), b = exp(neg(u));
            if (is_a<Sinh>(*e)) return div(sub(a, b), integer(2));
            if (is_a<Cosh>(*e)) return div(add(a, b), integer(2));
            if (is_a<Tanh>(*e)) return div(sub(a, b), add(a, b));
            if (is_a<Coth>(*e)) return div(add(a, b), sub(a, b));
            if (is_a<Sech>(*e)) return div(integer(2), add(a, b));
            return div(integer(2), sub(a, b));
        }
        if (is_a<ASinh>(*e) || is_a<ACosh>(*e) || is_a<ATanh>(*e) || is_a<ACoth>(*e) || is_a<ASech>(*e) || is_a<ACsch>(*e)) {
            Expr u = tractable(e->get_args()[0], strict);
            if (is_a<ACoth>(*e) || is_a<ASech>(*e) || is_a<ACsch>(*e)) u = div(one, u);
            if (is_a<ASinh>(*e) || is_a<ACsch>(*e)) return log(add(u, sqrt(add(mul(u, u), one))));
            if (is_a<ACosh>(*e) || is_a<ASech>(*e)) return log(add(u, sqrt(sub(mul(u, u), one))));
            return div(sub(log(add(one, u)), log(sub(one, u))), integer(2));
        }
        if (is_a_sub<FunctionWrapper>(*e)) {
            const FunctionWrapper &function = down_cast<const FunctionWrapper &>(*e);
            const vec_basic arguments = function.get_args();
            if (function.get_name() == "sinc") {
                const Expr u = tractable(arguments[0], strict);
                return div(sin(u), u);
            }
            if (function.get_name() == "root") {
                const Expr u = tractable(arguments[0], strict), n = arguments[1];
                if (sign(u) >= 0) return pow(u, div(one, n));
                return neg(pow(neg(u), div(one, n)));
            }
            throw notFound(nameOf(e) + " is not taken by the algorithm");
        }
        if (is_a<Derivative>(*e) || is_a<Subs>(*e)) throw notFound("an unevaluated derivative is not taken by the algorithm");
        if (is_a<Add>(*e)) {
            Expr sum = zero;
            for (const Expr &term : e->get_args()) sum = add(sum, tractable(term, strict));
            return sum;
        }
        if (is_a<Mul>(*e)) {
            Expr product = one;
            for (const Expr &factor : e->get_args()) product = mul(product, tractable(factor, strict));
            return product;
        }
        if (is_a<Pow>(*e)) return powerOf(tractable(down_cast<const Pow &>(*e).get_base(), strict), tractable(down_cast<const Pow &>(*e).get_exp(), strict), positives_);
        if (is_a_sub<Function>(*e)) {
            vec_basic arguments;
            for (const Expr &argument : e->get_args()) arguments.push_back(tractable(argument, strict));
            return rebuilt(e, arguments);
        }
        return e;
    }

    //"<", "=" or ">": the growth of a compared with that of b, by the limit of log(a)/log(b) (compare)
    char compare(const Expr &a, const Expr &b)
    {
        const Expr la = isExp(a) ? argumentOf(a) : logOf(a, positives_);
        const Expr lb = isExp(b) ? argumentOf(b) : logOf(b, positives_);
        const Expr c = limitInf(div(la, lb));
        if (is_a_Number(*c) && down_cast<const Number &>(*c).is_zero()) return '<';
        if (isInfinite(c)) return '>';
        return '=';
    }

    //The sign of e for x large enough (sign)
    int sign(const Expr &e)
    {
        checkpoint();
        if (!has(e, x_)) {
            const int found = compareOf(e, zero);
            if (found == 2) throw signUnknown(e);
            return found;
        }
        if (eq(*e, *x_)) return 1;
        if (is_a<Mul>(*e)) {
            int s = sign(down_cast<const Mul &>(*e).get_coef());
            for (const auto &[base, exponent] : down_cast<const Mul &>(*e).get_dict()) {
                if (s == 0) return 0;
                s *= sign(pow(base, exponent));
            }
            return s;
        }
        if (isExp(e)) return 1;
        if (is_a<Pow>(*e)) {
            const int s = sign(down_cast<const Pow &>(*e).get_base());
            if (s == 1) return 1;
            const Expr exponent = down_cast<const Pow &>(*e).get_exp();
            if (is_a<Integer>(*exponent)) return down_cast<const Integer &>(*exponent).as_integer_class() % 2 == 0 ? (s == 0 ? 0 : 1) : s;
        }
        if (is_a<Log>(*e)) return sign(sub(down_cast<const Log &>(*e).get_arg(), one));
        const auto [c0, e0] = mrvLeadterm(e);
        return sign(c0);
    }

    //The faster of two sets, or both (mrv_max3, mrv_max1)
    std::pair<SubsSet, Expr> mrvMax3(const SubsSet &f, const Expr &expsf, const SubsSet &g, const Expr &expsg, const SubsSet &both, const Expr &expsboth)
    {
        if (f.items.empty()) return {g, expsg};
        if (g.items.empty()) return {f, expsf};
        if (f.meets(g)) return {both, expsboth};
        const char c = compare(f.items.front().first, g.items.front().first);
        if (c == '>') return {f, expsf};
        if (c == '<') return {g, expsg};
        return {both, expsboth};
    }

    std::pair<SubsSet, Expr> mrvMax1(const SubsSet &f, const SubsSet &g, const Expr &exps)
    {
        const auto [both, expsboth] = f.unite(g, exps);
        return mrvMax3(f, g.expressed(exps), g, f.expressed(exps), both, expsboth);
    }

    //The most rapidly varying subexpressions of e, and e written with their variables (mrv)
    std::pair<SubsSet, Expr> mrv(const Expr &e)
    {
        checkpoint();
        if (!has(e, x_)) return {SubsSet(), e};
        if (eq(*e, *x_)) {
            SubsSet s;
            const Variable v = s.at(x_);
            return {s, v};
        }
        if (is_a<Add>(*e) || is_a<Mul>(*e)) {
            const bool sum = is_a<Add>(*e);
            Expr independent = sum ? Expr(zero) : Expr(one);
            std::vector<Expr> dependent;
            for (const Expr &term : e->get_args()) {
                if (has(term, x_)) dependent.push_back(term);
                else independent = sum ? add(independent, term) : mul(independent, term);
            }
            const auto join = [sum](const Expr &a, const Expr &b) { return sum ? add(a, b) : mul(a, b); };
            if (dependent.size() == 1) {
                const auto [s, expression] = mrv(dependent[0]);
                return {s, join(independent, expression)};
            }
            Expr rest = sum ? Expr(zero) : Expr(one);
            for (size_t i = 1; i < dependent.size(); i++) rest = join(rest, dependent[i]);
            const auto [s1, e1] = mrv(dependent[0]);
            const auto [s2, e2] = mrv(rest);
            return mrvMax1(s1, s2, join(independent, join(e1, e2)));
        }
        if (is_a<Pow>(*e) && !isExp(e)) {
            Expr base = e, exponent = one;
            while (is_a<Pow>(*base) && !isExp(base)) {
                exponent = mul(exponent, down_cast<const Pow &>(*base).get_exp());
                base = down_cast<const Pow &>(*base).get_base();
            }
            if (eq(*base, *one)) return {SubsSet(), one};
            if (has(exponent, x_)) return mrv(powerOf(E, mul(exponent, logOf(base, positives_)), positives_));
            const auto [s, expression] = mrv(base);
            return {s, pow(expression, exponent)};
        }
        if (is_a<Log>(*e)) {
            const auto [s, expression] = mrv(down_cast<const Log &>(*e).get_arg());
            return {s, log(expression)};
        }
        if (isExp(e)) {
            const Expr argument = argumentOf(e);
            if (is_a<Log>(*argument)) return mrv(down_cast<const Log &>(*argument).get_arg());
            if (isInfinite(limitInf(argument))) {
                SubsSet s1;
                const Variable e1 = s1.at(e);
                const auto [s2, e2] = mrv(argument);
                SubsSet both = s1.unite(s2, zero).first;
                both.rewrites[e1] = pow(E, e2);
                return mrvMax3(s1, e1, s2, pow(E, e2), both, e1);
            }
            const auto [s, expression] = mrv(argument);
            return {s, pow(E, expression)};
        }
        if (is_a_sub<Function>(*e)) {
            const vec_basic arguments = e->get_args();
            std::vector<std::pair<SubsSet, Expr>> found;
            for (const Expr &argument : arguments) found.push_back(mrv(argument));
            const SubsSet *set = nullptr;
            for (const auto &[s, expression] : found) {
                if (s.items.empty()) continue;
                if (set) throw notFound("of " + nameOf(e) + " with the variable in several arguments");
                set = &s;
            }
            vec_basic rewritten;
            for (const auto &[s, expression] : found) rewritten.push_back(expression);
            return {set ? *set : SubsSet(), rebuilt(e, rewritten)};
        }
        throw notFound("the growth of " + nameOf(e) + " is not known");
    }

    //The set moved up one level: x as exp(x) (moveup)
    void moveUp(SubsSet &s, Expr &exps)
    {
        const Expr up = pow(E, x_);
        for (auto &[expression, variable] : s.items) expression = positiveForm(replaced(expression, x_, up), positives_);
        for (auto &[variable, rewrite] : s.rewrites) rewrite = positiveForm(replaced(rewrite, x_, up), positives_);
        exps = positiveForm(replaced(exps, x_, up), positives_);
    }

    //(c0, e0): the leading term c0 w^e0 of e, w going to 0 (mrv_leadterm)
    std::pair<Expr, Expr> mrvLeadterm(const Expr &e)
    {
        if (!has(e, x_)) return {e, zero};
        auto [omega, exps] = mrv(e);
        if (omega.items.empty()) return {exps, zero};
        if (omega.contains(x_)) moveUp(omega, exps);
        const Variable w = fresh("w");
        const auto [f, logw] = rewrite(exps, omega, w);
        const Variable L = fresh("L");
        const auto [c0, e0] = leadterm(f, w, L);
        return {substituted(c0, L, logw), e0};
    }

    //e written with w: each subexpression exp(a) of the set as exp(a - c b) w^c, exp(b) the simplest one, w = exp(-b) or
    //1/w as b goes to inf (rewrite); log(w) as an expression of x
    std::pair<Expr, Expr> rewrite(const Expr &e, const SubsSet &omega, const Variable &w)
    {
        for (const auto &[expression, variable] : omega.items) {
            if (!isExp(expression)) throw notFound("its most rapidly varying parts are not exponentials");
        }
        //By the heights of the rewritings: an expression before those it is written with
        std::map<const Basic *, long> heights;
        std::function<long(const Variable &)> height = [&](const Variable &variable) -> long {
            long total = 1;
            const auto rewrite = omega.rewrites.find(variable);
            if (rewrite != omega.rewrites.end()) {
                for (const auto &[expression, other] : omega.items) {
                    if (!eq(*other, *variable) && has(rewrite->second, other)) total += height(other);
                }
            }
            return total;
        };
        std::vector<std::pair<Expr, Variable>> items = omega.items;
        std::stable_sort(items.begin(), items.end(), [&height](const auto &a, const auto &b) { return height(a.second) > height(b.second); });
        int s = 0;
        for (const auto &[expression, variable] : items) {
            s = sign(argumentOf(expression));
            if (s != 1 && s != -1) throw signUnknown(argumentOf(expression));
        }
        const Expr g = argumentOf(items.back().first);
        const Expr ws = s == 1 ? div(one, w) : Expr(w);
        integer_class denominators(1);
        std::vector<std::pair<Variable, Expr>> replacements;
        for (const auto &[expression, variable] : items) {
            const Expr c = limitInf(div(argumentOf(expression), g));
            if (infinitySign(c) != 0 || eq(*c, *zero) || has(c, x_)) throw notFound("the growth of its most rapidly varying parts is not compared");
            if (is_a<Rational>(*c)) {
                integer_class next;
                mp_lcm(next, denominators, get_den(down_cast<const Rational &>(*c).as_rational_class()));
                denominators = next;
            }
            Expr a = argumentOf(expression);
            const auto rewrite = omega.rewrites.find(variable);
            if (rewrite != omega.rewrites.end()) a = argumentOf(rewrite->second);
            replacements.emplace_back(variable, mul(pow(E, expand(sub(a, mul(c, g)))), pow(ws, c)));
        }
        Expr f = e;
        for (const auto &[variable, value] : replacements) f = replaced(f, variable, value);
        for (const auto &[expression, variable] : items) {
            if (has(f, variable)) throw notFound("its most rapidly varying parts are not all rewritten");
        }
        Expr logw = s == 1 ? neg(g) : g;
        //w to the lcm of the denominators of the powers
        if (denominators != 1) {
            const Expr q = integer(denominators);
            f = substituted(f, w, pow(w, q));
            logw = div(logw, q);
        }
        return {positiveForm(f, {x_, w}), logw};
    }

    //The leading term c0 w^e0 of f, w going to 0, log(w) as the symbol L: the logarithms and the powers that are not
    //integers of the functions of w written with their leading terms, w as v^q where its powers are fractions, then the
    //series in v at increasing orders
    std::pair<Expr, Expr> leadterm(const Expr &given, const Variable &w, const Variable &L)
    {
        checkpoint();
        if (++depth_ > LIMIT_DEPTH) {
            depth_--;
            throw notFound("its computation is nested too deep");
        }
        struct Leave {
            unsigned &depth;
            ~Leave() { depth--; }
        } leave{depth_};
        Expr f = substituted(positiveForm(given, {x_, w}), log(w), L);
        f = separated(f, w, L);
        if (!has(f, w)) return {f, zero};
        //Powers of w that are not rational (rates of exponentials such as 2^x and 3^x): the leading terms of the parts
        if (irrationalPowers(f, w)) {
            const auto found = structuralLead(f, w, L);
            if (!found) throw notFound("of terms with powers that are not rational cancelling");
            return *found;
        }
        //The powers of w: their denominators
        integer_class q(1);
        powersOf(f, w, q);
        Variable v = w;
        if (q != 1) {
            v = fresh("v");
            f = positiveForm(substituted(f, w, pow(v, integer(q))), {x_, v});
        }
        //SymEngine's series knows its variable by its name: a symbol of a name no other has
        static std::atomic<size_t> count{0};
        const Variable s = symbol("@series" + std::to_string(++count));
        f = replaced(f, v, s);
        for (long order = 1; order <= 64; order *= 2) {
            std::map<long, Expr> terms;
            try {
                terms = seriesTermsOf(f, s, order);
            } catch (SymEngineException &) {
                throw notFound("a series is not computed");
            } catch (const MathError &error) {
                if (error.code() == ErrorCode::Cancelled || error.code() == ErrorCode::Timeout) throw;
                throw notFound("a series is not computed");
            }
            for (const auto &[power, coefficient] : terms) {
                if (zeroCoefficient(coefficient)) continue;
                return {coefficient, Rational::from_mpq(rational_class(integer_class(power), q))};
            }
        }
        throw notFound("a leading term is not found");
    }

    //Whether a coefficient is 0: expanded, or as a fraction cancelled
    static bool zeroCoefficient(const Expr &c)
    {
        if (eq(*expand(c), *zero)) return true;
        try {
            return eq(*cancelOf(c), *zero);
        } catch (const MathError &) {
            return false;
        }
    }

    //Whether e has a power of w whose exponent is not a rational number
    static bool irrationalPowers(const Expr &e, const Variable &w)
    {
        if (is_a<Pow>(*e) && eq(*down_cast<const Pow &>(*e).get_base(), *w) && !is_a_Number(*down_cast<const Pow &>(*e).get_exp())) return true;
        if (is_a<Mul>(*e)) {
            for (const auto &[base, exponent] : down_cast<const Mul &>(*e).get_dict()) {
                if (eq(*base, *w) && !is_a_Number(*exponent)) return true;
            }
        }
        for (const Expr &argument : e->get_args()) {
            if (irrationalPowers(argument, w)) return true;
        }
        return false;
    }

    //The leading term of f from those of its parts: of a sum, the terms of the lowest power (nothing where they cancel),
    //of a product, of a power, of a function of a part going to a value where it is not 0
    std::optional<std::pair<Expr, Expr>> structuralLead(const Expr &f, const Variable &w, const Variable &L)
    {
        checkpoint();
        if (!has(f, w)) return std::make_pair(f, Expr(zero));
        if (eq(*f, *w)) return std::make_pair(Expr(one), Expr(one));
        if (is_a<Mul>(*f)) {
            Expr c = one, k = zero;
            for (const Expr &factor : f->get_args()) {
                const auto found = structuralLead(factor, w, L);
                if (!found) return std::nullopt;
                c = mul(c, found->first);
                k = add(k, found->second);
            }
            return std::make_pair(c, k);
        }
        if (is_a<Add>(*f)) {
            std::vector<std::pair<Expr, Expr>> terms;
            for (const Expr &term : f->get_args()) {
                const auto found = structuralLead(term, w, L);
                if (!found) return std::nullopt;
                terms.push_back(*found);
            }
            Expr lowest = terms.front().second;
            for (const auto &[c, k] : terms) {
                const int order = compareOf(k, lowest);
                if (order != 0 && order != 1 && order != -1) return std::nullopt;
                if (order == -1) lowest = k;
            }
            Expr c = zero;
            for (const auto &[coefficient, k] : terms) {
                if (compareOf(k, lowest) == 0) c = add(c, coefficient);
            }
            if (zeroCoefficient(c)) return std::nullopt;
            return std::make_pair(c, lowest);
        }
        if (isExp(f)) {
            const auto found = structuralLead(argumentOf(f), w, L);
            if (!found) return std::nullopt;
            const int order = compareOf(found->second, zero);
            if (order == 1) return std::make_pair(Expr(one), Expr(zero));
            if (order != 0) return std::nullopt;
            //e^(a L + r) = w^a e^r for a number a; for a of x, a coefficient (as in the series, L later log(w) of x)
            const Expr c = expand(found->first);
            const Expr a = expand(SymEngine::diff(c, L, true));
            if (is_a_Number(*a)) return std::make_pair(Expr(exp(expand(sub(c, mul(a, L))))), a);
            return std::make_pair(Expr(exp(c)), Expr(zero));
        }
        if (is_a<Pow>(*f)) {
            const Expr exponent = down_cast<const Pow &>(*f).get_exp();
            if (has(exponent, w)) return std::nullopt;
            const auto found = structuralLead(down_cast<const Pow &>(*f).get_base(), w, L);
            if (!found) return std::nullopt;
            if (!is_a<Integer>(*exponent) && !positive(found->first, {x_}) && compareOf(found->first, zero) != 1) return std::nullopt;
            return std::make_pair(pow(found->first, exponent), mul(found->second, exponent));
        }
        if (is_a<Log>(*f)) {
            const Expr a = down_cast<const Log &>(*f).get_arg();
            const auto found = structuralLead(a, w, L);
            if (!found || has(found->first, L)) return std::nullopt;
            //log(a) of a going to 1: as a - 1
            if (eq(*found->first, *one) && eq(*found->second, *zero)) return structuralLead(expand(sub(a, one)), w, L);
            const Expr value = add(log(found->first), mul(found->second, L));
            if (zeroCoefficient(value)) return std::nullopt;
            return std::make_pair(value, Expr(zero));
        }
        if (is_a_sub<OneArgFunction>(*f)) {
            const auto found = structuralLead(f->get_args()[0], w, L);
            if (!found || has(found->first, L)) return std::nullopt;
            const int order = compareOf(found->second, zero);
            if (order != 0 && order != 1) return std::nullopt;
            const Expr value = down_cast<const OneArgFunction &>(*f).create(order == 1 ? Expr(zero) : found->first);
            if (undefinedIn(value)) return std::nullopt;
            //Of a function that is 0 at 0, of an argument going to 0: its derivative at 0 times the argument
            if (order == 1 && eq(*value, *zero)) {
                Expr slope;
                if (is_a<Sin>(*f) || is_a<Tan>(*f) || is_a<ASin>(*f) || is_a<ATan>(*f)) slope = one;
                if (is_a<Erf>(*f)) slope = div(integer(2), sqrt(pi));
                if (slope.is_null()) return std::nullopt;
                return std::make_pair(mul(slope, found->first), found->second);
            }
            if (zeroCoefficient(value)) return std::nullopt;
            return std::make_pair(value, Expr(zero));
        }
        return std::nullopt;
    }

    //The lcm of the denominators of the powers of w
    static void powersOf(const Expr &e, const Variable &w, integer_class &q)
    {
        if (is_a<Pow>(*e) && eq(*down_cast<const Pow &>(*e).get_base(), *w) && is_a<Rational>(*down_cast<const Pow &>(*e).get_exp())) {
            integer_class next;
            mp_lcm(next, q, get_den(down_cast<const Rational &>(*down_cast<const Pow &>(*e).get_exp()).as_rational_class()));
            q = next;
        }
        if (is_a<Mul>(*e)) {
            for (const auto &[base, exponent] : down_cast<const Mul &>(*e).get_dict()) {
                if (eq(*base, *w) && is_a<Rational>(*exponent)) {
                    integer_class next;
                    mp_lcm(next, q, get_den(down_cast<const Rational &>(*exponent).as_rational_class()));
                    q = next;
                }
            }
        }
        for (const Expr &argument : e->get_args()) powersOf(argument, w, q);
    }

    //log(A) and A^p (p not an integer) of a function A of w that is not a power of w: with the leading term c w^k of A,
    //log c + k L + log(A/(c w^k)) and c^p w^(k p) (A/(c w^k))^p, of a positive c
    Expr separated(const Expr &e, const Variable &w, const Variable &L)
    {
        if (!has(e, w)) return e;
        if (is_a<Log>(*e)) {
            const Expr a = separated(down_cast<const Log &>(*e).get_arg(), w, L);
            const auto [c, k] = leadterm(a, w, L);
            if (has(c, L)) throw notFound("of a logarithm of a logarithm going to 0");
            if (!positive(c, {x_}) && compareOf(c, zero) != 1) throw notFound("of a logarithm of a value that is not decided positive");
            const Expr rest = expand(div(a, mul(c, pow(w, k))));
            return add(add(log(c), mul(k, L)), log(rest));
        }
        if (is_a<Pow>(*e) && !isExp(e)) {
            const Expr base = separated(down_cast<const Pow &>(*e).get_base(), w, L);
            const Expr exponent = separated(down_cast<const Pow &>(*e).get_exp(), w, L);
            if (eq(*base, *w) || is_a<Integer>(*exponent) || has(exponent, w)) return pow(base, exponent);
            const auto [c, k] = leadterm(base, w, L);
            if (!positive(c, {x_}) && compareOf(c, zero) != 1) throw notFound("of a power of a value that is not decided positive");
            const Expr rest = expand(div(base, mul(c, pow(w, k))));
            return mul(mul(pow(c, exponent), pow(w, mul(k, exponent))), pow(rest, exponent));
        }
        if (is_a<Add>(*e)) {
            Expr sum = zero;
            for (const Expr &term : e->get_args()) sum = add(sum, separated(term, w, L));
            return sum;
        }
        if (is_a<Mul>(*e)) {
            Expr product = one;
            for (const Expr &factor : e->get_args()) product = mul(product, separated(factor, w, L));
            return product;
        }
        //A function of an argument going to infinity (sin(1/w) for sin(x) at inf): no series, and maybe no limit
        const auto bounded = [&](const Expr &argument) {
            if (!has(argument, w)) return;
            const auto [c, k] = leadterm(argument, w, L);
            if (is_a_Number(*k) && down_cast<const Number &>(*k).is_negative()) {
                throw notFound("of a function of an argument going to infinity");
            }
        };
        if (isExp(e)) {
            const Expr argument = separated(argumentOf(e), w, L);
            bounded(argument);
            return pow(E, argument);
        }
        //atan(u) = ±pi/2 - atan(1/u) for u going to ±inf, acot(u) = atan(1/u)
        if (is_a<ACot>(*e)) return separated(atan(div(one, down_cast<const ACot &>(*e).get_arg())), w, L);
        if (is_a<ATan>(*e)) {
            const Expr u = separated(down_cast<const ATan &>(*e).get_arg(), w, L);
            const auto [c, k] = leadterm(u, w, L);
            if (is_a_Number(*k) && down_cast<const Number &>(*k).is_negative()) {
                const int s = sign(c);
                if (s != 1 && s != -1) throw signUnknown(c);
                return sub(mul(integer(s), div(pi, integer(2))), separated(atan(div(one, u)), w, L));
            }
            return atan(u);
        }
        if (is_a_sub<Function>(*e)) {
            vec_basic arguments;
            for (const Expr &argument : e->get_args()) {
                arguments.push_back(separated(argument, w, L));
                bounded(arguments.back());
            }
            return rebuilt(e, arguments);
        }
        return e;
    }
};

//The functions whose limit at a point is not their value there: their jumps
bool jumps(const Expr &e)
{
    if (is_a<Abs>(*e) || is_a<Sign>(*e) || is_a<Floor>(*e) || is_a<Ceiling>(*e) || is_a<Truncate>(*e) || is_a<Piecewise>(*e)) return true;
    if (is_a_sub<FunctionWrapper>(*e)) {
        const std::string &name = down_cast<const FunctionWrapper &>(*e).get_name();
        if (name == "round" || name == "mod" || name == "sum" || name == "product") return true;
    }
    for (const Expr &argument : e->get_args()) {
        if (jumps(argument)) return true;
    }
    return false;
}

//The limit from one side of a finite point, or at inf or -inf, or its oscillation (gruntz)
Found oneSided(const Expr &e, const Variable &x, const Expr &point, bool above)
{
    const bool infinite = is_a<Infty>(*point);
    //Continuous there: the value
    if (!infinite && !jumps(e)) {
        try {
            const Expr value = evaluatedOf(substituted(e, x, point));
            //(a constant computed: atanh(1) is left as it is)
            bool finite = !undefinedIn(value);
            if (finite && free_symbols(*value).empty()) {
                const std::complex<double> number = toComplex(value);
                finite = std::isfinite(number.real()) && std::isfinite(number.imag());
            }
            if (finite) return {value};
        } catch (SymEngineException &) {
        } catch (const MathError &error) {
            if (error.code() == ErrorCode::Cancelled || error.code() == ErrorCode::Timeout) throw;
        }
    }
    const Variable z = fresh("z");
    Expr atInf;
    if (infinite) {
        atInf = down_cast<const Infty &>(*point).is_positive_infinity() ? substituted(e, x, z) : substituted(e, x, neg(z));
    } else {
        atInf = substituted(e, x, above ? add(point, div(one, z)) : sub(point, div(one, z)));
    }
    Found found;
    try {
        found = Gruntz(z).limitFound(atInf);
    } catch (SymEngineException &error) {
        throw notFound(error.what());
    }
    if (found.value.is_null()) return found;
    if (has_symbol(*found.value, *z)) throw notFound("its variable is left in the result");
    return found;
}

}

Expr limitOf(const Expr &given, const std::string &name, const Expr &point, const std::string &direction)
{
    if (!isName(name) || isBuiltin(name)) throw MathError(ErrorCode::Argument, name + " is not a variable");
    return limitOf(given, symbol(name), point, direction);
}

Expr limitOf(const Expr &given, const RCP<const Symbol> &x, const Expr &point, const std::string &direction)
{
    const std::string &name = x->get_name();
    if (direction != "+" && direction != "-" && direction != "both") throw MathError(ErrorCode::Argument, "The direction of a limit is '+', '-' or 'both'");
    if (has_symbol(*point, *x)) throw MathError(ErrorCode::Argument, "The point of a limit is not of its variable");
    if (is_a<NaN>(*point) || (is_a<Infty>(*point) && down_cast<const Infty &>(*point).is_unsigned_infinity())) throw MathError(ErrorCode::Argument, "The point of a limit is a number, inf or -inf");
    const Expr e = evaluatedOf(given);
    if (!has_symbol(*e, *x)) return e;
    const auto oscillating = [&]() {
        return MathError(ErrorCode::Domain, toText(given) + " has no limit at " + name + " = " + toText(point) + ": it oscillates");
    };
    if (is_a<Infty>(*point) || direction != "both") {
        const Found found = oneSided(e, x, point, direction != "-");
        if (found.value.is_null()) throw oscillating();
        return found.value;
    }
    const Found above = oneSided(e, x, point, true), below = oneSided(e, x, point, false);
    if (above.value.is_null() || below.value.is_null()) throw oscillating();
    if (eq(*above.value, *below.value) || compareOf(above.value, below.value) == 0) return above.value;
    throw MathError(ErrorCode::Domain, toText(given) + " has no limit at " + name + " = " + toText(point) + ": " + toText(below.value) + " from below, " + toText(above.value) + " from above");
}

}
