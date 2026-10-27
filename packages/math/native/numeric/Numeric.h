//The numeric solutions: the roots of polynomials, of a function, of a system of equations; integrals; ordinary
//differential equations (math.numeric). The expressions are compiled by each operation (CompiledFunction), with their
//derivatives where an operation needs them.
#pragma once

#include <complex>
#include <cstddef>
#include <limits>
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

//The options of an ordinary differential equation: its method ("rk45", or "radau" for stiff equations), its
//tolerances, its largest step, the times to give (the steps otherwise), its largest number of steps
struct ODEOptions {
    std::string method = "rk45";
    double relativeTolerance = 1e-6;
    double absoluteTolerance = 1e-9;
    double maxStep = std::numeric_limits<double>::infinity();
    std::vector<double> points;
    size_t maxSteps = 100000;
};

//The solution of an ordinary differential equation: its times, its states (a row of each time), its steps, its
//rejected steps, its evaluations of the derivatives and of the Jacobian, whether it reached the end of the span, why
//not
struct ODEResult {
    std::vector<double> t;
    std::vector<double> y;
    size_t steps = 0;
    size_t rejected = 0;
    size_t evaluations = 0;
    size_t jacobians = 0;
    bool completed = false;
    std::string message;
};

//The solution of y' = f(t, y), the derivatives of the states as expressions of the time and the states, from t0 to t1
//(t1 < t0 backward) from the initial values
ODEResult solveODEOf(const std::vector<Expr> &derivatives, const std::vector<std::string> &states, const std::string &time, double t0, double t1, const std::vector<double> &initial, const ODEOptions &options);

//A double by its 17 significant digits, without the zeros that end them (for the messages)
std::string shortest(double value);

}
