#include "Operations.h"

#include <algorithm>
#include <cmath>
#include <limits>
#include <optional>
#include <set>
#include <unordered_map>
#include <symengine/add.h>
#include <symengine/eval_double.h>
#include <symengine/special_double.h>
#include <symengine/infinity.h>
#include <symengine/integer.h>
#include <symengine/matrix.h>
#include <symengine/polys/basic_conversions.h>
#include <symengine/polys/uexprpoly.h>
#include <symengine/series.h>
#include <symengine/sets.h>
#include <symengine/simplify.h>
#include <symengine/solve.h>
#include <symengine/real_double.h>
#include <symengine/subs.h>
#include <symengine/test_visitors.h>
#include <symengine/symbol.h>
#include <symengine/visitor.h>

#include "../async/Pool.h"
#include "Decimal.h"
#include "../parser/Parser.h"
#include "../printer/Printer.h"
#include "../functions/Functions.h"
#include "../poly/Poly.h"

namespace math {

using namespace SymEngine;

namespace {

//The expression without the unevaluated parts SymEngine's rewritings keep (cos(x - pi/2) stays so for its printing):
//replaced by what they hold, evaluated, before the operations that compute with them (the series of one did not end).
//Only the ones without variables, after a substitution: they are numbers then (cos(-pi/2) is 0)
Expr evaluated(const Expr &expression, bool numbers = false)
{
    map_basic_basic holds;
    std::vector<const Basic *> pending{expression.get()}, children;
    std::set<const Basic *> seen;
    while (!pending.empty()) {
        const Basic *node = pending.back();
        pending.pop_back();
        if (!seen.insert(node).second) continue;
        //Replaced by what it holds, itself without unevaluated parts (they nest: sinc(sinc(x)) rewritten)
        if (is_a<UnevaluatedExpr>(*node) && (!numbers || free_symbols(*node).empty())) {
            holds[node->rcp_from_this()] = evaluated(down_cast<const UnevaluatedExpr &>(*node).get_arg(), numbers);
            continue;
        }
        childrenOf(*node, children);
        pending.insert(pending.end(), children.begin(), children.end());
    }
    return holds.empty() ? expression : xreplace(expression, holds);
}


//An expression with variables cannot be a number: its variables are named
void requireNoVariables(const Expr &expression)
{
    const std::vector<std::string> variables = variablesOf(expression);
    if (variables.empty()) return;
    std::string names;
    for (const std::string &name : variables) names += (names.empty() ? "" : ", ") + name;
    throw MathError(ErrorCode::Argument, "The expression has variables (" + names + "): give their values with evaluate()");
}

RCP<const Symbol> variable(const std::string &name)
{
    if (!isName(name) || isBuiltin(name)) throw MathError(ErrorCode::Argument, name + " is not a variable");
    return symbol(name);
}

void collect(const RCP<const Set> &set, Solutions &solutions)
{
    if (is_a<FiniteSet>(*set)) {
        for (const Expr &value : down_cast<const FiniteSet &>(*set).get_container()) solutions.values.push_back(value);
    } else if (is_a<Interval>(*set)) {
        const Interval &interval = down_cast<const Interval &>(*set);
        solutions.intervals.push_back({interval.get_start(), interval.get_end(), interval.get_left_open(), interval.get_right_open()});
    } else if (is_a<Union>(*set)) {
        for (const RCP<const Set> &part : down_cast<const Union &>(*set).get_container()) collect(part, solutions);
    } else if (!is_a<EmptySet>(*set)) {
        throw std::logic_error("not a union of values and intervals");
    }
}

//A set of solutions as the formulas write its values: the periodic solutions of SymEngine (its image sets, over the
//integers n) as {2n*pi + pi | n integer}, the unions joined by "or"
std::string describeSet(const RCP<const Set> &set)
{
    if (is_a<Union>(*set)) {
        std::string text;
        for (const RCP<const Set> &part : down_cast<const Union &>(*set).get_container()) text += (text.empty() ? "" : " or ") + describeSet(part);
        return text;
    }
    if (is_a<ImageSet>(*set)) {
        const vec_basic parts = set->get_args();
        return "{" + toText(parts[1]) + " | " + toText(parts[0]) + " integer}";
    }
    if (is_a<FiniteSet>(*set)) {
        std::string text;
        for (const Expr &value : down_cast<const FiniteSet &>(*set).get_container()) text += (text.empty() ? "" : ", ") + toText(value);
        return "{" + text + "}";
    }
    if (is_a<Interval>(*set)) {
        const Interval &interval = down_cast<const Interval &>(*set);
        return (interval.get_left_open() ? "(" : "[") + toText(interval.get_start()) + ", " + toText(interval.get_end()) + (interval.get_right_open() ? ")" : "]");
    }
    return set->__str__();
}

//The solutions sorted: the real ones by value, then the complex ones by real and imaginary parts, then the others
void sortValues(std::vector<Expr> &values)
{
    auto key = [](const Expr &value) -> std::pair<int, std::complex<double>> {
        if (!variablesOf(value).empty()) return {2, {0, 0}};
        try {
            const std::complex<double> number = eval_complex_double(*value);
            return {number.imag() == 0 ? 0 : 1, number};
        } catch (...) {
            return {2, {0, 0}};
        }
    };
    std::stable_sort(values.begin(), values.end(), [&key](const Expr &a, const Expr &b) {
        const auto keyA = key(a);
        const auto keyB = key(b);
        if (keyA.first != keyB.first) return keyA.first < keyB.first;
        if (keyA.second.real() != keyB.second.real()) return keyA.second.real() < keyB.second.real();
        if (keyA.second.imag() != keyB.second.imag()) return keyA.second.imag() < keyB.second.imag();
        return toText(a) < toText(b);
    });
}

}

Expr numberFromDouble(double value)
{
    if (std::isnan(value)) return Nan;
    if (std::isinf(value)) return value > 0 ? Inf : NegInf;
    const std::string text = doubleText(value);
    return text[0] == '-' ? neg(parseNumber(text.substr(1))) : parseNumber(text);
}

//The infinities and nan as numbers of JavaScript; complexInfinity (a division by zero) has no value as one
bool specialValue(const Expr &expression, std::complex<double> &value)
{
    if (is_a<NaN>(*expression)) {
        value = {std::numeric_limits<double>::quiet_NaN(), 0};
        return true;
    }
    if (!is_a<Infty>(*expression)) return false;
    const Infty &infinity = down_cast<const Infty &>(*expression);
    if (infinity.is_unsigned_infinity()) throw MathError(ErrorCode::Domain, "complexInfinity (a division by zero) has no value as a number");
    value = {infinity.is_positive() ? std::numeric_limits<double>::infinity() : -std::numeric_limits<double>::infinity(), 0};
    return true;
}

namespace {

//The divisions by zero of the decimals are the errors of the values as numbers: the doubles of a 0 not shown exactly
//would make a number of them
void rethrowDecimalError(const MathError &error)
{
    if (error.code() == ErrorCode::Cancelled || error.code() == ErrorCode::Timeout) throw error;
    if (error.code() == ErrorCode::DivisionByZero) throw MathError(ErrorCode::Domain, std::string(error.what()));
}

//The value of an expression without variables: its decimals (20 digits, correctly rounded), real ones first, complex
//ones where it is not real (the doubles of 10^30 have no digit of cos(10^30), nor those of e^(i 10^30)); where the
//decimals have no function (gamma of a complex number), that node in doubles from the decimals of its arguments, the
//rest in decimals; in doubles only when that fails too
std::complex<double> numericValue(const Expr &given, bool *fromDecimals = nullptr)
{
    if (fromDecimals) *fromDecimals = true;
    requireNoVariables(given);
    const Expr expression = evaluated(given);
    std::complex<double> value;
    if (specialValue(expression, value)) return value;
    try {
        return std::strtod(toRealDecimal(expression, 20).c_str(), nullptr);
    } catch (MathError &error) {
        rethrowDecimalError(error);
    }
    try {
        const auto [re, im] = toComplexDecimal(expression, 20);
        return {std::strtod(re.c_str(), nullptr), std::strtod(im.c_str(), nullptr)};
    } catch (MathError &error) {
        rethrowDecimalError(error);
    }
    try {
        return complexDoubleValue(expression);
    } catch (MathError &error) {
        rethrowDecimalError(error);
    }
    if (fromDecimals) *fromDecimals = false;
    try {
        const double real = eval_double(*expression);
        if (!std::isnan(real)) return real;
    } catch (SymEngineException &) {
    }
    try {
        return eval_complex_double(*expression);
    } catch (SymEngineException &) {
        throw MathError(ErrorCode::NotSupported, "The numeric value of " + toText(expression) + " is not computed");
    }
}

}

double toDouble(const Expr &expression)
{
    //An imaginary part of the decimals is one (a part that cannot be told from 0 is 0 there, also where some nodes are
    //computed in doubles); one of the doubles only below their roundings is not
    bool fromDecimals = false;
    const std::complex<double> value = numericValue(expression, &fromDecimals);
    if (value.imag() != 0 && (fromDecimals || std::abs(value.imag()) > 1e-12 * std::max(1.0, std::abs(value.real())))) {
        throw MathError(ErrorCode::Domain, "The value is a complex number (" + toText(expression) + "): use toComplex()");
    }
    return value.real();
}

std::complex<double> toComplex(const Expr &expression)
{
    return numericValue(expression);
}

std::vector<std::string> variablesOf(const Expr &expression)
{
    std::vector<std::string> names;
    for (const Expr &found : free_symbols(*expression)) {
        if (is_a<Symbol>(*found)) names.push_back(down_cast<const Symbol &>(*found).get_name());
    }
    std::sort(names.begin(), names.end());
    return names;
}

Expr evaluatedOf(const Expr &expression)
{
    return evaluated(expression);
}

bool equalsOf(const Expr &givenA, const Expr &givenB)
{
    const Expr a = evaluated(givenA), b = evaluated(givenB);
    if (eq(*a, *b)) return true;
    const Expr difference = expand(sub(a, b));
    if (eq(*difference, *zero)) return true;
    checkpoint();
    //Fractions: the numerator over one denominator expanded ((x^2 - 1)/(x - 1) is x + 1)
    const std::pair<Expr, Expr> fraction = fractionOf(difference);
    if (!eq(*fraction.second, *one) && eq(*expand(fraction.first), *zero)) return true;
    checkpoint();
    return eq(*expand(simplify(difference)), *zero);
}

Expr arithmeticOf(const std::string &operation, const Expr &a, const Expr &b)
{
    if (operation == "+") return add(a, b);
    if (operation == "-") return sub(a, b);
    if (operation == "*") return mul(a, b);
    if (operation == "/") return div(a, b);
    if (operation == "^") return pow(a, b);
    if (operation == "neg") return neg(a);
    throw MathError(ErrorCode::Argument, "Unknown operation of arithmetic " + operation);
}

Expr expandOf(const Expr &expression)
{
    return expand(expression);
}

Expr simplifyOf(const Expr &expression)
{
    return simplify(evaluated(expression));
}

Expr differentiate(const Expr &expression, const std::string &name, unsigned times)
{
    const RCP<const Symbol> by = variable(name);
    //Without the variable: 0 at once (the derivative of a number may compute powers too large)
    if (!free_symbols(*expression).count(by)) return zero;
    Expr result = expression;
    for (unsigned i = 0; i < times; i++) {
        checkpoint();
        result = result->diff(by);
    }
    return result;
}

Expr substitute(const Expr &expression, const std::vector<std::pair<std::string, Expr>> &values)
{
    map_basic_basic replacements;
    for (const auto &[name, value] : values) replacements[variable(name)] = value;
    return evaluated(subs(expression, replacements), true);
}

Expr seriesOf(const Expr &given, const std::string &name, const Expr &point, unsigned order)
{
    const Expr expression = evaluated(given);
    if (order < 1 || order > 1000) throw MathError(ErrorCode::Argument, "The order of a series is from 1 to 1000");
    const RCP<const Symbol> by = variable(name);
    const bool atZero = eq(*point, *zero);
    //At a point a: the series of f(x + a) at 0, x then replaced by x - a
    const Expr shifted = atZero ? expression : subs(expression, {{by, add(by, point)}});
    Expr result = series(shifted, by, order)->as_basic();
    if (!atZero) result = subs(result, {{by, sub(by, point)}});
    return result;
}

namespace {

//The roots of a polynomial in the variable of degree 2 or more (its coefficients may have other variables): of its
//irreducible factors over the rationals, a linear one at once, the others by SymEngine's formulas; nothing where one
//of them is not solved. SymEngine's formulas alone give the roots of x^3 - 6x^2 + 11x - 6 by Cardano's radicals, not
//1, 2, 3, those of x^2 - (a + b)x + a*b with sqrt((a - b)^2), and none of x^5 - x.
//The roots of a binomial a x^n + b of degree 5 or more with rational coefficients, which SymEngine does not solve:
//r = |b/a|^(1/n) times the n-th roots of 1 (of -1 when -b/a < 0); the real ones written as r and -r
std::optional<std::vector<Expr>> binomialRootsOf(const std::vector<Expr> &c)
{
    const size_t n = c.size() - 1;
    if (n < 5) return std::nullopt;
    for (size_t i = 1; i < n; i++) {
        if (!is_a_Number(*c[i]) || !down_cast<const Number &>(*c[i]).is_zero()) return std::nullopt;
    }
    const auto isRational = [](const Expr &value) { return is_a<SymEngine::Integer>(*value) || is_a<Rational>(*value); };
    if (!isRational(c[0]) || !isRational(c[n]) || down_cast<const Number &>(*c[0]).is_zero()) return std::nullopt;
    const RCP<const Number> ratio = rcp_static_cast<const Number>(div(neg(c[0]), c[n]));
    const bool negative = ratio->is_negative();
    const Expr radius = pow(negative ? neg(ratio) : Expr(ratio), rational(1, static_cast<long>(n)));
    std::vector<Expr> roots;
    for (size_t k = 0; k < n; k++) {
        //The angle (2k + 1)pi/n for -1, 2k pi/n for 1, written from -pi to pi
        long turns = static_cast<long>(2 * k + (negative ? 1 : 0));
        if (turns > static_cast<long>(n)) turns -= 2 * static_cast<long>(n);
        if (turns == 0) {
            roots.push_back(radius);
        } else if (turns == static_cast<long>(n)) {
            roots.push_back(neg(radius));
        } else {
            roots.push_back(mul(radius, exp(mul(I, mul(pi, rational(turns, static_cast<long>(n)))))));
        }
    }
    return roots;
}

std::optional<set_basic> factoredRootsOf(const Expr &expression, const RCP<const Symbol> &by)
{
    std::vector<Expr> coefficients;
    try {
        coefficients = coefficientsOf(expression, by->get_name());
    } catch (const MathError &) {
        return std::nullopt;
    }
    if (coefficients.size() < 3) return std::nullopt;
    FactoredPolynomial factored;
    try {
        factored = factorPolynomial(expression);
    } catch (const MathError &error) {
        if (error.code() == ErrorCode::Cancelled || error.code() == ErrorCode::Timeout) throw;
        return std::nullopt;
    }
    set_basic roots;
    for (const auto &[factor, multiplicity] : factored.factors) {
        checkpoint();
        const std::vector<Expr> c = coefficientsOf(factor, by->get_name());
        if (c.size() < 2) continue;
        if (c.size() == 2) {
            roots.insert(div(neg(c[0]), c[1]));
            continue;
        }
        if (const std::optional<std::vector<Expr>> binomial = binomialRootsOf(c)) {
            roots.insert(binomial->begin(), binomial->end());
            continue;
        }
        const RCP<const Set> solved = solve(factor, by, universalset());
        if (!is_a<FiniteSet>(*solved)) return std::nullopt;
        for (const Expr &value : down_cast<const FiniteSet &>(*solved).get_container()) roots.insert(value);
    }
    return roots;
}

}

Solutions solveOf(const Expr &given, const std::string &name, bool real)
{
    const Expr expression = evaluated(given);
    const RCP<const Symbol> by = variable(name);
    //A polynomial factored first; all of it by SymEngine where that does not solve it
    RCP<const Set> found;
    if (const std::optional<set_basic> roots = factoredRootsOf(expression, by)) found = roots->empty() ? RCP<const Set>(emptyset()) : finiteset(*roots);
    //In the real numbers: the complex solutions kept when they are real (SymEngine fails intersecting some of them
    //with the real line); the other sets solved in the real line
    if (found.is_null()) found = solve(expression, by, universalset());
    if (real && is_a<FiniteSet>(*found)) {
        set_basic kept;
        for (const Expr &value : down_cast<const FiniteSet &>(*found).get_container()) {
            if (!variablesOf(value).empty()) {
                kept.insert(value);
                continue;
            }
            const std::complex<double> number = eval_complex_double(*value);
            if (std::abs(number.imag()) <= 1e-12 * std::max(1.0, std::abs(number.real()))) kept.insert(value);
        }
        found = kept.empty() ? RCP<const Set>(emptyset()) : finiteset(kept);
    } else if (real) {
        try {
            found = solve(expression, by, interval(NegInf, Inf, true, true));
        } catch (SymEngineException &) {
            //Left as solved in the complex numbers
        }
    }
    Solutions solutions;
    if (is_a<EmptySet>(*found)) {
        solutions.kind = "empty";
    } else if (is_a<UniversalSet>(*found) || is_a<Complexes>(*found) || is_a<Reals>(*found)
        || (is_a<Interval>(*found) && eq(*down_cast<const Interval &>(*found).get_start(), *NegInf) && eq(*down_cast<const Interval &>(*found).get_end(), *Inf))) {
        solutions.kind = "all";
    } else if (is_a<ConditionSet>(*found)) {
        //The equation itself, as the formulas write it
        solutions.kind = "unsolved";
        solutions.text = toText(expression) + " = 0";
    } else {
        try {
            collect(found, solutions);
            solutions.kind = solutions.intervals.empty() ? "finite" : "intervals";
        } catch (const std::logic_error &) {
            solutions = Solutions{"other", {}, {}, describeSet(found)};
        }
    }
    sortValues(solutions.values);
    return solutions;
}

namespace {

//Whether a coefficient of the elimination is zero: a number, else its expansion simplified
bool isZeroCoefficient(const Expr &value)
{
    if (is_a_Number(*value)) return down_cast<const Number &>(*value).is_zero();
    const Expr simplified = simplify(expand(value));
    return is_a_Number(*simplified) && down_cast<const Number &>(*simplified).is_zero();
}

}

LinearSolution solveLinearOf(const std::vector<Expr> &equations, const std::vector<std::string> &names)
{
    vec_sym variables;
    for (const std::string &name : names) {
        if (std::count(names.begin(), names.end(), name) > 1) throw MathError(ErrorCode::Argument, "The variable " + name + " is given twice");
        variables.push_back(variable(name));
    }
    if (variables.empty()) throw MathError(ErrorCode::Argument, "No variable to solve for");
    std::string list;
    for (const std::string &name : names) list += (list.empty() ? "" : ", ") + name;
    const MathError nonlinear(ErrorCode::NotSupported, "The equations are not linear in " + list + ": only systems of linear equations are solved");
    std::pair<DenseMatrix, DenseMatrix> system;
    try {
        system = linear_eqns_to_matrix(vec_basic(equations.begin(), equations.end()), variables);
    } catch (SymEngineException &) {
        throw nonlinear;
    }
    //A function of a variable (sin(x)) is taken as a coefficient by SymEngine: the coefficients are free of them
    const set_basic unknowns(variables.begin(), variables.end());
    const auto hasUnknown = [&unknowns](const Expr &value) {
        for (const Expr &found : free_symbols(*value)) if (unknowns.count(found)) return true;
        return false;
    };
    for (size_t i = 0; i < system.first.nrows(); i++) {
        if (hasUnknown(system.second.get(i, 0))) throw nonlinear;
        for (size_t j = 0; j < system.first.ncols(); j++) if (hasUnknown(system.first.get(i, j))) throw nonlinear;
    }
    //The augmented matrix, reduced to its row echelon form (Gauss-Jordan), its pivots numbers when it can
    const size_t rows = equations.size(), columns = variables.size();
    std::vector<std::vector<Expr>> matrix(rows, std::vector<Expr>(columns + 1));
    for (size_t i = 0; i < rows; i++) {
        for (size_t j = 0; j < columns; j++) matrix[i][j] = expand(system.first.get(i, j));
        matrix[i][columns] = expand(system.second.get(i, 0));
    }
    std::vector<size_t> pivots;
    size_t row = 0;
    for (size_t column = 0; column < columns && row < rows; column++) {
        checkpoint();
        size_t pivot = rows;
        for (size_t i = row; i < rows; i++) {
            if (isZeroCoefficient(matrix[i][column])) continue;
            if (pivot == rows || (is_a_Number(*matrix[i][column]) && !is_a_Number(*matrix[pivot][column]))) pivot = i;
        }
        if (pivot == rows) continue;
        std::swap(matrix[row], matrix[pivot]);
        const Expr divisor = matrix[row][column];
        for (size_t j = column; j <= columns; j++) matrix[row][j] = expand(div(matrix[row][j], divisor));
        for (size_t i = 0; i < rows; i++) {
            if (i == row || isZeroCoefficient(matrix[i][column])) continue;
            const Expr factor = matrix[i][column];
            for (size_t j = column; j <= columns; j++) matrix[i][j] = expand(sub(matrix[i][j], mul(factor, matrix[row][j])));
        }
        pivots.push_back(column);
        row++;
    }
    LinearSolution solution;
    for (size_t i = row; i < rows; i++) {
        if (!isZeroCoefficient(matrix[i][columns])) {
            solution.kind = "empty";
            return solution;
        }
    }
    solution.kind = "finite";
    for (size_t k = 0; k < pivots.size(); k++) {
        Expr value = matrix[k][columns];
        for (size_t j = 0; j < columns; j++) {
            if (std::find(pivots.begin(), pivots.end(), j) == pivots.end() && !isZeroCoefficient(matrix[k][j])) value = sub(value, mul(matrix[k][j], variables[j]));
        }
        solution.values.emplace_back(names[pivots[k]], expand(value));
    }
    return solution;
}

std::pair<Expr, Expr> fractionOf(const Expr &expression)
{
    RCP<const Basic> numerator, denominator;
    as_numer_denom(expression, outArg(numerator), outArg(denominator));
    return {numerator, denominator};
}

std::vector<Expr> coefficientsOf(const Expr &given, const std::string &name)
{
    const Expr expression = evaluated(given);
    const RCP<const Symbol> by = variable(name);
    const Expr expanded = expand(expression);
    const std::string message = toText(given) + " is not a polynomial in " + name;
    RCP<const UExprPoly> polynomial;
    try {
        polynomial = from_basic<UExprPoly>(expanded, by);
    } catch (SymEngineException &) {
        throw MathError(ErrorCode::NotSupported, message);
    }
    std::vector<Expr> coefficients;
    for (const auto &[power, coefficient] : polynomial->get_poly().get_dict()) {
        //A function of the variable taken as a coefficient (sin(x)): not a polynomial
        if (power < 0 || has_symbol(*coefficient.get_basic(), *by)) throw MathError(ErrorCode::NotSupported, message);
        if (static_cast<size_t>(power) >= coefficients.size()) coefficients.resize(power + 1, zero);
        coefficients[power] = coefficient.get_basic();
    }
    return coefficients;
}

std::pair<Expr, Expr> divideOf(const Expr &dividend, const Expr &divisor, const std::string &name)
{
    const RCP<const Symbol> by = variable(name);
    std::vector<Expr> remainder = coefficientsOf(dividend, name);
    std::vector<Expr> bottom = coefficientsOf(divisor, name);
    while (!bottom.empty() && is_a_Number(*bottom.back()) && down_cast<const Number &>(*bottom.back()).is_zero()) bottom.pop_back();
    if (bottom.empty()) throw MathError(ErrorCode::DivisionByZero, "The division of a polynomial by 0");
    //Long division: the leading term of the remainder cancelled by a multiple of the divisor at each step
    Expr quotient = zero;
    const size_t degree = bottom.size() - 1;
    while (remainder.size() > degree) {
        checkpoint();
        const Expr leading = remainder.back();
        remainder.pop_back();
        if (is_a_Number(*leading) && down_cast<const Number &>(*leading).is_zero()) continue;
        const size_t shift = remainder.size() - degree;
        const Expr factor = div(leading, bottom.back());
        quotient = add(quotient, mul(factor, pow(by, integer(shift))));
        for (size_t i = 0; i < degree; i++) remainder[shift + i] = expand(sub(remainder[shift + i], mul(factor, bottom[i])));
    }
    Expr rest = zero;
    for (size_t i = 0; i < remainder.size(); i++) rest = add(rest, mul(remainder[i], pow(by, integer(i))));
    return {expand(quotient), expand(rest)};
}

Expr rewriteOf(const Expr &expression, const std::string &form)
{
    if (form == "exp") return rewrite_as_exp(expression);
    if (form == "sin") return rewrite_as_sin(expression);
    if (form == "cos") return rewrite_as_cos(expression);
    throw MathError(ErrorCode::Argument, "An expression is rewritten as exp, sin or cos, not " + form);
}

namespace {

//The value of a variable-free expression, if it has one
bool valueOf(const Expr &expression, std::complex<double> &value)
{
    if (!free_symbols(*expression).empty()) return false;
    try {
        value = numericValue(expression);
        return std::isfinite(value.real()) && std::isfinite(value.imag());
    } catch (MathError &) {
        return false;
    } catch (SymEngineException &) {
        return false;
    }
}

int known(tribool value)
{
    return is_true(value) ? 1 : is_false(value) ? 0 : -1;
}

}

int predicateOf(const Expr &given, const std::string &property)
{
    const Expr expression = evaluated(given);
    std::complex<double> value;
    const bool numeric = valueOf(expression, value);
    const double tolerance = 1e-10 * std::max(1.0, std::abs(value));
    //Clearly not real, clearly away from zero, clearly away from the integers: decided by the value
    const bool clearlyComplex = numeric && std::abs(value.imag()) > tolerance;
    const bool clearlyReal = numeric && value.imag() == 0;
    if (property == "zero") {
        const int answer = known(is_zero(*expression));
        if (answer != -1) return answer;
        if (numeric && std::abs(value) > tolerance) return 0;
        return -1;
    }
    if (property == "positive" || property == "negative") {
        const int answer = known(property == "positive" ? is_positive(*expression) : is_negative(*expression));
        if (answer != -1) return answer;
        if (clearlyComplex) return 0;
        if (clearlyReal && std::abs(value.real()) > tolerance) return (value.real() > 0) == (property == "positive") ? 1 : 0;
        return -1;
    }
    if (property == "integer" || property == "rational") {
        const int answer = known(property == "integer" ? is_integer(*expression) : is_rational(*expression));
        if (answer != -1) return answer;
        if (clearlyComplex) return 0;
        if (property == "integer" && clearlyReal && std::abs(value.real() - std::round(value.real())) > tolerance) return 0;
        return -1;
    }
    if (property == "real") {
        const int answer = known(is_real(*expression));
        if (answer != -1) return answer;
        if (clearlyComplex) return 0;
        return -1;
    }
    if (property == "finite") {
        const int answer = known(is_finite(*expression));
        if (answer != -1) return answer;
        if (numeric) return 1;
        return -1;
    }
    throw MathError(ErrorCode::Argument, "Unknown property " + property);
}

namespace {

//The order of two constants by their decimals of 60 digits, when they differ beyond 1e-40 of their size; else 2 (a
//zero not shown exactly stays not known)
int decimalOrder(const Expr &a, const Expr &b)
{
    try {
        const DecimalContext context(60);
        const Decimal x = context.parse(toDecimal(evaluated(a), 60));
        const Decimal y = context.parse(toDecimal(evaluated(b), 60));
        const Decimal gap = context.sub(x, y);
        Decimal size = context.parse("1");
        if (context.compare(context.abs(x), size) > 0) size = context.abs(x);
        if (context.compare(context.abs(y), size) > 0) size = context.abs(y);
        if (context.compare(context.abs(gap), context.mul(size, context.parse("1e-40"))) > 0) return context.isNegative(gap) ? -1 : 1;
    } catch (MathError &) {
    }
    return 2;
}

}

int compareOf(const Expr &a, const Expr &b)
{
    //An infinity: after (before, for -inf) every constant that is not clearly complex; SymEngine keeps sqrt(2) - inf a
    //sum
    const auto infinity = [](const Expr &value) {
        if (!is_a<Infty>(*value)) return 0;
        const Infty &infinite = down_cast<const Infty &>(*value);
        return infinite.is_positive_infinity() ? 1 : (infinite.is_negative_infinity() ? -1 : 2);
    };
    const int infiniteA = infinity(evaluated(a)), infiniteB = infinity(evaluated(b));
    if (infiniteA == 2 || infiniteB == 2) return 2;
    if (infiniteA != 0 || infiniteB != 0) {
        if (infiniteA == infiniteB) return 0;
        if (infiniteA != 0 && infiniteB != 0) return infiniteA > infiniteB ? 1 : -1;
        const Expr &other = infiniteA != 0 ? b : a;
        if (!free_symbols(*other).empty() || predicateOf(other, "real") == 0) return 2;
        return infiniteA != 0 ? infiniteA : -infiniteB;
    }
    //Two constants: by their decimals of 60 digits first, as below; too close for them, equal when equals() shows it,
    //if their difference is small (a polynomial at a root of Cardano's formula would expand without end)
    if (free_symbols(*a).empty() && free_symbols(*b).empty()) {
        const Expr difference = sub(evaluated(a), evaluated(b));
        if (is_a_Number(*difference)) {
            const Number &number = down_cast<const Number &>(*difference);
            if (number.is_zero()) return 0;
            if (is_a<SymEngine::Integer>(number) || is_a<Rational>(number)) return number.is_positive() ? 1 : -1;
        }
        const int decided = decimalOrder(a, b);
        if (decided != 2) return decided;
        if (count_ops({difference}) <= 100 && equalsOf(a, b)) return 0;
        return 2;
    }
    const Expr difference = expand(evaluated(sub(a, b)));
    if (is_a_Number(*difference)) {
        const Number &number = down_cast<const Number &>(*difference);
        if (number.is_zero()) return 0;
        if (is_a<SymEngine::Integer>(number) || is_a<Rational>(number)) return number.is_positive() ? 1 : -1;
    }
    if (equalsOf(a, b)) return 0;
    const int positive = predicateOf(difference, "positive");
    if (positive == 1) return 1;
    const int negative = predicateOf(difference, "negative");
    if (negative == 1) return -1;
    //Too close for the doubles
    if (free_symbols(*difference).empty()) return decimalOrder(a, b);
    return 2;
}

CommonSubexpressions cseOf(const std::vector<Expr> &given, const std::string &prefix)
{
    if (!isName(prefix)) throw MathError(ErrorCode::Argument, "The prefix of the names is a name: " + prefix + " is not one");
    vec_basic expressions;
    std::set<std::string> taken;
    for (const Expr &expression : given) {
        expressions.push_back(evaluated(expression));
        for (const auto &variable : free_symbols(*expressions.back())) taken.insert(down_cast<const Symbol &>(*variable).get_name());
    }
    vec_pair replacements;
    vec_basic reduced;
    checkpoint();
    cse(replacements, reduced, expressions);
    //SymEngine's x0, x1… renamed, all at once (a name of the prefix may be one of SymEngine's)
    map_basic_basic renames;
    size_t index = 0;
    for (const auto &[symbol, value] : replacements) {
        std::string name;
        do {
            name = prefix + std::to_string(index++);
        } while (taken.count(name) || isReserved(name));
        renames[symbol] = SymEngine::symbol(name);
    }
    CommonSubexpressions result;
    for (const auto &[symbol, value] : replacements) {
        result.replacements.emplace_back(down_cast<const Symbol &>(*renames.at(symbol)).get_name(), xreplace(value, renames));
    }
    for (const Expr &expression : reduced) result.expressions.push_back(xreplace(expression, renames));
    return result;
}

namespace {

//An angle as a principal argument, from -pi (excluded) to pi: a real number moved by a multiple of 2 pi, clearly
//inside (SymEngine does not tell the sign of 5 - pi); none (null) for another angle
Expr principalAngle(const Expr &angle)
{
    if (!free_symbols(*angle).empty()) return Expr();
    std::complex<double> value;
    try {
        value = numericValue(angle);
    } catch (MathError &) {
        return Expr();
    }
    if (value.imag() != 0 || !std::isfinite(value.real())) return Expr();
    const double turns = std::round(value.real() / 6.283185307179586);
    const double reduced = value.real() - turns * 6.283185307179586;
    const double margin = 1e-12 * std::max(1.0, std::abs(value.real()));
    if (reduced <= -3.141592653589793 + margin || reduced >= 3.141592653589793 - margin) return Expr();
    return turns == 0 ? angle : sub(angle, mul(integer(static_cast<long>(2 * turns)), pi));
}

}

std::pair<Expr, Expr> polarOf(const Expr &z)
{
    //A product: the product of the moduli of its factors, the sum of their arguments when it is a principal one
    if (is_a<Mul>(*z)) {
        Expr modulus = one, angle = zero;
        for (const Expr &factor : z->get_args()) {
            const std::pair<Expr, Expr> polar = polarOf(factor);
            modulus = mul(modulus, polar.first);
            angle = add(angle, polar.second);
        }
        const Expr principal = principalAngle(angle);
        return {modulus, principal.is_null() ? argumentOf(z) : principal};
    }
    //e^w: the modulus e^re(w), the argument im(w)
    if (is_a<Pow>(*z) && eq(*down_cast<const Pow &>(*z).get_base(), *E)) {
        const Expr w = down_cast<const Pow &>(*z).get_exp();
        const Expr principal = principalAngle(imaginaryPartOf(w));
        return {exp(realPartOf(w)), principal.is_null() ? argumentOf(z) : principal};
    }
    //A constant of known parts a + bi: |a| for b = 0 (SymEngine keeps abs(sqrt(2))), sqrt(a^2 + b^2) otherwise
    Expr real, imaginary;
    if (free_symbols(*z).empty() && constantParts(z, real, imaginary)) {
        const std::pair<Expr, Expr> parts{real, imaginary};
        if (is_a_Number(*imaginary) && down_cast<const Number &>(*imaginary).is_zero()) {
            const int positive = predicateOf(real, "positive");
            if (positive == 1) return {real, zero};
            if (positive == 0 && predicateOf(real, "negative") == 1) return {neg(real), pi};
        }
        return {pow(add(pow(real, integer(2)), pow(imaginary, integer(2))), rational(1, 2)), argumentOf(z)};
    }
    return {abs(z), argumentOf(z)};
}

std::pair<Expr, Expr> rectangularOf(const Expr &z)
{
    return {realPartOf(z), imaginaryPartOf(z)};
}

}

