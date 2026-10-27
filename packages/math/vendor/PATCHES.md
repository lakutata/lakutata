# Changes to the vendored libraries

The libraries in this directory are copied from their releases (`vendor/UPSTREAM.json` records each version, archive and
checksum) by `scripts/sync.mjs`, which keeps the changes below through a three-way merge when a library is upgraded.
Boost.Multiprecision, Boost.Config, Eigen and mpdecimal are unchanged. The configuration headers the builds of CMake
would generate are in `native/config`.

## SymEngine

### Built on standalone Boost.Multiprecision

SymEngine's `boostmp` integers come from Boost.Multiprecision, which can be used without the rest of Boost
(`BOOST_MP_STANDALONE`), but SymEngine also includes Boost.Random and Boost.MPL.

- `symengine/mp_class.h`: the random integers use `std::mt19937` and the `uniform_int_distribution` of
  Boost.Multiprecision instead of Boost.Random; the sign of an integer is `integer_class::sign()` instead of
  `boost::math::sign()`; the workaround for Boost releases older than 1.59 is compiled only when `BOOST_VERSION`
  is defined (standalone Boost.Multiprecision does not define it).
- `symengine/ntheory.cpp`: the includes of Boost.Random are removed.
- `symengine/mp_boost.cpp`: the include of `boost/mpl/int.hpp` is removed.

### The powers taken out of the roots

- `symengine/rational.cpp`: in an integer raised to a rational power, the powers of its factors are taken out of the
  root, as SymPy does: `sqrt(8)` is `2*sqrt(2)`, `8^(1/4)` is `2^(3/4)`, `(-24)^(1/3)` is `2*(-3)^(1/3)`. SymEngine
  took out only exact roots (`sqrt(4)` is `2`). The factors are found by trial division up to 2^15, and the rest of
  the number when it is a perfect power.

### The values of the functions

- `symengine/special_double.h` (added): the special functions in double precision, for real and complex arguments,
  where SymEngine relies on MPFR and Arb: gamma (Lanczos) and log gamma (Stirling's series, the branch of its analytic
  continuation), zeta and the Hurwitz zeta (Euler-Maclaurin, the reflection formula), the Lambert W function (its
  principal branch), polygamma, the incomplete gamma functions (of any real `s`: `E1` and the recurrences below 0),
  beta, erf and erfc of complex numbers.
- `symengine/special_boost.cpp` (added): the special functions of real arguments by Boost.Math (standalone, with the
  policy of `native/config/boost_math_policy.h`: NaN or infinities instead of exceptions, doubles computed in doubles),
  declared in `special_double.h` and used there wherever Boost.Math defines them: gamma, log gamma, polygamma, the
  Riemann zeta function, the principal branch of the Lambert W function, erf, erfc, the incomplete gamma functions of
  `s > 0` and beta of positive arguments. They are the same code on every platform, where `std::tgamma`, `std::lgamma`
  and `std::erf` were those of each C library (`eval_double.cpp` and `lambda_double.h` now call them as well). The
  incomplete gamma functions of `s <= 0`, beta of arguments that are not positive, the Hurwitz zeta function and the
  complex arguments stay computed in `special_double.h`.
- `symengine/eval_double.cpp`, `symengine/lambda_double.h`: these functions, with sign, floor, ceiling, truncation and
  the conjugate, evaluated numerically and in the compiled functions. The complex values have no negative zeros, so that
  a negative real number stays on the upper side of the branch cuts, as the exact values: `(0.9 + 0i)/(-0.4 + 0i)` is
  `-2.25 - 0i` in floating point, and its logarithm was `-i*pi`. The integer powers are computed by multiplications and
  the square roots by `sqrt`, in the powers and in the factors of the compiled products: `pow` goes through `exp` and
  `log`, whose rounding moved real values off the real line. Log gamma has no real value left of zero (its imaginary
  part is a multiple of pi), and the sign of NaN is NaN, so that the complex value is computed instead. `atan2(-0.0, x)`
  is `atan2(0, x)`, as the exact value. The inverse trigonometric and hyperbolic functions of a real argument inside
  their real domain are computed with their real versions in the complex evaluations: libc++'s complex `atan` of `-0.4`
  has an imaginary part of `5.55e-17`, which put `arg(1/atan(-2/5))` at `-pi`. A value on a branch cut is moved to the
  side the exact values take (SymPy's, counter-clockwise continuous, on which `asinh(-z) = -asinh(z)` relies) before the
  complex function reads the side from the sign of a zero: `asin`, `acos` and `atanh` right of 1 from below; `atan` and
  `asinh` below `-i` from the left. The reciprocal of the argument of `asec`, `acsc`, `acot`, `asech`, `acsch` and
  `acoth` has no negative zero either (`1/(-0.5 + 0i)` is `-2 - 0i`, which put `asec(-1/2)` on the other side). The
  maximum and the minimum of values one of which is NaN are NaN (`std::max` dropped a NaN after the first value, so the
  complex evaluation was not tried); the complex evaluations have them too, for values of imaginary parts 0.
- `symengine/functions.cpp`: polygamma has its poles at the nonpositive integers only (SymEngine gave
  `complexInfinity` for every number not positive), a negative rational is moved right by the recurrence, and its
  special values of the thirds and the quarters are chosen by the remainder of the numerator (`polygamma(0, 5/4)` was
  wrong). `beta(x, 1 - x)` is `pi/sin(pi*x)` (it was `complexInfinity`). The sign of a product is the product of the
  signs of its factors where they are known, the sign of a number written as an expression is computed
  (`sign(pi - 3)` is 1), and the sign of a power of an unknown sign no longer recurses without end. The floor, the
  ceiling and the truncation of a number written as an expression are computed (`floor(sqrt(2))` is 1); the
  truncation no longer takes an integer out of a sum (`trunc(5 - 1/2)` is 4, not `5 + trunc(-1/2)`).
- `symengine/functions.cpp`: the gamma function of a half-integer computes its double factorial in an integer of any
  size (an `int` overflowed: `gamma(-25/2)` was wrong).
- `symengine/functions.cpp`: the upper incomplete gamma function of an integer `s` below 1 stays an upper incomplete
  gamma function: SymEngine made it the lower one (`uppergamma(0, 1)` was `lowergamma(0, 1)`).
- `symengine/solve.cpp`: an equation that is not a polynomial in the variable is left unsolved (a condition set):
  SymEngine failed on `sin(x) + x = 0`, and took a function of the variable as a coefficient, so that `x^x = 2` was
  answered with no solution. A product with a denominator is solved as a fraction, so that the zeros of the denominator
  are not solutions (`(x^2 - 1)/(x - 1) = 0` is `x = -1` only).
- `symengine/derivative.cpp`: the derivative of `acosh(x)` is `1/(sqrt(x - 1)*sqrt(x + 1))`, as SymPy;
  `1/sqrt(x^2 - 1)` has the wrong sign left of -1. The derivatives of gamma and log gamma are 0 when their argument
  has no variable, decided before `polygamma(0, a)` is built: its exact value at an integer `a` is a harmonic number of
  `a - 1` terms.
  The derivative of an unevaluated expression (the rewritings leave them: `sin(x)` rewritten with `cos` is
  `cos(x - pi/2)`) is the derivative of what it holds; it was an unevaluated derivative object.

### The functions of the addon

The functions SymEngine does not have (`cbrt` and `root` as real roots, in `native/functions`) are written as its
function wrappers (`FunctionWrapper`).

- `symengine/functions.h`, `symengine/functions.cpp`: a wrapper gives its value for numbers (`evaluate_real`,
  `evaluate_complex`, by `create()` and `eval()` unless it overrides them), and a wrapper is equal to a wrapper of the
  same type, name and arguments: `FunctionSymbol::__eq__` required the other object to be a plain function symbol,
  so a wrapper was never equal to anything, not even itself (`cos(cbrt(x))` recursed without end).
- `symengine/lambda_double.h`: the compiled functions call the wrappers with the values of their arguments.

### Canonical forms

- `symengine/mul.cpp`: the coefficient of a product goes into its first sum to the power 1 (`2*(x + 1)` is
  `2*x + 2`, `2*(x + 1)/y` is `(2*x + 2)/y`), else the denominator of a rational coefficient goes into its first sum
  to the power -1 (`z/(2*(x + 1))` is `z/(2*x + 2)`), as the formulas are read: a value has one form, the sums stay
  flat. A factor that is a power, raised to an integer power, is combined (`(a^b)^n` is `a^(b*n)`).
- `symengine/mul.cpp`: the positive integers to the same rational power in a product are multiplied together, as in
  SymPy: `sqrt(2)*sqrt(3)` is `sqrt(6)` (SymEngine kept the two, and a value written both ways could not be shown
  equal), `2^(1/3)*4^(1/3)` is 2; powers that differ stay (`2^(1/3)*3^(2/3)`).
- `symengine/add.cpp`: a number times a sum met as a term of a sum is multiplied out too, as in a product (a
  substitution of `x = 1 - u` in `-x + 1` gave `-(-u + 1) + 1`, now `u`); also when it is the term of a product of a
  number and a sum (the factored form `2*(x + 1)` of `factor()`), and in `add(a, b)`, which now adds its terms through
  it (`2*(x + 1) + 1` is `2*x + 3`, not a sum inside a sum).
- `symengine/functions.cpp`: the minus taken out of a sum (`asinh(-x - 1)` is `-asinh(x + 1)`) is added term by
  term, so that a sum among the terms is flattened. `log(e^r)` is `r` for an exact real number `r`. The numeric factor
  of a product is taken out of `abs` (`abs(-2*x)` is `2*abs(x)`), and `abs` is evaluated again once the minus is
  taken out (`abs(-abs(x))` is `abs(x)`).
- `symengine/numer_denom.cpp`: a power that is not an integer one is split over the fraction of its base only when
  its denominator is positive: `sqrt(a/y)` is not `sqrt(a)/sqrt(y)`, and `(1/y)^x` is not `1/y^x`, when `y` is
  negative.
- `symengine/pow.cpp`: `e^log(x)` is `x`, and `e^(c*log(x))` is `x^c` for a number `c`, as SymPy. `(x^-1)^b` stays
  as written: SymEngine made it `x^(-b)`, which is wrong for a negative `x` when `b` is not an integer
  (`sqrt(1/(-4))` is `i/2`, `1/sqrt(-4)` is `-i/2`). `1` to any exact power is `1` (`1^(10^20)` failed).

### The size of the exact numbers

- `symengine/limits.h` (added), `symengine/pow.cpp`, `symengine/mul.cpp`, `symengine/rational.cpp`,
  `symengine/integer.h`, `symengine/rational.h`: a power whose result would have more than 2^20 bits (about 315000
  digits) stays a power, where SymEngine computed it (hours, and all the memory, for `(3/20)^(10^8)`); the other
  operations reaching such a power fail instead of hanging. The gamma function of an integer above 20001 (its
  factorial) stays as written, as the factorials of the parser, and so does polygamma at such an integer.
- `symengine/mp_boost.cpp`: the integer roots start from an upper bound of the root (SymEngine started from 1, and a
  root of order 10^16 never ended); the factorials and the binomial coefficients are products of a product tree
  (SymEngine multiplied one factor at a time).
- `symengine/rational.cpp`: the powers taken out of the roots only for roots up to 2^15 and numbers of a bounded size.

### Used by several threads, and while the process exits

The addon runs SymEngine in its own threads, which can still be running when the process exits.

- `symengine/constants.cpp`: the constants (`zero`, `one`, `pi`…) are never destroyed. Their destructors used to run
  at exit while the threads were still using them, and the process crashed.
- `symengine/eval_double.cpp`, `symengine/functions.cpp`, `symengine/printers/strprinter.cpp`: the static tables are
  allocated once and never destroyed, for the same reason.
- `symengine/prime_sieve.cpp`: each thread has its own cache of primes. SymEngine shared one vector between all
  threads and extended and cleared it without a lock.
- `symengine/interruption.h`, `symengine/interruption.cpp` (added): a function the addon sets, called at each step of
  the long loops of `symengine/expand.cpp` and of the multinomial coefficients of `symengine/pow.cpp`. It throws when
  the operation is cancelled or past its time limit, so that its thread stops there.

SymEngine's own tests, built by its CMake (`INTEGER_CLASS=boostmp`, the headers of Boost from `vendor/`) on its 0.15.0
release with the sources of `vendor/` over it (2026-10-28, for the patch of `add.cpp`): 56 of its 60 tests pass. The 10
assertions that fail, in `test_functions`, `test_printing`, `test_eval_double` and `test_cwrapper`, check the forms that
the patches above change on purpose (a coefficient multiplied into a sum, the minus taken out of `acosh`, `truncate` of
a sum, `zeta` evaluated by Boost.Math, the printing of the C wrapper); they are the same with and without the patch of
`add.cpp`. The patch of the powers in `mul.cpp` (2026-10-28) adds one, in `test_printing`, which expects
`23*sqrt(5)*sqrt(7)` where it is now `23*sqrt(35)`.

## Boost.Math

- `include/boost/math/distributions/hypergeometric.hpp`: `kurtosis_excess()` returned the kurtosis of Wolfram's formula,
  which is the full one, and `kurtosis()` added 3 to it: the excess is now 3 less (SciPy's: -0.1527 for 12 draws from
  20 items of which 7 are successes, where Boost gave 2.8473).
