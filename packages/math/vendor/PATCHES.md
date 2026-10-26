# Changes to the vendored libraries

The libraries in this directory are copied from their releases (`vendor/UPSTREAM.json` records each version, archive
and checksum) by `scripts/sync.mjs`, which keeps the changes below through a three-way merge when a library is
upgraded. Boost.Multiprecision, Boost.Config, Eigen and mpdecimal are unchanged. The configuration headers the builds
of CMake would generate are in `native/config`.

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
