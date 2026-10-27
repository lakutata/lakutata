//The matrices of expressions: their arithmetic, and their exact linear algebra. A matrix of numbers is eliminated with
//divisions (its rationals stay reduced); a matrix with other elements without them (Berkowitz's algorithm for the
//determinant and the characteristic polynomial, the adjugate for the inverse and the solutions, an elimination without
//divisions normalized at its end for the reduced row echelon form), so that its elements stay single fractions of
//polynomials. A pivot is an element that is not 0 by knownZero().
#include "Matrices.h"

#include <algorithm>
#include <cmath>
#include <complex>
#include <functional>

#include <symengine/add.h>
#include <symengine/complex.h>
#include <symengine/constants.h>
#include <symengine/infinity.h>
#include <symengine/integer.h>
#include <symengine/mul.h>
#include <symengine/nan.h>
#include <symengine/pow.h>
#include <symengine/rational.h>
#include <symengine/symbol.h>

#include "../async/Pool.h"
#include "../core/Errors.h"
#include "../numeric/Numeric.h"
#include "../ops/Decimal.h"
#include "../ops/Operations.h"
#include "../parser/Parser.h"
#include "../printer/Printer.h"

namespace math {

namespace {

using SymEngine::down_cast;
using SymEngine::is_a;
using SymEngine::is_a_Number;

//The elements of a matrix as rows, for the eliminations
using Rows = std::vector<std::vector<Expr>>;

bool structurallyZero(const Expr &x)
{
    return is_a_Number(*x) && down_cast<const SymEngine::Number &>(*x).is_zero();
}

//A value without variables: 0 exactly, or told from 0 by its decimals (640 digits beyond, as toDecimal() decides)
bool constantZero(const Expr &x)
{
    if (is_a_Number(*x)) return down_cast<const SymEngine::Number &>(*x).is_zero();
    if (is_a<SymEngine::Infty>(*x) || is_a<SymEngine::NaN>(*x)) return false;
    try {
        const auto [re, im] = toComplexDecimal(x, 15);
        return re == "0" && im == "0";
    } catch (const MathError &error) {
        if (error.code() == ErrorCode::Cancelled || error.code() == ErrorCode::Timeout) throw;
        return false;
    }
}

//The two values given to the variables of an element: rationals far from the integers and from each other
Expr valueOf(size_t variable, int point)
{
    static const long NUMERATORS[2][8] = {{1009, -2027, 3011, -4013, 5003, -6011, 7001, -8009}, {-1013, 2029, -3019, 4019, -5009, 6029, -7013, 8011}};
    static const long DENOMINATORS[2][8] = {{97, 89, 83, 79, 73, 71, 67, 61}, {59, 53, 47, 43, 41, 37, 31, 29}};
    const size_t k = variable % 8;
    return SymEngine::Rational::from_two_ints(*SymEngine::integer(NUMERATORS[point][k] + static_cast<long>(variable / 8) * 7919), *SymEngine::integer(DENOMINATORS[point][k]));
}

Expr plus(const Expr &a, const Expr &b)
{
    return SymEngine::add(a, b);
}

Expr minus(const Expr &a, const Expr &b)
{
    return SymEngine::sub(a, b);
}

Expr times(const Expr &a, const Expr &b)
{
    return SymEngine::mul(a, b);
}

Expr expanded(const Expr &x)
{
    return SymEngine::expand(x);
}

bool numeric(const ExpressionMatrix &a)
{
    for (const Expr &element : a.elements) {
        if (!is_a_Number(*element)) return false;
    }
    return true;
}

Rows rowsOf(const ExpressionMatrix &a)
{
    Rows rows(a.rows, std::vector<Expr>(a.columns));
    for (unsigned i = 0; i < a.rows; i++) {
        for (unsigned j = 0; j < a.columns; j++) rows[i][j] = a.at(i, j);
    }
    return rows;
}

MatrixPointer matrixOfElements(const Rows &rows, unsigned columns)
{
    std::vector<Expr> elements;
    elements.reserve(rows.size() * columns);
    for (const auto &row : rows) elements.insert(elements.end(), row.begin(), row.end());
    return matrixOf(static_cast<unsigned>(rows.size()), columns, std::move(elements));
}

void requireSquare(const ExpressionMatrix &a, const char *operation)
{
    if (a.rows != a.columns) throw MathError(ErrorCode::Argument, std::string(operation) + " needs a square matrix, not one of " + std::to_string(a.rows) + "×" + std::to_string(a.columns));
}

MatrixPointer identityOf(unsigned n)
{
    std::vector<Expr> elements(static_cast<size_t>(n) * n, SymEngine::zero);
    for (unsigned i = 0; i < n; i++) elements[static_cast<size_t>(i) * n + i] = SymEngine::one;
    return matrixOf(n, n, std::move(elements));
}

//The coefficients of det(x I - A) by Berkowitz's algorithm, from the power n down (the first one 1): products and sums
//only, each coefficient expanded
std::vector<Expr> berkowitz(const ExpressionMatrix &a)
{
    const unsigned n = a.rows;
    if (n == 0) return {SymEngine::one};
    std::vector<Expr> vector{SymEngine::one, SymEngine::neg(a.at(n - 1, n - 1))};
    for (unsigned k = n - 1; k-- > 0;) {
        checkpoint();
        const unsigned m = n - k;
        //S = A[k:, k:] = [s, R; C, B]: the Toeplitz matrix of 1, -s, -R C, -R B C, -R B^2 C…
        std::vector<Expr> diagonals{SymEngine::one, SymEngine::neg(a.at(k, k))};
        std::vector<Expr> w(m - 1);
        for (unsigned i = 0; i < m - 1; i++) w[i] = a.at(k + 1 + i, k);
        for (unsigned t = 0; t + 2 <= m; t++) {
            Expr product = SymEngine::zero;
            for (unsigned j = 0; j < m - 1; j++) product = plus(product, times(a.at(k, k + 1 + j), w[j]));
            diagonals.push_back(expanded(SymEngine::neg(product)));
            if (t + 3 <= m) {
                std::vector<Expr> next(m - 1);
                for (unsigned i = 0; i < m - 1; i++) {
                    Expr sum = SymEngine::zero;
                    for (unsigned j = 0; j < m - 1; j++) sum = plus(sum, times(a.at(k + 1 + i, k + 1 + j), w[j]));
                    next[i] = expanded(sum);
                }
                w = std::move(next);
            }
        }
        std::vector<Expr> result(m + 1);
        for (unsigned i = 0; i <= m; i++) {
            Expr sum = SymEngine::zero;
            for (unsigned j = 0; j < m && j <= i; j++) sum = plus(sum, times(diagonals[i - j], vector[j]));
            result[i] = expanded(sum);
        }
        vector = std::move(result);
    }
    return vector;
}

//A minor: the matrix without a row and a column
MatrixPointer minorOf(const ExpressionMatrix &a, unsigned row, unsigned column)
{
    std::vector<Expr> elements;
    elements.reserve(static_cast<size_t>(a.rows - 1) * (a.columns - 1));
    for (unsigned i = 0; i < a.rows; i++) {
        if (i == row) continue;
        for (unsigned j = 0; j < a.columns; j++) {
            if (j != column) elements.push_back(a.at(i, j));
        }
    }
    return matrixOf(a.rows - 1, a.columns - 1, std::move(elements));
}

//Gauss-Jordan of a matrix of numbers on its first columns, with divisions: the reduced row echelon form of them, the
//other columns transformed with them; the columns of the pivots
std::vector<unsigned> eliminateNumbers(Rows &m, unsigned columns)
{
    std::vector<unsigned> pivots;
    unsigned row = 0;
    for (unsigned column = 0; column < columns && row < m.size(); column++) {
        checkpoint();
        size_t found = row;
        while (found < m.size() && structurallyZero(m[found][column])) found++;
        if (found == m.size()) continue;
        std::swap(m[row], m[found]);
        const Expr pivot = m[row][column];
        for (Expr &element : m[row]) element = SymEngine::div(element, pivot);
        for (size_t i = 0; i < m.size(); i++) {
            if (i == row || structurallyZero(m[i][column])) continue;
            const Expr factor = m[i][column];
            for (size_t j = 0; j < m[i].size(); j++) m[i][j] = minus(m[i][j], times(factor, m[row][j]));
        }
        pivots.push_back(column);
        row++;
    }
    return pivots;
}

//The elimination of a matrix with other elements on its first columns, without divisions (row i becomes p row i - f
//row k, expanded), each pivot row divided by its pivot at the end: single fractions of polynomials
std::vector<unsigned> eliminateExpressions(Rows &m, unsigned columns)
{
    std::vector<unsigned> pivots;
    unsigned row = 0;
    for (unsigned column = 0; column < columns && row < m.size(); column++) {
        checkpoint();
        size_t found = m.size();
        for (size_t i = row; i < m.size(); i++) {
            if (knownZero(m[i][column])) {
                m[i][column] = SymEngine::zero;
            } else if (found == m.size()) {
                found = i;
            }
        }
        if (found == m.size()) continue;
        std::swap(m[row], m[found]);
        const Expr pivot = m[row][column];
        for (size_t i = 0; i < m.size(); i++) {
            if (i == row) continue;
            const Expr factor = m[i][column];
            if (knownZero(factor)) {
                m[i][column] = SymEngine::zero;
                continue;
            }
            for (size_t j = 0; j < m[i].size(); j++) m[i][j] = expanded(minus(times(pivot, m[i][j]), times(factor, m[row][j])));
            m[i][column] = SymEngine::zero;
        }
        pivots.push_back(column);
        row++;
    }
    for (size_t k = 0; k < pivots.size(); k++) {
        const Expr pivot = m[k][pivots[k]];
        for (size_t j = 0; j < m[k].size(); j++) m[k][j] = j == pivots[k] ? Expr(SymEngine::one) : (structurallyZero(m[k][j]) ? m[k][j] : SymEngine::div(m[k][j], pivot));
    }
    return pivots;
}

std::vector<unsigned> eliminate(Rows &m, unsigned columns, bool numbers)
{
    return numbers ? eliminateNumbers(m, columns) : eliminateExpressions(m, columns);
}

struct Echelon {
    Rows rows;
    std::vector<unsigned> pivots;
};

Echelon rrefOf(const ExpressionMatrix &a)
{
    Echelon echelon{rowsOf(a), {}};
    echelon.pivots = eliminate(echelon.rows, a.columns, numeric(a));
    return echelon;
}

//The basis of the null space of a matrix, from its reduced row echelon form: a vector for each column without pivot
std::vector<MatrixPointer> nullspaceOf(const ExpressionMatrix &a)
{
    const Echelon echelon = rrefOf(a);
    std::vector<MatrixPointer> basis;
    std::vector<bool> isPivot(a.columns, false);
    for (const unsigned pivot : echelon.pivots) isPivot[pivot] = true;
    for (unsigned free = 0; free < a.columns; free++) {
        if (isPivot[free]) continue;
        std::vector<Expr> vector(a.columns, SymEngine::zero);
        vector[free] = SymEngine::one;
        for (size_t k = 0; k < echelon.pivots.size(); k++) vector[echelon.pivots[k]] = SymEngine::neg(echelon.rows[k][free]);
        basis.push_back(matrixOf(a.columns, 1, std::move(vector)));
    }
    return basis;
}

//The solutions of A X = B, A square and not singular
MatrixPointer solveOfMatrix(const ExpressionMatrix &a, const ExpressionMatrix &b)
{
    requireSquare(a, "solve() (rref() solves the other systems)");
    if (b.rows != a.rows) throw MathError(ErrorCode::Argument, "The right side of a system of " + std::to_string(a.rows) + " equations has " + std::to_string(a.rows) + " rows, not " + std::to_string(b.rows));
    if (numeric(a) && numeric(b)) {
        Rows m = rowsOf(a);
        for (unsigned i = 0; i < a.rows; i++) m[i].insert(m[i].end(), b.elements.begin() + static_cast<long>(i) * b.columns, b.elements.begin() + static_cast<long>(i + 1) * b.columns);
        const std::vector<unsigned> pivots = eliminateNumbers(m, a.columns);
        if (pivots.size() < a.rows) throw MathError(ErrorCode::Domain, "The matrix is singular");
        Rows x(a.rows);
        for (unsigned i = 0; i < a.rows; i++) x[i].assign(m[i].begin() + a.columns, m[i].end());
        return matrixOfElements(x, b.columns);
    }
    //Cramer's rule: det(A with the column i replaced by the column of B) / det(A)
    const Expr determinant = determinantOf(a);
    if (knownZero(determinant)) throw MathError(ErrorCode::Domain, "The matrix is singular");
    std::vector<Expr> elements(static_cast<size_t>(a.rows) * b.columns);
    for (unsigned column = 0; column < b.columns; column++) {
        for (unsigned i = 0; i < a.rows; i++) {
            std::vector<Expr> replaced = a.elements;
            for (unsigned r = 0; r < a.rows; r++) replaced[static_cast<size_t>(r) * a.columns + i] = b.at(r, column);
            const Expr numerator = determinantOf(*matrixOf(a.rows, a.columns, std::move(replaced)));
            elements[static_cast<size_t>(i) * b.columns + column] = structurallyZero(numerator) ? numerator : Expr(SymEngine::div(numerator, determinant));
        }
    }
    return matrixOf(a.rows, b.columns, std::move(elements));
}

//The characteristic polynomial det(x I - A) in a variable
Expr characteristicPolynomialOf(const ExpressionMatrix &a, const std::string &variable)
{
    requireSquare(a, "The characteristic polynomial");
    for (const Expr &element : a.elements) {
        for (const std::string &name : variablesOf(element)) {
            if (name == variable) throw MathError(ErrorCode::Argument, "The variable " + variable + " of the characteristic polynomial is in the matrix: name another one");
        }
    }
    const std::vector<Expr> coefficients = berkowitz(a);
    const Expr x = SymEngine::symbol(variable);
    Expr polynomial = SymEngine::zero;
    for (size_t k = 0; k < coefficients.size(); k++) polynomial = plus(polynomial, times(coefficients[k], SymEngine::pow(x, SymEngine::integer(static_cast<long>(coefficients.size() - 1 - k)))));
    return polynomial;
}

//The eigenvalues of a square matrix and their algebraic multiplicities: the elements of its diagonal that are roots of
//its characteristic polynomial first (a triangular matrix, a block of one element: a and b for [a, 0; 0, b], where the
//formula of the quadratic gives sqrt((a - b)^2)), divided out; then the roots of the polynomial left, each with the
//number of its derivatives that are 0 there
std::vector<std::pair<Expr, unsigned>> eigenvaluesOf(const ExpressionMatrix &a)
{
    requireSquare(a, "The eigenvalues");
    const std::string variable = "eigenvalue_";
    const Expr x = SymEngine::symbol(variable);
    Expr polynomial = characteristicPolynomialOf(a, variable);
    const auto degreeOf = [&variable](const Expr &p) { return coefficientsOf(p, variable).size() - 1; };
    std::vector<std::pair<Expr, unsigned>> values;
    unsigned total = 0;
    for (unsigned i = 0; i < a.rows; i++) {
        const Expr candidate = a.at(i, i);
        bool known = false;
        for (const auto &[value, multiplicity] : values) known = known || knownZero(minus(value, candidate));
        if (known) continue;
        unsigned multiplicity = 0;
        while (degreeOf(polynomial) >= 1 && knownZero(substitute(polynomial, {{variable, candidate}}))) {
            polynomial = expanded(divideOf(polynomial, minus(x, candidate), variable).first);
            multiplicity++;
        }
        if (multiplicity > 0) {
            values.emplace_back(candidate, multiplicity);
            total += multiplicity;
        }
    }
    if (degreeOf(polynomial) >= 1) {
        const Solutions solutions = solveOf(polynomial, variable, false);
        if (solutions.kind != "finite") throw MathError(ErrorCode::NotSupported, "The eigenvalues of the matrix are not found exactly: linalg.eigen() gives them as numbers");
        for (const Expr &value : solutions.values) {
            unsigned multiplicity = 1;
            Expr derivative = polynomial;
            while (multiplicity < a.rows) {
                derivative = differentiate(derivative, variable, 1);
                if (!knownZero(substitute(derivative, {{variable, value}}))) break;
                multiplicity++;
            }
            values.emplace_back(value, multiplicity);
            total += multiplicity;
        }
    }
    if (total != a.rows) throw MathError(ErrorCode::NotSupported, "The eigenvalues of the matrix are not found exactly: linalg.eigen() gives them as numbers");
    //Numbers sorted by their real parts, then their imaginary ones (as the roots of polynomials)
    bool numbers = true;
    for (const auto &entry : values) numbers = numbers && variablesOf(entry.first).empty();
    if (numbers) {
        std::vector<std::pair<std::complex<double>, std::pair<Expr, unsigned>>> keyed;
        for (const auto &entry : values) keyed.emplace_back(toComplex(entry.first), entry);
        std::stable_sort(keyed.begin(), keyed.end(), [](const auto &x, const auto &y) { return x.first.real() < y.first.real() || (x.first.real() == y.first.real() && x.first.imag() < y.first.imag()); });
        values.clear();
        for (const auto &entry : keyed) values.push_back(entry.second);
    }
    return values;
}

MatrixPointer elementwise(const ExpressionMatrix &a, const std::function<Expr(const Expr &)> &operation)
{
    std::vector<Expr> elements;
    elements.reserve(a.elements.size());
    for (const Expr &element : a.elements) {
        elements.push_back(operation(element));
        checkpoint();
    }
    return matrixOf(a.rows, a.columns, std::move(elements));
}

unsigned indexOf(double value, unsigned size, const char *what)
{
    if (!(value >= 0 && value < size && value == std::floor(value))) throw MathError(ErrorCode::Argument, std::string(what) + " is an integer from 0 to " + std::to_string(size - 1) + ", not " + shortest(value));
    return static_cast<unsigned>(value);
}

const MatrixPointer &matrixArgument(const std::vector<MatrixPointer> &matrices, size_t index)
{
    if (index >= matrices.size()) throw MathError(ErrorCode::Argument, "A matrix is missing");
    return matrices[index];
}

const Expr &expressionArgument(const std::vector<Expr> &expressions, size_t index)
{
    if (index >= expressions.size()) throw MathError(ErrorCode::Argument, "An expression is missing");
    return expressions[index];
}

double numberArgument(const std::vector<double> &numbers, size_t index)
{
    if (index >= numbers.size()) throw MathError(ErrorCode::Argument, "A number is missing");
    return numbers[index];
}

}

MatrixPointer matrixOf(unsigned rows, unsigned columns, std::vector<Expr> elements)
{
    auto matrix = std::make_shared<ExpressionMatrix>();
    matrix->rows = rows;
    matrix->columns = columns;
    matrix->elements = std::move(elements);
    return matrix;
}

MatrixPointer matrixOfRows(const std::vector<std::vector<Expr>> &rows)
{
    if (rows.empty() || rows[0].empty()) throw MathError(ErrorCode::Argument, "A matrix has at least one element");
    for (const auto &row : rows) {
        if (row.size() != rows[0].size()) throw MathError(ErrorCode::Argument, "The rows of a matrix are of the same length: " + std::to_string(rows[0].size()) + " and " + std::to_string(row.size()));
    }
    return matrixOfElements(rows, static_cast<unsigned>(rows[0].size()));
}

bool knownZero(const Expr &element)
{
    const Expr x = expanded(element);
    if (structurallyZero(x)) return true;
    const std::vector<std::string> names = variablesOf(x);
    if (names.empty()) return constantZero(x);
    //With variables: 0 at two values of them, exactly (a rational function 0 at both is 0, but on a set of measure 0)
    for (int point = 0; point < 2; point++) {
        std::vector<std::pair<std::string, Expr>> values;
        for (size_t k = 0; k < names.size(); k++) values.emplace_back(names[k], valueOf(k, point));
        Expr at;
        try {
            at = expanded(substitute(x, values));
        } catch (const MathError &error) {
            if (error.code() == ErrorCode::Cancelled || error.code() == ErrorCode::Timeout) throw;
            return false;
        }
        if (!constantZero(at)) return false;
    }
    return true;
}

MatrixPointer addMatrices(const ExpressionMatrix &a, const ExpressionMatrix &b, bool subtract)
{
    if (a.rows != b.rows || a.columns != b.columns) {
        throw MathError(ErrorCode::Argument, std::string("Matrices of ") + std::to_string(a.rows) + "×" + std::to_string(a.columns) + " and " + std::to_string(b.rows) + "×" + std::to_string(b.columns) + " are not " + (subtract ? "subtracted" : "added"));
    }
    std::vector<Expr> elements(a.elements.size());
    for (size_t i = 0; i < elements.size(); i++) elements[i] = subtract ? minus(a.elements[i], b.elements[i]) : plus(a.elements[i], b.elements[i]);
    return matrixOf(a.rows, a.columns, std::move(elements));
}

MatrixPointer multiplyMatrices(const ExpressionMatrix &a, const ExpressionMatrix &b)
{
    if (a.columns != b.rows) throw MathError(ErrorCode::Argument, "A matrix of " + std::to_string(a.rows) + "×" + std::to_string(a.columns) + " is not multiplied by one of " + std::to_string(b.rows) + "×" + std::to_string(b.columns));
    std::vector<Expr> elements(static_cast<size_t>(a.rows) * b.columns);
    for (unsigned i = 0; i < a.rows; i++) {
        checkpoint();
        for (unsigned j = 0; j < b.columns; j++) {
            Expr sum = SymEngine::zero;
            for (unsigned k = 0; k < a.columns; k++) sum = plus(sum, times(a.at(i, k), b.at(k, j)));
            elements[static_cast<size_t>(i) * b.columns + j] = sum;
        }
    }
    return matrixOf(a.rows, b.columns, std::move(elements));
}

MatrixPointer scaleMatrix(const ExpressionMatrix &a, const Expr &factor)
{
    return elementwise(a, [&factor](const Expr &element) { return times(factor, element); });
}

MatrixPointer transposeOf(const ExpressionMatrix &a)
{
    std::vector<Expr> elements(a.elements.size());
    for (unsigned i = 0; i < a.rows; i++) {
        for (unsigned j = 0; j < a.columns; j++) elements[static_cast<size_t>(j) * a.rows + i] = a.at(i, j);
    }
    return matrixOf(a.columns, a.rows, std::move(elements));
}

Expr traceOf(const ExpressionMatrix &a)
{
    requireSquare(a, "The trace");
    Expr sum = SymEngine::zero;
    for (unsigned i = 0; i < a.rows; i++) sum = plus(sum, a.at(i, i));
    return sum;
}

Expr determinantOf(const ExpressionMatrix &a)
{
    requireSquare(a, "The determinant");
    if (numeric(a)) {
        Rows m = rowsOf(a);
        //The product of the pivots of the elimination, its sign by the exchanges of rows
        Expr product = SymEngine::one;
        for (unsigned column = 0; column < a.columns; column++) {
            checkpoint();
            size_t found = column;
            while (found < m.size() && structurallyZero(m[found][column])) found++;
            if (found == m.size()) return SymEngine::zero;
            if (found != column) {
                std::swap(m[column], m[found]);
                product = SymEngine::neg(product);
            }
            const Expr pivot = m[column][column];
            product = times(product, pivot);
            for (size_t i = column + 1; i < m.size(); i++) {
                if (structurallyZero(m[i][column])) continue;
                const Expr factor = SymEngine::div(m[i][column], pivot);
                for (size_t j = column; j < a.columns; j++) m[i][j] = minus(m[i][j], times(factor, m[column][j]));
            }
        }
        return product;
    }
    const std::vector<Expr> coefficients = berkowitz(a);
    const Expr last = coefficients.back();
    return a.rows % 2 == 0 ? last : expanded(Expr(SymEngine::neg(last)));
}

MatrixPointer inverseOf(const ExpressionMatrix &a)
{
    requireSquare(a, "The inverse");
    if (numeric(a)) return solveOfMatrix(a, *identityOf(a.rows));
    const Expr determinant = determinantOf(a);
    if (knownZero(determinant)) throw MathError(ErrorCode::Domain, "The matrix is singular");
    const unsigned n = a.rows;
    if (n == 1) return matrixOf(1, 1, {SymEngine::div(SymEngine::one, a.at(0, 0))});
    //The adjugate divided by the determinant: the element (i, j) is the cofactor (j, i)
    std::vector<Expr> elements(static_cast<size_t>(n) * n);
    for (unsigned i = 0; i < n; i++) {
        for (unsigned j = 0; j < n; j++) {
            Expr cofactor = determinantOf(*minorOf(a, j, i));
            if ((i + j) % 2 == 1) cofactor = expanded(SymEngine::neg(cofactor));
            elements[static_cast<size_t>(i) * n + j] = structurallyZero(cofactor) ? cofactor : Expr(SymEngine::div(cofactor, determinant));
        }
    }
    return matrixOf(n, n, std::move(elements));
}

MatrixPointer powerOfMatrix(const ExpressionMatrix &a, const Expr &exponent)
{
    requireSquare(a, "A power");
    if (!is_a<SymEngine::Integer>(*exponent)) throw MathError(ErrorCode::NotSupported, "A matrix is raised to an integer power, not to " + toText(exponent));
    const std::string text = down_cast<const SymEngine::Integer &>(*exponent).__str__();
    if (text.size() > 7) throw MathError(ErrorCode::NotSupported, "A matrix is raised to a power of at most 10^6, not " + text);
    long power = std::stol(text);
    MatrixPointer base = power < 0 ? inverseOf(a) : matrixOf(a.rows, a.columns, a.elements);
    if (power < 0) power = -power;
    MatrixPointer result = identityOf(a.rows);
    //By squaring, each product expanded
    while (power > 0) {
        if (power & 1) result = elementwise(*multiplyMatrices(*result, *base), [](const Expr &element) { return expanded(element); });
        power >>= 1;
        if (power > 0) base = elementwise(*multiplyMatrices(*base, *base), [](const Expr &element) { return expanded(element); });
    }
    return result;
}

std::string matrixText(const ExpressionMatrix &a)
{
    std::string text = "[";
    for (unsigned i = 0; i < a.rows; i++) {
        if (i > 0) text += "; ";
        for (unsigned j = 0; j < a.columns; j++) {
            if (j > 0) text += ", ";
            text += toText(a.at(i, j));
        }
    }
    return text + "]";
}

std::string matrixTeX(const ExpressionMatrix &a)
{
    std::string text = "\\begin{bmatrix}";
    for (unsigned i = 0; i < a.rows; i++) {
        if (i > 0) text += " \\\\ ";
        for (unsigned j = 0; j < a.columns; j++) {
            if (j > 0) text += " & ";
            text += toTeX(a.at(i, j));
        }
    }
    return text + "\\end{bmatrix}";
}

size_t matrixMemory(const ExpressionMatrix &a)
{
    size_t memory = 64;
    for (const Expr &element : a.elements) memory += expressionMemory(element);
    return memory;
}

Napi::Value wrapMatrix(Napi::Env env, const MatrixPointer &matrix)
{
    for (const Expr &element : matrix->elements) checkDepth(element);
    return wrap(env, std::const_pointer_cast<ExpressionMatrix>(matrix), MATRIX_TAG, static_cast<int64_t>(matrixMemory(*matrix)));
}

MatrixPointer unwrapMatrix(const Napi::Value &value)
{
    return unwrap<ExpressionMatrix>(value, MATRIX_TAG, "a matrix of expressions");
}

ExpressionMatrixResult matrixOperation(const std::string &operation, const std::vector<MatrixPointer> &matrices, const std::vector<Expr> &expressions, const std::vector<double> &numbers, const std::vector<std::string> &names)
{
    ExpressionMatrixResult result;
    const auto first = [&]() -> const ExpressionMatrix & { return *matrixArgument(matrices, 0); };
    const auto second = [&]() -> const ExpressionMatrix & { return *matrixArgument(matrices, 1); };
    if (operation == "fromRows") {
        //expressions row by row, numbers [rows, columns]
        const double rows = numberArgument(numbers, 0), columns = numberArgument(numbers, 1);
        if (!(rows >= 1 && columns >= 1 && rows * columns == static_cast<double>(expressions.size()))) throw MathError(ErrorCode::Argument, "A matrix has at least one element, its rows of the same length");
        result.matrix = matrixOf(static_cast<unsigned>(rows), static_cast<unsigned>(columns), expressions);
    } else if (operation == "fromNumbers") {
        //numbers [rows, columns, elements…]: the decimals they print as
        const double rows = numberArgument(numbers, 0), columns = numberArgument(numbers, 1);
        if (!(rows >= 1 && columns >= 1 && rows * columns + 2 == static_cast<double>(numbers.size()))) throw MathError(ErrorCode::Argument, "A matrix has at least one element");
        std::vector<Expr> elements;
        for (size_t i = 2; i < numbers.size(); i++) {
            if (!std::isfinite(numbers[i])) throw MathError(ErrorCode::Argument, "The elements of a matrix are finite numbers");
            elements.push_back(numberFromDouble(numbers[i]));
        }
        result.matrix = matrixOf(static_cast<unsigned>(rows), static_cast<unsigned>(columns), std::move(elements));
    } else if (operation == "get") {
        const ExpressionMatrix &a = first();
        result.expression = a.at(indexOf(numberArgument(numbers, 0), a.rows, "A row"), indexOf(numberArgument(numbers, 1), a.columns, "A column"));
    } else if (operation == "elements") {
        result.expressions = first().elements;
    } else if (operation == "with") {
        const ExpressionMatrix &a = first();
        std::vector<Expr> elements = a.elements;
        elements[static_cast<size_t>(indexOf(numberArgument(numbers, 0), a.rows, "A row")) * a.columns + indexOf(numberArgument(numbers, 1), a.columns, "A column")] = expressionArgument(expressions, 0);
        result.matrix = matrixOf(a.rows, a.columns, std::move(elements));
    } else if (operation == "submatrix") {
        const ExpressionMatrix &a = first();
        const unsigned row = indexOf(numberArgument(numbers, 0), a.rows, "The first row"), column = indexOf(numberArgument(numbers, 1), a.columns, "The first column");
        const double rows = numberArgument(numbers, 2), columns = numberArgument(numbers, 3);
        if (!(rows >= 1 && columns >= 1 && rows == std::floor(rows) && columns == std::floor(columns) && row + rows <= a.rows && column + columns <= a.columns)) {
            throw MathError(ErrorCode::Argument, "The submatrix is within the matrix, of at least one row and one column");
        }
        std::vector<Expr> elements;
        for (unsigned i = row; i < row + static_cast<unsigned>(rows); i++) {
            for (unsigned j = column; j < column + static_cast<unsigned>(columns); j++) elements.push_back(a.at(i, j));
        }
        result.matrix = matrixOf(static_cast<unsigned>(rows), static_cast<unsigned>(columns), std::move(elements));
    } else if (operation == "transpose") {
        result.matrix = transposeOf(first());
    } else if (operation == "neg") {
        result.matrix = elementwise(first(), [](const Expr &element) { return SymEngine::neg(element); });
    } else if (operation == "add" || operation == "sub") {
        result.matrix = addMatrices(first(), second(), operation == "sub");
    } else if (operation == "mul") {
        result.matrix = multiplyMatrices(first(), second());
    } else if (operation == "scale") {
        result.matrix = scaleMatrix(first(), expressionArgument(expressions, 0));
    } else if (operation == "divide") {
        const Expr divisor = expressionArgument(expressions, 0);
        if (knownZero(divisor)) throw MathError(ErrorCode::DivisionByZero, "A matrix divided by 0");
        result.matrix = elementwise(first(), [&divisor](const Expr &element) { return SymEngine::div(element, divisor); });
    } else if (operation == "multiplyElements") {
        const ExpressionMatrix &a = first(), &b = second();
        if (a.rows != b.rows || a.columns != b.columns) throw MathError(ErrorCode::Argument, "The matrices multiplied element by element are of the same dimensions");
        std::vector<Expr> elements(a.elements.size());
        for (size_t i = 0; i < elements.size(); i++) elements[i] = times(a.elements[i], b.elements[i]);
        result.matrix = matrixOf(a.rows, a.columns, std::move(elements));
    } else if (operation == "pow") {
        result.matrix = powerOfMatrix(first(), expressionArgument(expressions, 0));
    } else if (operation == "trace") {
        result.expression = traceOf(first());
    } else if (operation == "determinant") {
        result.expression = determinantOf(first());
    } else if (operation == "inverse") {
        result.matrix = inverseOf(first());
    } else if (operation == "solve") {
        result.matrix = solveOfMatrix(first(), second());
    } else if (operation == "rref") {
        const Echelon echelon = rrefOf(first());
        result.matrix = matrixOfElements(echelon.rows, first().columns);
        result.numbers.assign(echelon.pivots.begin(), echelon.pivots.end());
    } else if (operation == "rank") {
        result.numbers.push_back(static_cast<double>(rrefOf(first()).pivots.size()));
    } else if (operation == "nullspace") {
        result.matrices = nullspaceOf(first());
    } else if (operation == "characteristicPolynomial") {
        if (names.empty() || !isName(names[0])) throw MathError(ErrorCode::Argument, "The variable of the characteristic polynomial is a name");
        result.expression = characteristicPolynomialOf(first(), names[0]);
    } else if (operation == "eigenvalues" || operation == "eigenvectors") {
        const ExpressionMatrix &a = first();
        for (const auto &[value, multiplicity] : eigenvaluesOf(a)) {
            result.expressions.push_back(value);
            result.numbers.push_back(multiplicity);
            if (operation == "eigenvectors") {
                std::vector<Expr> shifted = a.elements;
                for (unsigned i = 0; i < a.rows; i++) shifted[static_cast<size_t>(i) * a.columns + i] = minus(shifted[static_cast<size_t>(i) * a.columns + i], value);
                const std::vector<MatrixPointer> vectors = nullspaceOf(*matrixOf(a.rows, a.columns, std::move(shifted)));
                //An eigenvalue has an eigenvector: none is found where its form is 0 only for some values of the
                //variables (a root of a square of them)
                if (vectors.empty()) throw MathError(ErrorCode::NotSupported, "The eigenvectors of the eigenvalue " + toText(value) + " are not found exactly");
                result.numbers.push_back(static_cast<double>(vectors.size()));
                result.matrices.insert(result.matrices.end(), vectors.begin(), vectors.end());
            }
        }
    } else if (operation == "diff") {
        if (names.empty() || !isName(names[0])) throw MathError(ErrorCode::Argument, "The variable is a name");
        const double times = numbers.empty() ? 1 : numbers[0];
        if (times < 1 || times > 1000 || times != std::floor(times)) throw MathError(ErrorCode::Argument, "The number of derivatives is an integer from 1 to 1000");
        const std::string variable = names[0];
        result.matrix = elementwise(first(), [&variable, times](const Expr &element) { return differentiate(element, variable, static_cast<unsigned>(times)); });
    } else if (operation == "substitute") {
        if (names.size() != expressions.size()) throw MathError(ErrorCode::Argument, "A value for each variable");
        std::vector<std::pair<std::string, Expr>> values;
        for (size_t i = 0; i < names.size(); i++) values.emplace_back(names[i], expressions[i]);
        result.matrix = elementwise(first(), [&values](const Expr &element) { return substitute(element, values); });
    } else if (operation == "expand") {
        result.matrix = elementwise(first(), [](const Expr &element) { return expandOf(element); });
    } else if (operation == "simplify") {
        result.matrix = elementwise(first(), [](const Expr &element) { return simplifyOf(element); });
    } else if (operation == "equals") {
        const ExpressionMatrix &a = first(), &b = second();
        bool equal = a.rows == b.rows && a.columns == b.columns;
        for (size_t i = 0; equal && i < a.elements.size(); i++) equal = equalsOf(a.elements[i], b.elements[i]);
        result.numbers.push_back(equal ? 1 : 0);
    } else if (operation == "jacobian") {
        if (expressions.empty() || names.empty()) throw MathError(ErrorCode::Argument, "A Jacobian is of expressions by variables, at least one of each");
        std::vector<Expr> elements;
        for (const Expr &function : expressions) {
            for (const std::string &name : names) {
                if (!isName(name)) throw MathError(ErrorCode::Argument, "The variables are names: " + name + " is not one");
                elements.push_back(differentiate(function, name, 1));
            }
        }
        result.matrix = matrixOf(static_cast<unsigned>(expressions.size()), static_cast<unsigned>(names.size()), std::move(elements));
    } else if (operation == "toNumbers") {
        for (const Expr &element : first().elements) {
            if (!variablesOf(element).empty()) throw MathError(ErrorCode::Argument, "The element " + toText(element) + " has variables: substitute them first");
            result.numbers.push_back(toDouble(element));
        }
    } else if (operation == "text") {
        result.text = matrixText(first());
    } else if (operation == "tex") {
        result.text = matrixTeX(first());
    } else {
        throw MathError(ErrorCode::Argument, "Unknown operation of a matrix of expressions: " + operation);
    }
    return result;
}

}
