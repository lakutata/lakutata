//The functions of matrices on Eigen's decompositions: the exponential (Padé approximants with scaling and squaring,
//Higham 2005), the principal square root (by the complex Schur form, Björck and Hammarling 1983), and the solutions of
//the Sylvester and Lyapunov equations (Bartels and Stewart, on the complex Schur forms).
#include "LinalgSupport.h"

#include <algorithm>
#include <cmath>
#include <complex>
#include <limits>

#include <Eigen/Eigenvalues>
#include <Eigen/LU>

#include "../async/Pool.h"

namespace math {

namespace {

using Complex = std::complex<double>;

double oneNorm(const Eigen::MatrixXd &a)
{
    double norm = 0;
    for (Eigen::Index j = 0; j < a.cols(); j++) norm = std::max(norm, a.col(j).cwiseAbs().sum());
    return norm;
}

//The coefficients of the Padé approximants of degree 3, 5, 7 and 9 of the exponential, and the largest 1-norms each is
//accurate to the doubles for
const double PADE_3[] = {120, 60, 12, 1};
const double PADE_5[] = {30240, 15120, 3360, 420, 30, 1};
const double PADE_7[] = {17297280, 8648640, 1995840, 277200, 25200, 1512, 56, 1};
const double PADE_9[] = {17643225600, 8821612800, 2075673600, 302702400, 30270240, 2162160, 110880, 3960, 90, 1};
const double PADE_13[] = {64764752532480000., 32382376266240000., 7771770303897600., 1187353796428800., 129060195264000., 10559470521600., 670442572800., 33522128640., 1323241920., 40840800., 960960., 16380., 182., 1.};
const double THETA_LOW[] = {1.495585217958292e-2, 2.539398330063230e-1, 9.504178996162932e-1, 2.097847961257068};
const double THETA_13 = 5.371920351148152;

//exp(A): the Padé approximant (V - U)⁻¹ (V + U) of the smallest degree of 3, 5, 7 and 9 accurate for the 1-norm of A,
//otherwise the one of degree 13 of A / 2^s, squared s times (Higham, "The scaling and squaring method for the matrix
//exponential revisited", 2005). A matrix of an infinite or NaN element gives NaN.
Eigen::MatrixXd exponentialOf(const Eigen::MatrixXd &a)
{
    const Eigen::Index n = a.rows();
    const double norm = oneNorm(a);
    if (!std::isfinite(norm)) return Eigen::MatrixXd::Constant(n, n, std::numeric_limits<double>::quiet_NaN());
    const Eigen::MatrixXd identity = Eigen::MatrixXd::Identity(n, n);
    Eigen::MatrixXd u, v;
    int squarings = 0;
    const double *const low[] = {PADE_3, PADE_5, PADE_7, PADE_9};
    const int degrees[] = {3, 5, 7, 9};
    int degree = 13;
    for (int index = 0; index < 4; index++) {
        if (norm > THETA_LOW[index]) continue;
        degree = degrees[index];
        const double *b = low[index];
        const Eigen::MatrixXd square = a * a;
        Eigen::MatrixXd power = identity, odd = Eigen::MatrixXd::Zero(n, n), even = Eigen::MatrixXd::Zero(n, n);
        for (int k = 0; 2 * k < degree; k++) {
            if (k) power = power * square;
            odd += b[2 * k + 1] * power;
            even += b[2 * k] * power;
        }
        u = a * odd;
        v = even;
        break;
    }
    if (degree == 13) {
        squarings = std::max(0, static_cast<int>(std::ceil(std::log2(norm / THETA_13))));
        const Eigen::MatrixXd scaled = a * std::ldexp(1.0, -squarings);
        const double *b = PADE_13;
        const Eigen::MatrixXd a2 = scaled * scaled, a4 = a2 * a2, a6 = a4 * a2;
        u = scaled * (a6 * (b[13] * a6 + b[11] * a4 + b[9] * a2) + b[7] * a6 + b[5] * a4 + b[3] * a2 + b[1] * identity);
        v = a6 * (b[12] * a6 + b[10] * a4 + b[8] * a2) + b[6] * a6 + b[4] * a4 + b[2] * a2 + b[0] * identity;
    }
    checkpoint();
    Eigen::MatrixXd result = (v - u).partialPivLu().solve(v + u);
    for (int i = 0; i < squarings; i++) {
        checkpoint();
        result = result * result;
    }
    return result;
}

[[noreturn]] void noSquareRoot()
{
    throw MathError(ErrorCode::Domain, "The matrix has no principal square root");
}

//The principal square root: A = U T U* (complex Schur), R upper triangular of R² = T column by column (Björck and
//Hammarling), X = U R U*. Where A has no negative eigenvalue, its imaginary part is of the roundings and the root is
//its real part; otherwise the root is not real.
Eigen::MatrixXd squareRootOf(const Eigen::MatrixXd &a)
{
    const Eigen::Index n = a.rows();
    const Eigen::ComplexSchur<Eigen::MatrixXd> schur(a);
    if (schur.info() != Eigen::Success) throw MathError(ErrorCode::NotSupported, "The Schur form of the matrix did not converge");
    const Eigen::MatrixXcd &t = schur.matrixT();
    Eigen::MatrixXcd r = Eigen::MatrixXcd::Zero(n, n);
    for (Eigen::Index j = 0; j < n; j++) {
        r(j, j) = std::sqrt(t(j, j));
        for (Eigen::Index i = j - 1; i >= 0; i--) {
            Complex sum = t(i, j);
            for (Eigen::Index k = i + 1; k < j; k++) sum -= r(i, k) * r(k, j);
            const Complex denominator = r(i, i) + r(j, j);
            if (denominator == 0.0) {
                //Two eigenvalues of 0: a root only where its element is 0 too
                if (sum != 0.0) noSquareRoot();
                continue;
            }
            r(i, j) = sum / denominator;
        }
        checkpoint();
    }
    const Eigen::MatrixXcd root = schur.matrixU() * r * schur.matrixU().adjoint();
    if (!root.allFinite()) noSquareRoot();
    if (root.imag().norm() > std::sqrt(std::numeric_limits<double>::epsilon()) * root.norm()) {
        throw MathError(ErrorCode::Domain, "The principal square root of the matrix is not real: it has a negative eigenvalue");
    }
    return root.real();
}

//X of A X + X B = C: A = U S U*, B = V T V* (complex Schur), S Y + Y T = U* C V solved column by column as triangular
//systems, X = U Y V* (Bartels and Stewart). The solution is unique when no eigenvalue of A is the opposite of one of B:
//a system meeting a pivot of exactly 0 has none, as solve(), and throws the reason given
Eigen::MatrixXd sylvesterOf(const Eigen::MatrixXd &a, const Eigen::MatrixXd &b, const Eigen::MatrixXd &c, const char *reason)
{
    const auto noUniqueSolution = [reason]() {
        throw MathError(ErrorCode::Domain, std::string("The equation has no unique solution: ") + reason);
    };
    const Eigen::Index m = a.rows(), n = b.rows();
    if (m == 0 || n == 0) return Eigen::MatrixXd::Zero(m, n);
    const Eigen::ComplexSchur<Eigen::MatrixXd> left(a), right(b);
    if (left.info() != Eigen::Success || right.info() != Eigen::Success) throw MathError(ErrorCode::NotSupported, "The Schur form of the matrix did not converge");
    const Eigen::MatrixXcd &s = left.matrixT(), &t = right.matrixT();
    const Eigen::MatrixXcd f = left.matrixU().adjoint() * c.cast<Complex>() * right.matrixU();
    Eigen::MatrixXcd y(m, n);
    for (Eigen::Index k = 0; k < n; k++) {
        Eigen::VectorXcd side = f.col(k);
        for (Eigen::Index j = 0; j < k; j++) side -= t(j, k) * y.col(j);
        Eigen::MatrixXcd system = s;
        system.diagonal().array() += t(k, k);
        for (Eigen::Index i = 0; i < m; i++) {
            if (system(i, i) == 0.0) noUniqueSolution();
        }
        y.col(k) = system.triangularView<Eigen::Upper>().solve(side);
        checkpoint();
    }
    const Eigen::MatrixXd solution = (left.matrixU() * y * right.matrixU().adjoint()).real();
    if (!solution.allFinite() && c.allFinite() && a.allFinite() && b.allFinite()) noUniqueSolution();
    return solution;
}

}

bool matrixFunctionOf(const std::string &operation, const std::vector<MatrixArgument> &matrices, std::vector<MatrixResult> &results)
{
    if (operation == "exponential") {
        requireCount(matrices, 1, operation);
        requireSquare(matrices[0], "The matrix");
        results = {resultOf(exponentialOf(copyOf(matrices[0])))};
        return true;
    }
    if (operation == "squareRoot") {
        requireCount(matrices, 1, operation);
        requireSquare(matrices[0], "The matrix");
        if (matrices[0].rows == 0) {
            results = {resultOf(Eigen::MatrixXd(0, 0))};
            return true;
        }
        results = {resultOf(squareRootOf(copyOf(matrices[0])))};
        return true;
    }
    if (operation == "sylvester") {
        //A X + X B = C: A of m×m, B of n×n, C of m×n
        requireCount(matrices, 3, operation);
        requireSquare(matrices[0], "A");
        requireSquare(matrices[1], "B");
        requireRows(matrices[2], matrices[0].rows, "C");
        if (matrices[2].columns != matrices[1].rows) {
            throw MathError(ErrorCode::Argument, "C is " + std::to_string(matrices[2].rows) + "×" + std::to_string(matrices[2].columns) + ", not " + std::to_string(matrices[0].rows) + "×" + std::to_string(matrices[1].rows));
        }
        results = {resultOf(sylvesterOf(copyOf(matrices[0]), copyOf(matrices[1]), copyOf(matrices[2]), "an eigenvalue of A is the opposite of one of B"))};
        return true;
    }
    if (operation == "lyapunov") {
        //A P + P Aᵀ + Q = 0 (mathjs's lyap, MATLAB's): the Sylvester equation A P + P Aᵀ = -Q
        requireCount(matrices, 2, operation);
        requireSquare(matrices[0], "A");
        requireSquare(matrices[1], "Q");
        requireRows(matrices[1], matrices[0].rows, "Q");
        const Eigen::MatrixXd a = copyOf(matrices[0]);
        results = {resultOf(sylvesterOf(a, a.transpose(), -copyOf(matrices[1]), "A has eigenvalues λ and μ, possibly the same, with λ + μ = 0"))};
        return true;
    }
    return false;
}

}
