#include "Operations.h"

#include <algorithm>
#include <cmath>
#include <limits>
#include <symengine/add.h>
#include <symengine/eval_double.h>
#include <symengine/infinity.h>
#include <symengine/integer.h>
#include <symengine/matrix.h>
#include <symengine/series.h>
#include <symengine/sets.h>
#include <symengine/simplify.h>
#include <symengine/solve.h>
#include <symengine/subs.h>
#include <symengine/symbol.h>
#include <symengine/visitor.h>

#include "../async/Pool.h"
#include "../parser/Parser.h"
#include "../printer/Printer.h"

namespace math {

using namespace SymEngine;

namespace {

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

//The value of an expression without variables: in the real numbers first (their functions round better than the
//complex ones: sqrt(2) is Math.SQRT2), in the complex ones where it is not real
std::complex<double> numericValue(const Expr &expression)
{
    requireNoVariables(expression);
    std::complex<double> value;
    if (specialValue(expression, value)) return value;
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
    const std::complex<double> value = numericValue(expression);
    if (value.imag() != 0 && std::abs(value.imag()) > 1e-12 * std::max(1.0, std::abs(value.real()))) {
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

bool equalsOf(const Expr &a, const Expr &b)
{
    if (eq(*a, *b)) return true;
    const Expr difference = expand(sub(a, b));
    if (eq(*difference, *zero)) return true;
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
    return simplify(expression);
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
    return subs(expression, replacements);
}

Expr seriesOf(const Expr &expression, const std::string &name, const Expr &point, unsigned order)
{
    if (order < 1 || order > 1000) throw MathError(ErrorCode::Argument, "The order of a series is from 1 to 1000");
    const RCP<const Symbol> by = variable(name);
    const bool atZero = eq(*point, *zero);
    //At a point a: the series of f(x + a) at 0, x then replaced by x - a
    const Expr shifted = atZero ? expression : subs(expression, {{by, add(by, point)}});
    Expr result = series(shifted, by, order)->as_basic();
    if (!atZero) result = subs(result, {{by, sub(by, point)}});
    return result;
}

Solutions solveOf(const Expr &expression, const std::string &name, bool real)
{
    const RCP<const Symbol> by = variable(name);
    //In the real numbers: the complex solutions kept when they are real (SymEngine fails intersecting some of them
    //with the real line); the other sets solved in the real line
    RCP<const Set> found = solve(expression, by, universalset());
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
        solutions.kind = "unsolved";
        solutions.text = found->__str__();
    } else {
        try {
            collect(found, solutions);
            solutions.kind = solutions.intervals.empty() ? "finite" : "intervals";
        } catch (const std::logic_error &) {
            solutions = Solutions{"other", {}, {}, found->__str__()};
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

}
