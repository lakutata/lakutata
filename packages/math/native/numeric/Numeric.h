//The numeric solutions: the roots of polynomials, of a function, of a system of equations; integrals; ordinary
//differential equations (math.numeric). The expressions are compiled by each operation (CompiledFunction), with their
//derivatives where an operation needs them.
#pragma once

#include <complex>
#include <cstddef>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "../core/Handle.h"

namespace math {

//The roots of a polynomial, in the complex numbers, sorted by their real parts then their imaginary ones
struct ComplexRoots {
    std::vector<double> re;
    std::vector<double> im;
};

//Of a polynomial in a variable whose coefficients are numbers (MathError Argument otherwise)
ComplexRoots polynomialRootsOf(const Expr &polynomial, const std::string &variable);

//Of its coefficients from the constant term up
ComplexRoots polynomialRootsOf(const std::vector<std::complex<double>> &ascending);

//The result of an iterative method: its solution, whether its steps became smaller than the tolerance (or the bracket
//narrower), the iterations, the residual (|f| at the root, the norm of the residuals of a system)
struct IterativeResult {
    std::vector<double> solution;
    bool converged = false;
    size_t iterations = 0;
    double residual = 0;
};

//A root of a function of a variable: in a bracket where its sign changes (TOMS 748), or from a guess (Newton's method,
//with the symbolic derivative)
IterativeResult findRootOf(const Expr &function, const std::string &variable, std::optional<std::pair<double, double>> bracket, std::optional<double> guess, double tolerance, size_t maxIterations);

//A solution of a system of equations (expressions equal to 0) in variables, from a guess: Newton's method with the
//symbolic Jacobian and a line search, Levenberg-Marquardt's steps where it fails
IterativeResult solveSystemOf(const std::vector<Expr> &equations, const std::vector<std::string> &variables, const std::vector<double> &guess, double tolerance, size_t maxIterations);

//An integral: its value, the estimate of its error, whether the error is within the tolerance times the integral of
//the absolute value of the function
struct IntegralResult {
    double value = 0;
    double error = 0;
    bool converged = false;
};

//The integral of a function of a variable from a to b (either infinite), the interval split at the points (where the
//function is singular or jumps): MathError Domain where the function is not real, or infinite with no finite integral
IntegralResult integralOf(const Expr &function, const std::string &variable, double a, double b, const std::vector<double> &points, double tolerance);

//A double by its 17 significant digits, without the zeros that end them (for the messages)
std::string shortest(double value);

}
