//Ordinary differential equations, y' = f(t, y) from t0 to t1: by the explicit Runge-Kutta method of Dormand and Prince
//of order 5 with an embedded one of order 4 and its continuous extension of order 4 (as SciPy's RK45, MATLAB's ode45),
//or, for stiff equations, by the implicit Runge-Kutta method Radau IIA of order 5 (as SciPy's Radau, Hairer and
//Wanner's RADAU5) with the exact Jacobian of the compiled derivatives. The steps follow SciPy's solve_ivp: the same
//initial step, the same control of the step size, the same simplified Newton iterations. The constants of Radau IIA
//are derived from the closed forms of its table.
#include "Numeric.h"

#include <algorithm>
#include <cmath>
#include <complex>
#include <limits>

#include <Eigen/Dense>
#include <Eigen/Eigenvalues>

#include <symengine/derivative.h>
#include <symengine/symbol.h>

#include "Compiled.h"
#include "../async/Pool.h"
#include "../core/Errors.h"
#include "../ops/Operations.h"

namespace math {

namespace {

using Vector = Eigen::VectorXd;
using Matrix = Eigen::MatrixXd;

constexpr double SAFETY = 0.9, MIN_FACTOR = 0.2, MAX_FACTOR = 10;
constexpr double INFINITE = std::numeric_limits<double>::infinity();

//The root mean square of a vector: the norm of the errors
double rms(const Vector &x)
{
    return x.size() == 0 ? 0 : std::sqrt(x.squaredNorm() / static_cast<double>(x.size()));
}

//The derivatives compiled as functions of the time and the states, and their Jacobian (compiled when it is needed)
class System {
public:
    System(const std::vector<Expr> &derivatives, const std::vector<std::string> &states, const std::string &time) : derivatives(derivatives), names(inputsOf(states, time)), compiled(names, derivatives), size(states.size()), inputs(states.size() + 1)
    {
    }

    Vector operator()(double t, const Vector &y)
    {
        inputs[0] = t;
        for (Eigen::Index i = 0; i < y.size(); i++) inputs[static_cast<size_t>(i) + 1] = y[i];
        Vector f(static_cast<Eigen::Index>(size));
        compiled.call(f.data(), inputs.data());
        if (++evaluations % 64 == 0) checkpoint();
        return f;
    }

    //The Jacobian: the derivatives by the states
    Matrix jacobian(double t, const Vector &y)
    {
        if (!jacobianFunction) {
            std::vector<Expr> entries;
            for (const Expr &derivative : derivatives) {
                for (size_t j = 1; j < names.size(); j++) entries.push_back(derivative->diff(SymEngine::symbol(names[j])));
            }
            jacobianFunction.emplace(names, entries);
        }
        inputs[0] = t;
        for (Eigen::Index i = 0; i < y.size(); i++) inputs[static_cast<size_t>(i) + 1] = y[i];
        const Eigen::Index n = static_cast<Eigen::Index>(size);
        Eigen::Matrix<double, Eigen::Dynamic, Eigen::Dynamic, Eigen::RowMajor> J(n, n);
        jacobianFunction->call(J.data(), inputs.data());
        jacobians++;
        return J;
    }

    size_t evaluations = 0, jacobians = 0;

private:
    static std::vector<std::string> inputsOf(const std::vector<std::string> &states, const std::string &time)
    {
        std::vector<std::string> inputs{time};
        inputs.insert(inputs.end(), states.begin(), states.end());
        return inputs;
    }

    std::vector<Expr> derivatives;
    std::vector<std::string> names;
    CompiledFunction compiled;
    std::optional<CompiledFunction> jacobianFunction;
    size_t size;
    std::vector<double> inputs;
};

//The times and the states given back: every step, or the points asked (by the continuous extension of each step)
class Output {
public:
    Output(const std::vector<double> &points, double direction, ODEResult &result) : points(points), direction(direction), result(result)
    {
    }

    void start(double t0, const Vector &y0)
    {
        if (points.empty()) {
            record(t0, y0);
            return;
        }
        while (next < points.size() && points[next] == t0) {
            record(t0, y0);
            next++;
        }
    }

    //A step to tNew, its continuous extension dense(t) within it
    template <typename Dense>
    void step(double tNew, const Vector &yNew, const Dense &dense)
    {
        if (points.empty()) {
            record(tNew, yNew);
            return;
        }
        while (next < points.size() && direction * (points[next] - tNew) <= 0) {
            const double t = points[next++];
            record(t, t == tNew ? yNew : dense(t));
        }
    }

private:
    void record(double t, const Vector &y)
    {
        result.t.push_back(t);
        result.y.insert(result.y.end(), y.data(), y.data() + y.size());
    }

    const std::vector<double> &points;
    double direction;
    size_t next = 0;
    ODEResult &result;
};

struct Settings {
    double rtol, atol, maxStep;
    size_t maxSteps;
};

//The first step (Hairer, Norsett and Wanner, as SciPy's select_initial_step): from the sizes of the states, of their
//derivatives and of the second derivatives estimated, for a method of an order
double initialStep(System &system, double t0, const Vector &y0, double t1, const Vector &f0, double direction, int order, const Settings &settings)
{
    const double length = std::abs(t1 - t0);
    if (y0.size() == 0) return length;
    const Vector scale = settings.atol + y0.array().abs() * settings.rtol;
    const double d0 = rms(y0.cwiseQuotient(scale)), d1 = rms(f0.cwiseQuotient(scale));
    double h0 = d0 < 1e-5 || d1 < 1e-5 ? 1e-6 : 0.01 * d0 / d1;
    h0 = std::min(h0, length);
    const Vector y1 = y0 + h0 * direction * f0;
    const Vector f1 = system(t0 + h0 * direction, y1);
    const double d2 = rms((f1 - f0).cwiseQuotient(scale)) / h0;
    const double h1 = d1 <= 1e-15 && d2 <= 1e-15 ? std::max(1e-6, h0 * 1e-3) : std::pow(0.01 / std::max(d1, d2), 1.0 / (order + 1));
    const double h = std::min({100 * h0, h1, length, settings.maxStep});
    return std::isfinite(h) ? h : std::min(length, settings.maxStep);
}

//The smallest step at t: 10 times the spacing of the doubles there
double minimumStep(double t, double direction)
{
    return 10 * std::abs(std::nextafter(t, direction * INFINITE) - t);
}

std::string at(double t)
{
    return "at t = " + shortest(t);
}

//Dormand and Prince's method of order 5 (4), its continuous extension of order 4 (Hairer's DOPRI5, SciPy's RK45)
void dormandPrince(System &system, double t0, double t1, const Vector &y0, const Settings &settings, Output &output, ODEResult &result)
{
    static constexpr double C[7] = {0, 1.0 / 5, 3.0 / 10, 4.0 / 5, 8.0 / 9, 1, 1};
    static constexpr double A[7][6] = {
        {0, 0, 0, 0, 0, 0},
        {1.0 / 5, 0, 0, 0, 0, 0},
        {3.0 / 40, 9.0 / 40, 0, 0, 0, 0},
        {44.0 / 45, -56.0 / 15, 32.0 / 9, 0, 0, 0},
        {19372.0 / 6561, -25360.0 / 2187, 64448.0 / 6561, -212.0 / 729, 0, 0},
        {9017.0 / 3168, -355.0 / 33, 46732.0 / 5247, 49.0 / 176, -5103.0 / 18656, 0},
        {35.0 / 384, 0, 500.0 / 1113, 125.0 / 192, -2187.0 / 6784, 11.0 / 84}};
    //The weights of order 5 less those of order 4: the error
    static constexpr double E[7] = {71.0 / 57600, 0, -71.0 / 16695, 71.0 / 1920, -17253.0 / 339200, 22.0 / 525, -1.0 / 40};
    //The continuous extension (DOPRI5's contd5)
    static constexpr double D[7] = {-12715105075.0 / 11282082432, 0, 87487479700.0 / 32700410799, -10690763975.0 / 1880347072, 701980252875.0 / 199316789632, -1453857185.0 / 822651844, 69997945.0 / 29380423};
    const double direction = t1 >= t0 ? 1 : -1;
    const Eigen::Index n = y0.size();
    double t = t0;
    Vector y = y0, f = system(t, y);
    if (!f.allFinite()) throw MathError(ErrorCode::Domain, "The derivatives are not real at the start");
    output.start(t, y);
    double hAbs = initialStep(system, t, y, t1, f, direction, 4, settings);
    Matrix K(n, 7);
    while (direction * (t - t1) < 0) {
        if (result.steps >= settings.maxSteps) {
            result.message = "More than " + std::to_string(settings.maxSteps) + " steps, " + at(t) + ": the equations may be stiff (method 'radau')";
            return;
        }
        const double minStep = minimumStep(t, direction);
        hAbs = std::clamp(hAbs, minStep, std::max(minStep, settings.maxStep));
        bool accepted = false, rejected = false;
        double h = 0, tNew = t;
        Vector yNew, fNew;
        while (!accepted) {
            if (hAbs < minStep) {
                result.message = "The step became too small " + at(t);
                return;
            }
            h = hAbs * direction;
            tNew = t + h;
            if (direction * (tNew - t1) > 0) tNew = t1;
            h = tNew - t;
            hAbs = std::abs(h);
            K.col(0) = f;
            for (int s = 1; s < 6; s++) {
                Vector stage = y;
                for (int j = 0; j < s; j++) stage += h * A[s][j] * K.col(j);
                K.col(s) = system(t + C[s] * h, stage);
            }
            yNew = y;
            for (int j = 0; j < 6; j++) yNew += h * A[6][j] * K.col(j);
            fNew = system(tNew, yNew);
            K.col(6) = fNew;
            const Vector scale = settings.atol + y.array().abs().max(yNew.array().abs()) * settings.rtol;
            Vector error = Vector::Zero(n);
            for (int j = 0; j < 7; j++) error += E[j] * K.col(j);
            double errorNorm = rms((h * error).cwiseQuotient(scale));
            //A stage that is not real (sqrt(y) of a step too long): rejected
            if (!std::isfinite(errorNorm) || !yNew.allFinite()) errorNorm = INFINITE;
            if (errorNorm < 1) {
                double factor = errorNorm == 0 ? MAX_FACTOR : std::min(MAX_FACTOR, SAFETY * std::pow(errorNorm, -0.2));
                if (rejected) factor = std::min(1.0, factor);
                hAbs *= factor;
                accepted = true;
            } else {
                hAbs *= std::max(MIN_FACTOR, SAFETY * std::pow(errorNorm, -0.2));
                rejected = true;
                result.rejected++;
            }
        }
        result.steps++;
        const Vector change = yNew - y, first = h * K.col(0) - change, second = change - h * K.col(6) - first;
        Vector fifth = Vector::Zero(n);
        for (int j = 0; j < 7; j++) fifth += D[j] * K.col(j);
        fifth *= h;
        const double tOld = t;
        const Vector yOld = y;
        output.step(tNew, yNew, [&](double at) {
            const double theta = (at - tOld) / h, rest = 1 - theta;
            return Vector(yOld + theta * (change + rest * (first + theta * (second + rest * fifth))));
        });
        t = tNew;
        y = yNew;
        f = fNew;
    }
    result.completed = true;
}

//The table of Radau IIA of order 5 and the constants of its iterations, derived from its closed forms: its stages c,
//its matrix A; the eigenvalues of A^-1, a real one and a complex pair, by which T makes the Newton iterations two
//systems (T^-1 A^-1 T = [mu, 0, 0; 0, alpha, beta; 0, -beta, alpha]); the error estimate of Hairer (an embedded
//method of order 3 of weight 1/mu on f(t0, y0)); the cubic of collocation through the stages
struct RadauTable {
    Eigen::Vector3d c;
    Eigen::Matrix3d T, TI, P;
    double mu;
    std::complex<double> muComplex;
    Eigen::Vector3d E;
};

const RadauTable &radauTable()
{
    static const RadauTable *table = [] {
        auto *built = new RadauTable();
        const double s6 = std::sqrt(6.0);
        built->c << (4 - s6) / 10, (4 + s6) / 10, 1;
        Eigen::Matrix3d A;
        A << (88 - 7 * s6) / 360, (296 - 169 * s6) / 1800, (-2 + 3 * s6) / 225,
            (296 + 169 * s6) / 1800, (88 + 7 * s6) / 360, (-2 - 3 * s6) / 225,
            (16 - s6) / 36, (16 + s6) / 36, 1.0 / 9;
        const Eigen::Matrix3d inverse = A.inverse();
        const Eigen::EigenSolver<Eigen::Matrix3d> eigen(inverse);
        int real = 0, complex = 0;
        for (int i = 0; i < 3; i++) {
            if (std::abs(eigen.eigenvalues()[i].imag()) < 1e-12) real = i;
            else if (eigen.eigenvalues()[i].imag() > 0) complex = i;
        }
        built->T.col(0) = eigen.eigenvectors().col(real).real();
        built->T.col(1) = eigen.eigenvectors().col(complex).real();
        built->T.col(2) = eigen.eigenvectors().col(complex).imag();
        built->TI = built->T.inverse();
        const Eigen::Matrix3d lambda = built->TI * inverse * built->T;
        built->mu = lambda(0, 0);
        built->muComplex = {lambda(1, 1), -lambda(1, 2)};
        //The embedded weights: 1/mu on f(t0, y0), the others of order 3 with it
        Eigen::Matrix3d powers;
        powers.row(0).setOnes();
        powers.row(1) = built->c.transpose();
        powers.row(2) = built->c.cwiseProduct(built->c).transpose();
        const Eigen::Vector3d embedded = powers.partialPivLu().solve(Eigen::Vector3d(1 - 1 / built->mu, 0.5, 1.0 / 3));
        built->E = built->mu * (inverse.transpose() * (embedded - A.row(2).transpose()));
        //The cubic through (0, 0) and (c_i, Z_i): its coefficients P Z
        Eigen::Matrix3d vandermonde;
        for (int i = 0; i < 3; i++) {
            for (int k = 0; k < 3; k++) vandermonde(i, k) = std::pow(built->c[i], k + 1);
        }
        built->P = vandermonde.inverse();
        return built;
    }();
    return *table;
}

//Radau IIA of order 5, as SciPy's Radau: simplified Newton iterations on the stages (at most 6, by the LU
//decompositions of mu/h I - J and of its complex counterpart), the Jacobian computed again when they converge slowly
void radau(System &system, double t0, double t1, const Vector &y0, const Settings &settings, Output &output, ODEResult &result)
{
    constexpr int NEWTON_MAX_ITERATIONS = 6;
    const RadauTable &table = radauTable();
    const double direction = t1 >= t0 ? 1 : -1;
    const Eigen::Index n = y0.size();
    const Eigen::MatrixXd identity = Eigen::MatrixXd::Identity(n, n);
    const double newtonTolerance = std::max(10 * std::numeric_limits<double>::epsilon() / settings.rtol, std::min(0.03, std::sqrt(settings.rtol)));
    double t = t0;
    Vector y = y0, f = system(t, y);
    if (!f.allFinite()) throw MathError(ErrorCode::Domain, "The derivatives are not real at the start");
    output.start(t, y);
    double hAbs = initialStep(system, t, y, t1, f, direction, 3, settings), hAbsOld = NAN, errorNormOld = NAN;
    Matrix J = system.jacobian(t, y);
    bool currentJacobian = true;
    std::optional<Eigen::PartialPivLU<Eigen::MatrixXd>> luReal;
    std::optional<Eigen::PartialPivLU<Eigen::MatrixXcd>> luComplex;
    //The collocation cubic of the last step: y(tOld + theta hOld) = yOld + Q^T [theta, theta^2, theta^3]
    std::optional<Matrix> Q;
    double tOld = t, hOld = 0;
    Vector yOld = y;
    const auto collocation = [&](double at) {
        const double theta = (at - tOld) / hOld;
        return Vector(yOld + Q->transpose() * Eigen::Vector3d(theta, theta * theta, theta * theta * theta));
    };
    const auto predictFactor = [&](double hNow, double errorNorm) {
        const double multiplier = std::isnan(errorNormOld) || std::isnan(hAbsOld) || errorNorm == 0 ? 1 : hNow / hAbsOld * std::pow(errorNormOld / errorNorm, 0.25);
        return std::min(1.0, multiplier) * std::pow(errorNorm, -0.25);
    };
    while (direction * (t - t1) < 0) {
        if (result.steps >= settings.maxSteps) {
            result.message = "More than " + std::to_string(settings.maxSteps) + " steps " + at(t);
            return;
        }
        const double minStep = minimumStep(t, direction);
        //A step limited: the predictions of the last step dropped (as SciPy)
        if (hAbs > settings.maxStep || hAbs < minStep) {
            hAbs = std::clamp(hAbs, minStep, std::max(minStep, settings.maxStep));
            hAbsOld = NAN;
            errorNormOld = NAN;
        }
        bool accepted = false, rejected = false;
        double h = 0, tNew = t, errorNorm = 0, rate = NAN, safety = SAFETY;
        int iterations = 0;
        Matrix Z(3, n);
        Vector yNew;
        while (!accepted) {
            if (hAbs < minStep) {
                result.message = "The step became too small " + at(t);
                return;
            }
            h = hAbs * direction;
            tNew = t + h;
            if (direction * (tNew - t1) > 0) tNew = t1;
            h = tNew - t;
            hAbs = std::abs(h);
            //The stages guessed from the collocation cubic of the last step
            Matrix Z0 = Matrix::Zero(3, n);
            if (Q) {
                for (int i = 0; i < 3; i++) Z0.row(i) = (collocation(t + h * table.c[i]) - y).transpose();
                if (!Z0.allFinite()) Z0.setZero();
            }
            const Vector scale = settings.atol + y.array().abs() * settings.rtol;
            bool converged = false;
            while (!converged) {
                if (!luReal || !luComplex) {
                    luReal.emplace(table.mu / h * identity - J);
                    luComplex.emplace((table.muComplex / h) * identity.cast<std::complex<double>>() - J.cast<std::complex<double>>());
                }
                //The simplified Newton iterations on W = T^-1 Z
                Matrix W = table.TI * Z0;
                Z = Z0;
                double normOld = NAN;
                rate = NAN;
                converged = false;
                Matrix F(3, n);
                for (iterations = 1; iterations <= NEWTON_MAX_ITERATIONS; iterations++) {
                    bool finite = true;
                    for (int i = 0; i < 3 && finite; i++) {
                        F.row(i) = system(t + h * table.c[i], y + Z.row(i).transpose()).transpose();
                        finite = F.row(i).allFinite();
                    }
                    if (!finite) break;
                    const Vector fReal = F.transpose() * table.TI.row(0).transpose() - table.mu / h * W.row(0).transpose();
                    const Eigen::VectorXcd fComplex = (F.transpose() * table.TI.row(1).transpose()).cast<std::complex<double>>() + std::complex<double>(0, 1) * (F.transpose() * table.TI.row(2).transpose()).cast<std::complex<double>>() - (table.muComplex / h) * (W.row(1).transpose().cast<std::complex<double>>() + std::complex<double>(0, 1) * W.row(2).transpose().cast<std::complex<double>>());
                    const Vector dReal = luReal->solve(fReal);
                    const Eigen::VectorXcd dComplex = luComplex->solve(fComplex);
                    Matrix dW(3, n);
                    dW.row(0) = dReal.transpose();
                    dW.row(1) = dComplex.real().transpose();
                    dW.row(2) = dComplex.imag().transpose();
                    Vector scaled(3 * n);
                    for (int i = 0; i < 3; i++) scaled.segment(i * n, n) = dW.row(i).transpose().cwiseQuotient(scale);
                    const double norm = rms(scaled);
                    if (!std::isnan(normOld)) rate = norm / normOld;
                    if (!std::isnan(rate) && (rate >= 1 || std::pow(rate, NEWTON_MAX_ITERATIONS - iterations + 1) / (1 - rate) * norm > newtonTolerance)) break;
                    W += dW;
                    Z = table.T * W;
                    if (norm == 0 || (!std::isnan(rate) && rate / (1 - rate) * norm < newtonTolerance)) {
                        converged = true;
                        break;
                    }
                    normOld = norm;
                }
                if (iterations > NEWTON_MAX_ITERATIONS) iterations = NEWTON_MAX_ITERATIONS;
                if (!converged) {
                    if (currentJacobian) break;
                    J = system.jacobian(t, y);
                    currentJacobian = true;
                    luReal.reset();
                    luComplex.reset();
                }
            }
            if (!converged) {
                hAbs *= 0.5;
                luReal.reset();
                luComplex.reset();
                result.rejected++;
                continue;
            }
            yNew = y + Z.row(2).transpose();
            const Vector ZE = Z.transpose() * table.E / h;
            Vector error = luReal->solve(f + ZE);
            const Vector errorScale = settings.atol + y.array().abs().max(yNew.array().abs()) * settings.rtol;
            errorNorm = rms(error.cwiseQuotient(errorScale));
            safety = 0.9 * (2 * NEWTON_MAX_ITERATIONS + 1) / (2 * NEWTON_MAX_ITERATIONS + iterations);
            if (rejected && errorNorm > 1) {
                error = luReal->solve(system(t, y + error) + ZE);
                errorNorm = rms(error.cwiseQuotient(errorScale));
            }
            if (!std::isfinite(errorNorm) || !yNew.allFinite()) errorNorm = INFINITE;
            if (errorNorm > 1) {
                hAbs *= std::max(MIN_FACTOR, safety * predictFactor(hAbs, errorNorm));
                luReal.reset();
                luComplex.reset();
                rejected = true;
                result.rejected++;
            } else {
                accepted = true;
            }
        }
        result.steps++;
        const bool recomputeJacobian = iterations > 2 && !std::isnan(rate) && rate > 1e-3;
        double factor = std::min(MAX_FACTOR, safety * predictFactor(hAbs, errorNorm));
        if (!recomputeJacobian && factor < 1.2) {
            factor = 1;
        } else {
            luReal.reset();
            luComplex.reset();
        }
        const Vector fNew = system(tNew, yNew);
        if (recomputeJacobian) {
            J = system.jacobian(tNew, yNew);
            currentJacobian = true;
        } else {
            currentJacobian = false;
        }
        hAbsOld = hAbs;
        errorNormOld = errorNorm;
        hAbs *= factor;
        Q = table.P * Z;
        tOld = t;
        hOld = h;
        yOld = y;
        output.step(tNew, yNew, collocation);
        t = tNew;
        y = yNew;
        f = fNew;
    }
    result.completed = true;
}

}

ODEResult solveODEOf(const std::vector<Expr> &derivatives, const std::vector<std::string> &states, const std::string &time, double t0, double t1, const std::vector<double> &initial, const ODEOptions &options)
{
    if (derivatives.size() != states.size() || initial.size() != states.size()) throw MathError(ErrorCode::Argument, "The derivatives, the states and the initial values are as many");
    if (states.empty()) throw MathError(ErrorCode::Argument, "The system has no state");
    for (size_t i = 0; i < states.size(); i++) {
        if (states[i] == time) throw MathError(ErrorCode::Argument, "The time " + time + " is not a state");
        for (size_t j = 0; j < i; j++) {
            if (states[j] == states[i]) throw MathError(ErrorCode::Argument, "The state " + states[i] + " is given twice");
        }
    }
    if (!std::isfinite(t0) || !std::isfinite(t1)) throw MathError(ErrorCode::Argument, "The span is of finite times");
    for (const double value : initial) {
        if (!std::isfinite(value)) throw MathError(ErrorCode::Argument, "The initial values are finite numbers");
    }
    if (!(options.relativeTolerance > 0) || !(options.absoluteTolerance >= 0) || !std::isfinite(options.absoluteTolerance)) throw MathError(ErrorCode::Argument, "The relative tolerance is above 0, the absolute one 0 or more");
    if (!(options.maxStep > 0)) throw MathError(ErrorCode::Argument, "The largest step is above 0");
    if (options.method != "rk45" && options.method != "radau") throw MathError(ErrorCode::Argument, "The method is 'rk45' or 'radau', not '" + options.method + "'");
    const double direction = t1 >= t0 ? 1 : -1;
    for (size_t i = 0; i < options.points.size(); i++) {
        const double point = options.points[i];
        if (!(direction * (point - t0) >= 0 && direction * (t1 - point) >= 0)) throw MathError(ErrorCode::Argument, "The points are in the span: " + shortest(point) + " is not");
        if (i > 0 && direction * (point - options.points[i - 1]) < 0) throw MathError(ErrorCode::Argument, "The points are sorted from the start of the span to its end");
    }
    for (const Expr &derivative : derivatives) {
        for (const std::string &name : variablesOf(derivative)) {
            if (name != time && std::find(states.begin(), states.end(), name) == states.end()) throw MathError(ErrorCode::Argument, "The derivatives have a variable that is neither a state nor the time " + time + ": " + name);
        }
    }
    std::optional<System> system;
    system.emplace(derivatives, states, time);
    ODEResult result;
    //Below 100 times the epsilon, the relative tolerance cannot be reached (as SciPy)
    const Settings settings{std::max(options.relativeTolerance, 100 * std::numeric_limits<double>::epsilon()), options.absoluteTolerance, options.maxStep, options.maxSteps};
    Output output(options.points, direction, result);
    const Vector y0 = Eigen::Map<const Vector>(initial.data(), static_cast<Eigen::Index>(initial.size()));
    if (t0 == t1) {
        output.start(t0, y0);
        result.completed = true;
    } else if (options.method == "rk45") {
        dormandPrince(*system, t0, t1, y0, settings, output, result);
    } else {
        radau(*system, t0, t1, y0, settings, output, result);
    }
    result.evaluations = system->evaluations;
    result.jacobians = system->jacobians;
    return result;
}

}
