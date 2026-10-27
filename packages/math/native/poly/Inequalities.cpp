//The inequalities of fractions of polynomials (see Inequalities.h)
#include "Inequalities.h"

#include <algorithm>
#include <vector>

#include <symengine/infinity.h>
#include <symengine/pow.h>
#include <symengine/rational.h>
#include <symengine/symbol.h>
#include <symengine/visitor.h>

#include "../async/Pool.h"
#include "../core/Errors.h"
#include "../parser/Parser.h"
#include "../printer/Printer.h"
#include "Convert.h"
#include "Factor.h"
#include "RealRoots.h"

namespace math {

using namespace SymEngine;
using namespace poly;

namespace {

//An irreducible factor of the numerator or of a denominator: whether the expression is 0 at its roots, or not defined
struct Factor {
    Dup g;
    bool zero = false;
    bool pole = false;
};

//A real root of a factor: its exact value and an interval with it inside (a point for a rational root)
struct Root {
    Expr value;
    RootInterval interval;
    bool rational = false;
    size_t factor = 0;
};

//A polynomial in the variable alone, with rational coefficients (its denominator dropped: a positive number)
Dup polynomialOf(const Expr &expression, const std::string &name, const std::string &message)
{
    Polynomials p;
    try {
        p = toPolynomials({expression}, name);
    } catch (const MathError &error) {
        if (error.code() == ErrorCode::NotSupported) throw MathError(ErrorCode::NotSupported, message);
        throw;
    }
    if (p.generators.size() != 1) throw MathError(ErrorCode::NotSupported, message);
    return p.polys[0].g;
}

//The irreducible factors of a polynomial added to the factors, once each
void addFactors(const Dup &f, bool zero, bool pole, std::vector<Factor> &factors)
{
    if (dup_degree(f) < 1) return;
    const Factorization factored = dmp_factor_list(dmp_from_dup(f), 0);
    for (const auto &entry : factored.factors) {
        const Dup &g = entry.first.g;
        const auto found = std::find_if(factors.begin(), factors.end(), [&g](const Factor &other) { return other.g == g; });
        if (found == factors.end()) {
            factors.push_back({g, zero, pole});
        } else {
            found->zero = found->zero || zero;
            found->pole = found->pole || pole;
        }
    }
}

//The bases of the negative powers with the variable: the expression is not defined where they are 0
void negativePowers(const Expr &expression, const RCP<const Symbol> &x, std::vector<Expr> &bases)
{
    if (is_a<Pow>(*expression)) {
        const Pow &power = down_cast<const Pow &>(*expression);
        if (is_a_Number(*power.get_exp()) && down_cast<const Number &>(*power.get_exp()).is_negative() && has_symbol(*power.get_base(), *x)) bases.push_back(power.get_base());
    }
    for (const Expr &argument : expression->get_args()) negativePowers(argument, x, bases);
}

//The exact real roots of an irreducible factor, matched with their isolating intervals: a root is in (a, b) when
//compare() puts it between them; where compare() cannot tell, the intervals are halved and it tries again
std::vector<Root> exactRoots(const Factor &factor, size_t index, const std::string &name, std::vector<RootInterval> intervals)
{
    const Expr polynomial = fromPolynomial(dmp_from_dup(factor.g), 0, {symbol(name)});
    const std::string message = "The real roots of " + toText(polynomial) + " have no exact form found (numeric.polynomialRoots() gives their values)";
    const Solutions solved = solveOf(polynomial, name, true);
    if (solved.kind != "finite" || solved.values.size() != intervals.size()) throw MathError(ErrorCode::NotSupported, message);
    std::vector<Root> roots(intervals.size());
    std::vector<bool> taken(intervals.size(), false);
    for (const Expr &value : solved.values) {
        for (int attempt = 0;; attempt++) {
            checkpoint();
            long inside = -1;
            size_t count = 0;
            bool unknown = false;
            for (size_t i = 0; i < intervals.size(); i++) {
                const int low = compareOf(Rational::from_mpq(intervals[i].a), value);
                const int high = compareOf(value, Rational::from_mpq(intervals[i].b));
                if (low == 2 || high == 2) unknown = true;
                if (low == -1 && high == -1) {
                    inside = static_cast<long>(i);
                    count++;
                }
            }
            if (count == 1 && !taken[static_cast<size_t>(inside)]) {
                taken[static_cast<size_t>(inside)] = true;
                roots[static_cast<size_t>(inside)] = {value, intervals[static_cast<size_t>(inside)], false, index};
                break;
            }
            if (!unknown || attempt >= 60) throw MathError(ErrorCode::NotSupported, message);
            for (RootInterval &interval : intervals) dup_refine_root(factor.g, interval);
            for (size_t i = 0; i < roots.size(); i++) {
                if (taken[i]) roots[i].interval = intervals[i];
            }
        }
    }
    return roots;
}

//The roots sorted, their intervals apart (b < the next a), each one halved until it is
void separate(std::vector<Root> &roots, const std::vector<Factor> &factors)
{
    for (;;) {
        checkpoint();
        std::sort(roots.begin(), roots.end(), [](const Root &x, const Root &y) { return x.interval.a < y.interval.a; });
        bool apart = true;
        for (size_t i = 0; i + 1 < roots.size(); i++) {
            if (roots[i].interval.b < roots[i + 1].interval.a) continue;
            apart = false;
            if (!roots[i].rational) dup_refine_root(factors[roots[i].factor].g, roots[i].interval);
            if (!roots[i + 1].rational) dup_refine_root(factors[roots[i + 1].factor].g, roots[i + 1].interval);
        }
        if (apart) return;
    }
}

bool satisfies(int sign, const std::string &relation)
{
    if (relation == "<") return sign < 0;
    if (relation == "<=") return sign <= 0;
    if (relation == ">") return sign > 0;
    return sign >= 0;
}

}

Solutions inequalityOf(const Expr &given, const std::string &relation, const std::string &name)
{
    if (relation != "<" && relation != "<=" && relation != ">" && relation != ">=") throw MathError(ErrorCode::Argument, "Not a relation of an inequality: " + relation);
    if (!isName(name) || isBuiltin(name)) throw MathError(ErrorCode::Argument, name + " is not a variable");
    const RCP<const Symbol> x = symbol(name);
    const Expr expression = evaluatedOf(given);
    const std::string message = toText(given) + " " + relation + " 0 is not an inequality of a fraction of polynomials in " + name + " with rational coefficients (numeric.findRoot() finds the roots of other functions)";
    const std::pair<Expr, Expr> fraction = fractionOf(expression);
    const Dup top = polynomialOf(fraction.first, name, message), bottom = polynomialOf(fraction.second, name, message);
    //The factors: of the numerator (zeros), of the denominators (poles)
    std::vector<Factor> factors;
    addFactors(top, true, false, factors);
    addFactors(bottom, false, true, factors);
    std::vector<Expr> bases;
    negativePowers(expression, x, bases);
    for (const Expr &base : bases) addFactors(polynomialOf(fractionOf(base).first, name, message), false, true, factors);
    //Their real roots
    std::vector<Root> roots;
    for (size_t i = 0; i < factors.size(); i++) {
        checkpoint();
        const Dup &g = factors[i].g;
        if (dup_degree(g) == 1) {
            const Q root(-g[1], g[0]);
            roots.push_back({Rational::from_mpq(root), {root, root}, true, i});
            continue;
        }
        const std::vector<RootInterval> intervals = dup_isolate_real_roots(g);
        if (intervals.empty()) continue;
        const std::vector<Root> found = exactRoots(factors[i], i, name, intervals);
        roots.insert(roots.end(), found.begin(), found.end());
    }
    separate(roots, factors);
    //The parts of the line in order: the open interval before each root, the root, the interval after the last one
    const size_t k = roots.size();
    std::vector<bool> between(k + 1), at(k);
    for (size_t i = 0; i <= k; i++) {
        Q point;
        if (k == 0) {
            point = 0;
        } else if (i == 0) {
            point = roots[0].interval.a - 1;
        } else if (i == k) {
            point = roots[k - 1].interval.b + 1;
        } else {
            point = (roots[i - 1].interval.b + roots[i].interval.a) / 2;
        }
        between[i] = satisfies(dup_sign_at(top, point) * dup_sign_at(bottom, point), relation);
    }
    for (size_t i = 0; i < k; i++) at[i] = !factors[roots[i].factor].pole && satisfies(0, relation);
    //The runs of parts that are solutions: an interval, or a point alone
    Solutions solutions;
    const auto low = [&roots](size_t part) { return part == 0 ? Expr(NegInf) : roots[part - 1].value; };
    const auto high = [&roots, k](size_t part) { return part == k ? Expr(Inf) : roots[part].value; };
    //The parts as a sequence: 2i is the interval before root i, 2i + 1 the root i
    const size_t parts = 2 * k + 1;
    const auto included = [&](size_t j) { return j % 2 == 0 ? between[j / 2] : at[j / 2]; };
    for (size_t j = 0; j < parts;) {
        if (!included(j)) {
            j++;
            continue;
        }
        size_t end = j;
        while (end + 1 < parts && included(end + 1)) end++;
        if (j == end && j % 2 == 1) {
            solutions.values.push_back(roots[j / 2].value);
        } else {
            const Expr start = j % 2 == 0 ? low(j / 2) : roots[j / 2].value;
            const Expr stop = end % 2 == 0 ? high(end / 2) : roots[end / 2].value;
            solutions.intervals.push_back({start, stop, j % 2 == 0, end % 2 == 0});
        }
        j = end + 1;
    }
    solutions.kind = !solutions.intervals.empty() ? "intervals" : (!solutions.values.empty() ? "finite" : "empty");
    return solutions;
}

}
