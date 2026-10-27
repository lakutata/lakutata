//The roots: of polynomials by the eigenvalues of their companion matrices (balanced first, as LAPACK does for NumPy's
//roots, then polished by Newton's method in the complex numbers), of a function by TOMS 748 in a bracket or by Newton's
//method from a guess, of a system by Newton's method with a line search and Levenberg-Marquardt's steps.
#include "Numeric.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <limits>

#include <Eigen/Dense>
#include <Eigen/Eigenvalues>

#include <boost_math_policy.h>

#include <boost/math/tools/toms748_solve.hpp>

#include <symengine/derivative.h>
#include <symengine/symbol.h>

#include "Compiled.h"
#include "../async/Pool.h"
#include "../core/Errors.h"
#include "../ops/Operations.h"

namespace math {

namespace {

using Complex = std::complex<double>;

//Parlett and Reinsch's balancing (Numerical Recipes' balanc): the rows and the columns scaled by powers of 2 until
//their norms are close, which keeps the eigenvalues and makes them accurate
template <typename Matrix>
void balance(Matrix &a)
{
    const double radix = 2, square = radix * radix;
    const Eigen::Index n = a.rows();
    for (bool done = false; !done;) {
        done = true;
        for (Eigen::Index i = 0; i < n; i++) {
            double c = 0, r = 0;
            for (Eigen::Index j = 0; j < n; j++) {
                if (j == i) continue;
                c += std::abs(a(j, i));
                r += std::abs(a(i, j));
            }
            if (c == 0 || r == 0) continue;
            double g = r / radix, f = 1;
            const double s = c + r;
            while (c < g) {
                f *= radix;
                c *= square;
            }
            g = r * radix;
            while (c > g) {
                f /= radix;
                c /= square;
            }
            if ((c + r) / f < 0.95 * s) {
                done = false;
                a.row(i) /= f;
                a.col(i) *= f;
            }
        }
    }
}

//p(z) and p'(z) by Horner's scheme, the coefficients from the constant term up
std::pair<Complex, Complex> hornerOf(const std::vector<Complex> &ascending, Complex z)
{
    Complex value = 0, derivative = 0;
    for (size_t i = ascending.size(); i-- > 0;) {
        derivative = derivative * z + value;
        value = value * z + ascending[i];
    }
    return {value, derivative};
}

//The NaN of a function inside an interval: the solvers of Boost may assert on it, so it stops them
struct NotReal {
    double at;
};

//A double by its 17 significant digits, without the zeros that end them
std::string shortest(double value)
{
    char text[32];
    std::snprintf(text, sizeof(text), "%.17g", value);
    return text;
}

}

ComplexRoots polynomialRootsOf(const std::vector<Complex> &given)
{
    //The leading zeros dropped, the zero roots counted
    std::vector<Complex> ascending = given;
    while (!ascending.empty() && ascending.back() == 0.0) ascending.pop_back();
    if (ascending.empty()) throw MathError(ErrorCode::Domain, "Every number is a root of the polynomial 0");
    for (const Complex &coefficient : ascending) {
        if (!std::isfinite(coefficient.real()) || !std::isfinite(coefficient.imag())) throw MathError(ErrorCode::Argument, "A coefficient of the polynomial is not finite");
    }
    size_t zeros = 0;
    while (ascending[zeros] == 0.0) zeros++;
    const std::vector<Complex> reduced(ascending.begin() + static_cast<std::ptrdiff_t>(zeros), ascending.end());
    const Eigen::Index n = static_cast<Eigen::Index>(reduced.size()) - 1;
    std::vector<Complex> roots(zeros, 0.0);
    if (n > 0) {
        //The companion matrix of the monic polynomial: its first row -c[n-1]/c[n] … -c[0]/c[n], ones below the diagonal
        const bool real = std::all_of(reduced.begin(), reduced.end(), [](const Complex &c) { return c.imag() == 0; });
        Eigen::VectorXcd eigenvalues;
        if (real) {
            Eigen::MatrixXd companion = Eigen::MatrixXd::Zero(n, n);
            for (Eigen::Index j = 0; j < n; j++) companion(0, j) = -reduced[static_cast<size_t>(n - 1 - j)].real() / reduced[static_cast<size_t>(n)].real();
            for (Eigen::Index i = 1; i < n; i++) companion(i, i - 1) = 1;
            balance(companion);
            checkpoint();
            Eigen::EigenSolver<Eigen::MatrixXd> solver(companion, false);
            if (solver.info() != Eigen::Success) throw MathError(ErrorCode::NotSupported, "The roots of the polynomial did not converge");
            eigenvalues = solver.eigenvalues();
        } else {
            Eigen::MatrixXcd companion = Eigen::MatrixXcd::Zero(n, n);
            for (Eigen::Index j = 0; j < n; j++) companion(0, j) = -reduced[static_cast<size_t>(n - 1 - j)] / reduced[static_cast<size_t>(n)];
            for (Eigen::Index i = 1; i < n; i++) companion(i, i - 1) = 1;
            balance(companion);
            checkpoint();
            Eigen::ComplexEigenSolver<Eigen::MatrixXcd> solver(companion, false);
            if (solver.info() != Eigen::Success) throw MathError(ErrorCode::NotSupported, "The roots of the polynomial did not converge");
            eigenvalues = solver.eigenvalues();
        }
        //Polished by Newton's method, a step kept where it makes |p| smaller
        for (Eigen::Index k = 0; k < n; k++) {
            Complex z = eigenvalues[k];
            double size = std::abs(hornerOf(reduced, z).first);
            for (int step = 0; step < 8 && size > 0; step++) {
                const auto [value, derivative] = hornerOf(reduced, z);
                if (derivative == 0.0) break;
                const Complex next = z - value / derivative;
                const double nextSize = std::abs(hornerOf(reduced, next).first);
                if (!(nextSize < size)) break;
                z = next;
                size = nextSize;
            }
            //A real polynomial: its real roots stay real
            if (real && eigenvalues[k].imag() == 0) z = Complex(z.real(), 0);
            roots.push_back(z);
        }
    }
    std::sort(roots.begin(), roots.end(), [](const Complex &a, const Complex &b) { return a.real() != b.real() ? a.real() < b.real() : a.imag() < b.imag(); });
    ComplexRoots result;
    for (const Complex &root : roots) {
        result.re.push_back(root.real());
        result.im.push_back(root.imag() == 0 ? 0 : root.imag());
    }
    return result;
}

ComplexRoots polynomialRootsOf(const Expr &polynomial, const std::string &variable)
{
    std::vector<Complex> ascending;
    for (const Expr &coefficient : coefficientsOf(polynomial, variable)) {
        if (!variablesOf(coefficient).empty()) throw MathError(ErrorCode::Argument, "A coefficient of the polynomial in " + variable + " is not a number");
        ascending.push_back(toComplex(coefficient));
    }
    return polynomialRootsOf(ascending);
}

IterativeResult findRootOf(const Expr &function, const std::string &variable, std::optional<std::pair<double, double>> bracket, std::optional<double> guess, double tolerance, size_t maxIterations)
{
    if (!(tolerance >= 0) || !std::isfinite(tolerance)) throw MathError(ErrorCode::Argument, "The tolerance is a number of 0 or more");
    IterativeResult result;
    if (bracket) {
        CompiledFunction f({variable}, {function});
        size_t calls = 0;
        const auto value = [&](double x) {
            double y = 0;
            f.call(&y, &x);
            if (++calls % 64 == 0) checkpoint();
            if (std::isnan(y)) throw NotReal{x};
            return y;
        };
        double a = bracket->first, b = bracket->second;
        if (!(std::isfinite(a) && std::isfinite(b) && a < b)) throw MathError(ErrorCode::Argument, "A bracket is [a, b] of finite numbers, a < b");
        try {
            const double fa = value(a), fb = value(b);
            if (fa == 0 || fb == 0) {
                result.solution = {fa == 0 ? a : b};
                result.converged = true;
                return result;
            }
            if ((fa > 0) == (fb > 0)) throw MathError(ErrorCode::Domain, "The function has the same sign at both ends of the bracket");
            std::uintmax_t iterations = maxIterations;
            //Narrow to the tolerance relative to the root, or to the first bracket for a root at 0 (as SciPy's brentq
            //has an absolute tolerance too)
            const double width = b - a;
            const auto narrow = [tolerance, width](double low, double high) { return std::abs(high - low) <= tolerance * (std::max(std::abs(low), std::abs(high)) + width); };
            //TOMS 748 for half the iterations, then bisections in its bracket: near a multiple root its steps shrink
            //the bracket slowly, a bisection halves it ((x - 1)^3 on [0, 3] needs about 120 steps of TOMS 748)
            iterations = std::max<std::uintmax_t>(maxIterations / 2, std::min<std::uintmax_t>(maxIterations, 1));
            const std::pair<double, double> found = boost::math::tools::toms748_solve(value, a, b, fa, fb, narrow, iterations, lakutata::BoostPolicy());
            double low = found.first, high = found.second, fLow = value(low), fHigh = value(high);
            size_t used = static_cast<size_t>(iterations);
            while (!narrow(low, high) && fLow != 0 && fHigh != 0 && used < maxIterations) {
                const double middle = low + (high - low) / 2, fMiddle = value(middle);
                used++;
                if (fMiddle == 0 || middle == low || middle == high) {
                    low = high = middle;
                    fLow = fHigh = fMiddle;
                } else if ((fMiddle > 0) == (fLow > 0)) {
                    low = middle;
                    fLow = fMiddle;
                } else {
                    high = middle;
                    fHigh = fMiddle;
                }
            }
            //The end of the bracket of the smaller value
            result.solution = {std::abs(fLow) <= std::abs(fHigh) ? low : high};
            result.residual = std::min(std::abs(fLow), std::abs(fHigh));
            result.iterations = used;
            result.converged = result.residual == 0 || narrow(low, high);
        } catch (const NotReal &failure) {
            throw MathError(ErrorCode::Domain, "The function is not real at " + shortest(failure.at) + ", in the bracket");
        }
        return result;
    }
    //Newton's method from the guess: damped (the step halved while |f| grows), a secant where f' is 0 or not finite
    const Expr derivative = function->diff(SymEngine::symbol(variable));
    CompiledFunction f({variable}, {function, derivative});
    double x = guess.value_or(0), values[2];
    if (!std::isfinite(x)) throw MathError(ErrorCode::Argument, "The guess is a finite number");
    f.call(values, &x);
    if (std::isnan(values[0])) throw MathError(ErrorCode::Domain, "The function is not real at the guess");
    double previousX = NAN, previousF = NAN;
    for (size_t iteration = 1; iteration <= maxIterations; iteration++) {
        checkpoint();
        result.iterations = iteration;
        const double fx = values[0], slope = values[1];
        if (fx == 0) {
            result.converged = true;
            break;
        }
        double step;
        if (slope != 0 && std::isfinite(slope)) {
            step = fx / slope;
        } else if (std::isfinite(previousX) && previousF != fx) {
            step = fx * (x - previousX) / (fx - previousF);
        } else {
            const double h = 1e-8 * (1 + std::abs(x)), shifted = x + h;
            double ahead[2];
            f.call(ahead, &shifted);
            step = ahead[0] != fx && std::isfinite(ahead[0]) ? fx * h / (ahead[0] - fx) : NAN;
        }
        if (!std::isfinite(step)) break;
        double next = x - step, nextValues[2];
        f.call(nextValues, &next);
        //A step below the tolerance: the root, where |f| may not decrease any more (its roundings)
        if (std::abs(step) <= tolerance * (1 + std::abs(x))) {
            if (std::abs(nextValues[0]) <= std::abs(fx)) {
                x = next;
                values[0] = nextValues[0];
                values[1] = nextValues[1];
            }
            result.converged = true;
            break;
        }
        for (int halving = 0; halving < 40 && !(std::abs(nextValues[0]) < std::abs(fx)); halving++) {
            step /= 2;
            next = x - step;
            f.call(nextValues, &next);
        }
        if (!(std::abs(nextValues[0]) < std::abs(fx))) break;
        previousX = x;
        previousF = fx;
        x = next;
        values[0] = nextValues[0];
        values[1] = nextValues[1];
        if (std::abs(step) <= tolerance * (1 + std::abs(x))) {
            result.converged = true;
            break;
        }
    }
    result.solution = {x};
    result.residual = std::abs(values[0]);
    if (values[0] == 0) result.converged = true;
    return result;
}

IterativeResult solveSystemOf(const std::vector<Expr> &equations, const std::vector<std::string> &variables, const std::vector<double> &guess, double tolerance, size_t maxIterations)
{
    if (!(tolerance >= 0) || !std::isfinite(tolerance)) throw MathError(ErrorCode::Argument, "The tolerance is a number of 0 or more");
    const Eigen::Index n = static_cast<Eigen::Index>(equations.size()), m = static_cast<Eigen::Index>(variables.size());
    if (n == 0 || m == 0) throw MathError(ErrorCode::Argument, "A system has equations and variables");
    if (guess.size() != variables.size()) throw MathError(ErrorCode::Argument, "The guess has a value for each variable");
    //F and its Jacobian, compiled into one function: F[i], then J(i, j) = ∂F[i]/∂x[j] row by row
    std::vector<Expr> outputs(equations.begin(), equations.end());
    for (const Expr &equation : equations) {
        for (const std::string &variable : variables) outputs.push_back(equation->diff(SymEngine::symbol(variable)));
    }
    CompiledFunction system(variables, outputs);
    std::vector<double> buffer(outputs.size());
    Eigen::VectorXd x = Eigen::Map<const Eigen::VectorXd>(guess.data(), m), F(n);
    Eigen::MatrixXd J(n, m);
    const auto evaluate = [&](const Eigen::VectorXd &at, Eigen::VectorXd &values, Eigen::MatrixXd *jacobian) {
        system.call(buffer.data(), at.data());
        for (Eigen::Index i = 0; i < n; i++) values[i] = buffer[static_cast<size_t>(i)];
        if (jacobian) {
            for (Eigen::Index i = 0; i < n; i++) {
                for (Eigen::Index j = 0; j < m; j++) (*jacobian)(i, j) = buffer[static_cast<size_t>(n + i * m + j)];
            }
        }
        return values.allFinite() ? 0.5 * values.squaredNorm() : std::numeric_limits<double>::infinity();
    };
    if (!x.allFinite()) throw MathError(ErrorCode::Argument, "The guess is of finite numbers");
    double merit = evaluate(x, F, &J);
    if (!std::isfinite(merit)) throw MathError(ErrorCode::Domain, "The equations are not real at the guess");
    IterativeResult result;
    double lambda = -1;
    Eigen::VectorXd trial(m), trialF(n);
    for (size_t iteration = 1; iteration <= maxIterations; iteration++) {
        checkpoint();
        result.iterations = iteration;
        if (merit == 0) {
            result.converged = true;
            break;
        }
        bool accepted = false;
        Eigen::VectorXd step(m);
        double trialMerit = merit;
        //Newton's step, of a square system whose Jacobian has no zero pivot, along a line search on |F|^2 / 2
        if (n == m && J.allFinite()) {
            Eigen::PartialPivLU<Eigen::MatrixXd> lu(J);
            const auto diagonal = lu.matrixLU().diagonal();
            if ((diagonal.array() != 0).all()) {
                const Eigen::VectorXd newton = lu.solve(-F);
                //A step below the tolerance: the solution, where |F| may not decrease any more (its roundings)
                if (newton.allFinite() && newton.norm() <= tolerance * (1 + x.norm())) {
                    trial = x + newton;
                    if (evaluate(trial, trialF, nullptr) <= merit) {
                        x = trial;
                        merit = evaluate(x, F, &J);
                    }
                    result.converged = true;
                    break;
                }
                for (double t = 1; t >= 1.0 / 1024 && newton.allFinite(); t /= 2) {
                    trial = x + t * newton;
                    trialMerit = evaluate(trial, trialF, nullptr);
                    if (trialMerit <= (1 - 1e-4 * t) * merit) {
                        accepted = true;
                        step = t * newton;
                        break;
                    }
                }
            }
        }
        //Levenberg-Marquardt's steps: (JᵀJ + λ diag(JᵀJ)) δ = -JᵀF, λ larger until |F| decreases. Of more equations
        //than variables, until it does not increase: near their smallest residuals, |F| changes less than its roundings,
        //and a step that leaves it the same still nears the solution (of a square system, such a point is no solution)
        if (!accepted && J.allFinite()) {
            const Eigen::MatrixXd normal = J.transpose() * J;
            const Eigen::VectorXd gradient = J.transpose() * F;
            Eigen::VectorXd scale = normal.diagonal().cwiseMax(1e-12 * std::max(1.0, normal.diagonal().maxCoeff()));
            if (lambda < 0) lambda = 1e-3;
            for (int attempt = 0; attempt < 40 && !accepted; attempt++) {
                Eigen::MatrixXd damped = normal;
                damped.diagonal() += lambda * scale;
                const Eigen::VectorXd candidate = damped.ldlt().solve(-gradient);
                if (candidate.allFinite()) {
                    trial = x + candidate;
                    trialMerit = evaluate(trial, trialF, nullptr);
                    if (trialMerit < merit || (n > m && trialMerit == merit)) {
                        accepted = true;
                        step = candidate;
                        lambda = std::max(lambda / 3, 1e-12);
                        break;
                    }
                }
                lambda *= 4;
            }
        }
        //No step decreases the residuals: a point of their smallest values, the solution of a system of more equations
        //than variables (least squares), not one of a square system
        if (!accepted) {
            result.converged = n > m;
            break;
        }
        x = trial;
        merit = evaluate(x, F, &J);
        if (step.norm() <= tolerance * (1 + x.norm())) {
            result.converged = true;
            break;
        }
    }
    result.solution.assign(x.data(), x.data() + m);
    result.residual = F.norm();
    if (merit == 0) result.converged = true;
    return result;
}

}
