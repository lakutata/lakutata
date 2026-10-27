#include "NumberTheory.h"

#include <algorithm>
#include <cmath>
#include <map>

#include <symengine/limits.h>
#include <symengine/rational.h>

#include "../async/Pool.h"
#include "../core/Errors.h"

namespace math {

namespace {

using Arguments = std::vector<std::vector<Integer>>;
using Kind = NumberTheoryResult::Kind;
using Factors = std::map<Integer, unsigned long>;

//The remainder of a by m, of the sign of m (m is not 0)
Integer floorMod(const Integer &a, const Integer &m)
{
    Integer remainder = a % m;
    if (remainder != 0 && (remainder < 0) != (m < 0)) remainder += m;
    return remainder;
}

Integer magnitude(const Integer &value)
{
    return value < 0 ? Integer(-value) : value;
}

//A result of more than EXACT_BITS bits, estimated before it is computed: refused
void checkBits(double bits, const std::string &what)
{
    if (bits > static_cast<double>(SymEngine::EXACT_BITS)) {
        throw MathError(ErrorCode::NotSupported, what + " has more than 2^20 bits (about 315000 digits): it is not computed");
    }
}

//An index (fibonacci(n)) or a count: above 2^31, its result would have more bits than computed (unsigned long has 32
//bits on Windows)
unsigned long smallOf(const Integer &value, const std::string &what)
{
    if (value > Integer(1u << 31)) checkBits(HUGE_VAL, what);
    return value.convert_to<unsigned long>();
}

//The primes below 2^16, by a sieve made once (never destroyed: the threads of the pool may use it at exit)
const std::vector<unsigned> &smallPrimes()
{
    static const std::vector<unsigned> &primes = *[] {
        constexpr unsigned limit = 1u << 16;
        std::vector<bool> composite(limit, false);
        auto *list = new std::vector<unsigned>();
        for (unsigned i = 2; i < limit; i++) {
            if (composite[i]) continue;
            list->push_back(i);
            for (unsigned long j = static_cast<unsigned long>(i) * i; j < limit; j += i) composite[j] = true;
        }
        return list;
    }();
    return primes;
}

//base^exponent mod m, for 0 <= base < m, exponent >= 0, m > 0: by squarings, with a checkpoint between the bits (a
//modulus of thousands of digits takes long)
Integer powerMod(const Integer &base, const Integer &exponent, const Integer &m)
{
    if (m == 1) return 0;
    Integer result = 1;
    for (unsigned long bit = SymEngine::bit_length(exponent); bit-- > 0;) {
        result = result * result % m;
        if (boost::multiprecision::bit_test(exponent, bit)) result = result * base % m;
        if (bit % 32 == 0) checkpoint();
    }
    return result;
}

unsigned lowBits(const Integer &value, unsigned mask)
{
    return static_cast<unsigned>((value & Integer(mask)).convert_to<unsigned long>());
}

//The Jacobi symbol (a/n), n odd and positive
int jacobiOf(const Integer &top, const Integer &bottom)
{
    Integer a = floorMod(top, bottom), n = bottom;
    int result = 1;
    while (a != 0) {
        const unsigned long twos = boost::multiprecision::lsb(a);
        a >>= twos;
        //(2/n) is -1 for n = 3 or 5 mod 8
        const unsigned eighth = lowBits(n, 7);
        if (twos % 2 == 1 && (eighth == 3 || eighth == 5)) result = -result;
        //Quadratic reciprocity: the sign changes when both are 3 mod 4
        if (lowBits(a, 3) == 3 && lowBits(n, 3) == 3) result = -result;
        std::swap(a, n);
        a %= n;
    }
    return n == 1 ? result : 0;
}

//The strong probable prime test of an odd n > 3 to the base a (Miller-Rabin)
bool strongProbablePrime(const Integer &n, const Integer &a)
{
    const Integer last = n - 1;
    const unsigned long twos = boost::multiprecision::lsb(last);
    Integer x = powerMod(a % n, last >> twos, n);
    if (x == 1 || x == last) return true;
    for (unsigned long r = 1; r < twos; r++) {
        x = x * x % n;
        if (x == last) return true;
        if (x == 1) return false;
    }
    return false;
}

//The strong Lucas probable prime test of an odd n that is not a square, by Selfridge's parameters: D the first of 5,
//-7, 9, -11… of Jacobi symbol (D/n) = -1, P = 1, Q = (1 - D)/4
bool strongLucasProbablePrime(const Integer &n)
{
    long d = 5;
    for (;;) {
        const int symbol = jacobiOf(Integer(d), n);
        if (symbol == -1) break;
        //A common factor with n (n is above 10^6, so not |d| itself)
        if (symbol == 0) return false;
        d = d > 0 ? -(d + 2) : -(d - 2);
    }
    const Integer q = floorMod(Integer((1 - d) / 4), n);
    const Integer dn = floorMod(Integer(d), n);
    //value/2 mod n: n is odd, so value + n is even when value is odd
    const auto half = [&n](const Integer &value) {
        Integer x = value % n;
        if (boost::multiprecision::bit_test(x, 0)) x += n;
        return Integer(x >> 1);
    };
    const Integer plus = n + 1;
    const unsigned long twos = boost::multiprecision::lsb(plus);
    const Integer odd = plus >> twos;
    //U, V and Q^k at k = 1, then along the bits of odd: k doubled, and k + 1 for a bit set
    Integer u = 1, v = 1, qk = q;
    for (unsigned long bit = SymEngine::bit_length(odd) - 1; bit-- > 0;) {
        u = u * v % n;
        v = floorMod(v * v - 2 * qk, n);
        qk = qk * qk % n;
        if (boost::multiprecision::bit_test(odd, bit)) {
            const Integer next = half(u + v);
            v = half(dn * u + v);
            u = next;
            qk = qk * q % n;
        }
        if (bit % 32 == 0) checkpoint();
    }
    if (u == 0 || v == 0) return true;
    for (unsigned long r = 1; r < twos; r++) {
        v = floorMod(v * v - 2 * qk, n);
        if (v == 0) return true;
        qk = qk * qk % n;
    }
    return false;
}

//The root of a perfect power n (no prime factor below 2^16) of the largest prime exponent found, 0 if n is none
Integer perfectRoot(const Integer &n, unsigned long &exponent)
{
    const unsigned long bits = SymEngine::bit_length(n);
    for (unsigned p : smallPrimes()) {
        //The root would be below 2^16
        if (p > bits / 16) break;
        Integer root;
        if (SymEngine::mp_root(root, n, p)) {
            exponent = p;
            return root;
        }
        checkpoint();
    }
    return 0;
}

//A factor of a composite n by Pollard's p - 1 (it finds the prime factors p of p - 1 smooth), 0 if none is found
Integer pollardPMinus1(const Integer &n)
{
    constexpr unsigned bound = 20000;
    Integer a = 2;
    unsigned count = 0;
    for (unsigned p : smallPrimes()) {
        if (p > bound) break;
        unsigned long power = p;
        while (power <= bound / p) power *= p;
        a = powerMod(a, power, n);
        if (++count % 64 == 0) {
            const Integer g = boost::multiprecision::gcd(a == 0 ? Integer(n - 1) : Integer(a - 1), n);
            //All the factors at once: left to the rho method
            if (g == n) return 0;
            if (g > 1) return g;
            checkpoint();
        }
    }
    const Integer g = boost::multiprecision::gcd(a == 0 ? Integer(n - 1) : Integer(a - 1), n);
    return g > 1 && g < n ? g : Integer(0);
}

//A factor of a composite n by Brent's variant of Pollard's rho method (x -> x^2 + c), 128 differences multiplied for
//one gcd; 0 when the sequence closes without one (another c is tried)
Integer pollardRho(const Integer &n, const Integer &c)
{
    constexpr unsigned long batch = 128;
    Integer y = 2, x, saved, product = 1, g = 1;
    for (unsigned long length = 1; g == 1; length <<= 1) {
        x = y;
        for (unsigned long i = 0; i < length; i++) {
            y = (y * y + c) % n;
            if (i % 1024 == 1023) checkpoint();
        }
        for (unsigned long k = 0; k < length && g == 1; k += batch) {
            saved = y;
            const unsigned long steps = std::min(batch, length - k);
            for (unsigned long i = 0; i < steps; i++) {
                y = (y * y + c) % n;
                product = product * (x > y ? Integer(x - y) : Integer(y - x)) % n;
            }
            g = boost::multiprecision::gcd(product, n);
            checkpoint();
        }
    }
    if (g == n) {
        //The batch multiplied a multiple of n: its differences taken again one by one, one of them has the factor
        do {
            saved = (saved * saved + c) % n;
            g = boost::multiprecision::gcd(x > saved ? Integer(x - saved) : Integer(saved - x), n);
        } while (g == 1);
    }
    return g == n ? Integer(0) : g;
}

//The prime factors of n > 1 without prime factors below 2^16, each counted times times
void factorInto(const Integer &n, unsigned long times, Factors &factors)
{
    checkpoint();
    if (n == 1) return;
    //All its prime factors are above 2^16: below 2^32, it is a prime
    if (SymEngine::bit_length(n) <= 32 || isPrime(n)) {
        factors[n] += times;
        return;
    }
    unsigned long exponent = 1;
    const Integer root = perfectRoot(n, exponent);
    if (root != 0) {
        factorInto(root, times * exponent, factors);
        return;
    }
    Integer divisor = pollardPMinus1(n);
    for (unsigned long c = 1; divisor == 0; c++) divisor = pollardRho(n, c);
    factorInto(divisor, times, factors);
    factorInto(n / divisor, times, factors);
}

//The prime factors of |n| > 0 and their exponents
Factors factorsOf(const Integer &n)
{
    Factors factors;
    Integer rest = magnitude(n);
    unsigned count = 0;
    for (unsigned p : smallPrimes()) {
        if (Integer(p) * p > rest) break;
        if (rest % p != 0) continue;
        unsigned long exponent = 0;
        while (rest % p == 0) {
            rest /= p;
            exponent++;
        }
        factors[p] = exponent;
        if (++count % 256 == 0) checkpoint();
    }
    if (rest > 1) {
        //Not divided by the primes up to its square root: a prime
        if (Integer(smallPrimes().back()) * smallPrimes().back() > rest) factors[rest] += 1;
        else factorInto(rest, 1, factors);
    }
    return factors;
}

Integer nextPrimeOf(const Integer &n)
{
    if (n < 2) return 2;
    Integer candidate = n + 1;
    if (candidate > 2 && !boost::multiprecision::bit_test(candidate, 0)) candidate += 1;
    while (!isPrime(candidate)) {
        candidate += 2;
        checkpoint();
    }
    return candidate;
}

Integer totientOf(const Factors &factors)
{
    Integer result = 1;
    for (const auto &[prime, exponent] : factors) result *= boost::multiprecision::pow(prime, static_cast<unsigned>(exponent - 1)) * (prime - 1);
    return result;
}

//The coefficients x, y of a x + b y = g, g = gcd(a, b) >= 0, of the extended Euclidean algorithm (as SymPy's igcdex)
void extendedGcdOf(const Integer &a, const Integer &b, Integer &g, Integer &x, Integer &y)
{
    if (a == 0 && b == 0) {
        g = 0, x = 0, y = 0;
        return;
    }
    if (a == 0) {
        g = magnitude(b), x = 0, y = b > 0 ? 1 : -1;
        return;
    }
    if (b == 0) {
        g = magnitude(a), x = a > 0 ? 1 : -1, y = 0;
        return;
    }
    Integer r0 = magnitude(a), r1 = magnitude(b), x0 = 1, y0 = 0, x1 = 0, y1 = 1;
    while (r1 != 0) {
        const Integer quotient = r0 / r1;
        Integer next = r0 - quotient * r1;
        r0 = std::move(r1), r1 = std::move(next);
        next = x0 - quotient * x1;
        x0 = std::move(x1), x1 = std::move(next);
        next = y0 - quotient * y1;
        y0 = std::move(y1), y1 = std::move(next);
    }
    g = r0, x = a < 0 ? Integer(-x0) : x0, y = b < 0 ? Integer(-y0) : y0;
}

//A result modulo m of the sign of m, as mod: r is in [0, |m|)
Integer signedResidue(const Integer &r, const Integer &m)
{
    return m < 0 && r != 0 ? Integer(r + m) : r;
}

void checkModulus(const Integer &m)
{
    if (m == 0) throw MathError(ErrorCode::DivisionByZero, "A modulus is 0");
}

//The product first, first + step, … of count terms, by a product tree
Integer productOf(const Integer &first, unsigned long count, unsigned long step)
{
    if (count <= 16) {
        Integer product = 1;
        for (unsigned long i = 0; i < count; i++) product *= first + i * step;
        return product;
    }
    checkpoint();
    const unsigned long half = count / 2;
    return productOf(first, half, step) * productOf(first + half * step, count - half, step);
}

//log2(n!) by Stirling's formula, a little above it
double factorialBits(double n)
{
    return n < 2 ? 1 : n * std::log2(n) - n * 1.4426950408889634 + 0.5 * std::log2(6.283185307179586 * n) + 1;
}

//The Bernoulli number B(n) = numerator/denominator, B(1) = +1/2 (as SymPy)
std::pair<Integer, Integer> bernoulliOf(unsigned long n)
{
    if (n == 0) return {1, 1};
    if (n == 1) return {1, 2};
    if (n % 2 == 1) return {0, 1};
    return evenBernoulli(n / 2).back();
}

//The sum of 1/k for k in [low, high), as numerator/denominator, by binary splitting
std::pair<Integer, Integer> harmonicRange(unsigned long low, unsigned long high)
{
    if (high - low == 1) return {1, low};
    checkpoint();
    const unsigned long middle = low + (high - low) / 2;
    const auto [p1, q1] = harmonicRange(low, middle);
    const auto [p2, q2] = harmonicRange(middle, high);
    return {p1 * q2 + p2 * q1, q1 * q2};
}

NumberTheoryResult integerResult(Integer value)
{
    NumberTheoryResult result;
    result.kind = Kind::Integer;
    result.integers.push_back(std::move(value));
    return result;
}

NumberTheoryResult integersResult(std::vector<Integer> values)
{
    NumberTheoryResult result;
    result.kind = Kind::Integers;
    result.integers = std::move(values);
    return result;
}

NumberTheoryResult signResult(int sign)
{
    NumberTheoryResult result;
    result.kind = Kind::Sign;
    result.sign = sign;
    return result;
}

NumberTheoryResult booleanResult(bool flag)
{
    NumberTheoryResult result;
    result.kind = Kind::Boolean;
    result.flag = flag;
    return result;
}

NumberTheoryResult rationalResult(const Integer &numerator, const Integer &denominator)
{
    NumberTheoryResult result;
    result.kind = Kind::Rational;
    result.expression = SymEngine::Rational::from_mpq(SymEngine::rational_class(numerator, denominator));
    return result;
}

NumberTheoryResult missing()
{
    return NumberTheoryResult();
}

void checkPositive(const Integer &n, const std::string &what)
{
    if (n < 1) throw MathError(ErrorCode::Domain, what + " is defined for the positive integers");
}

}

std::vector<std::pair<Integer, Integer>> evenBernoulli(unsigned long m)
{
    //From the tangent numbers, integers only (Brent and Harvey, "Fast computation of Bernoulli, tangent and secant
    //numbers", 2011): T(1)… T(m) at once
    std::vector<Integer> tangent(m + 1);
    if (m >= 1) tangent[1] = 1;
    for (unsigned long k = 2; k <= m; k++) tangent[k] = (k - 1) * tangent[k - 1];
    for (unsigned long k = 2; k <= m; k++) {
        for (unsigned long j = k; j <= m; j++) tangent[j] = (j - k) * tangent[j - 1] + (j - k + 2) * tangent[j];
        checkpoint();
    }
    //B(2k) = (-1)^(k - 1) 2k T(k) / (4^k (4^k - 1))
    std::vector<std::pair<Integer, Integer>> numbers;
    for (unsigned long k = 1; k <= m; k++) {
        const Integer power = Integer(1) << (2 * k);
        Integer numerator = 2 * k * tangent[k], denominator = power * (power - 1);
        if (k % 2 == 0) numerator = -numerator;
        const Integer common = boost::multiprecision::gcd(magnitude(numerator), denominator);
        numbers.emplace_back(numerator / common, denominator / common);
    }
    return numbers;
}

bool isPrime(const Integer &n)
{
    if (n < 2) return false;
    for (unsigned p : smallPrimes()) {
        if (p > 1000) break;
        if (n == p) return true;
        if (n % p == 0) return false;
    }
    //No prime factor below 1000
    if (n < 1000000) return true;
    if (!strongProbablePrime(n, 2)) return false;
    //Selfridge's search for D does not end for a square
    const Integer root = boost::multiprecision::sqrt(n);
    if (root * root == n) return false;
    return strongLucasProbablePrime(n);
}

NumberTheoryResult numberTheoryOf(const std::string &operation, const Arguments &arguments)
{
    const auto at = [&arguments](size_t index) -> const Integer & { return arguments.at(index).at(0); };
    if (operation == "gcd") {
        Integer result = 0;
        for (const Integer &value : arguments.at(0)) result = boost::multiprecision::gcd(result, magnitude(value));
        return integerResult(result);
    }
    if (operation == "lcm") {
        Integer result = 1;
        for (const Integer &value : arguments.at(0)) {
            const Integer size = magnitude(value);
            result = result == 0 || size == 0 ? Integer(0) : Integer(result / boost::multiprecision::gcd(result, size) * size);
        }
        return integerResult(result);
    }
    if (operation == "extendedGcd") {
        Integer g, x, y;
        extendedGcdOf(at(0), at(1), g, x, y);
        return integersResult({g, x, y});
    }
    if (operation == "mod") {
        checkModulus(at(1));
        return integerResult(floorMod(at(0), at(1)));
    }
    if (operation == "modInverse") {
        checkModulus(at(1));
        Integer g, x, y;
        extendedGcdOf(at(0), at(1), g, x, y);
        if (g != 1) return missing();
        return integerResult(signedResidue(floorMod(x, magnitude(at(1))), at(1)));
    }
    if (operation == "powMod") {
        const Integer &m = at(2);
        checkModulus(m);
        const Integer size = magnitude(m);
        Integer base = floorMod(at(0), size);
        if (at(1) < 0) {
            Integer g, x, y;
            extendedGcdOf(base, size, g, x, y);
            if (g != 1) throw MathError(ErrorCode::Domain, "A negative power of a number with no inverse modulo the modulus");
            base = floorMod(x, size);
        }
        return integerResult(signedResidue(powerMod(base, magnitude(at(1)), size), m));
    }
    if (operation == "isPrime") return booleanResult(isPrime(at(0)));
    if (operation == "nextPrime") return integerResult(nextPrimeOf(at(0)));
    if (operation == "factor") {
        if (at(0) == 0) throw MathError(ErrorCode::Domain, "0 has no prime factorization");
        NumberTheoryResult result;
        result.kind = Kind::Factors;
        if (at(0) < 0) result.integers.insert(result.integers.end(), {-1, 1});
        for (const auto &[prime, exponent] : factorsOf(at(0))) result.integers.insert(result.integers.end(), {prime, Integer(exponent)});
        return result;
    }
    if (operation == "totient") {
        checkPositive(at(0), "totient(n)");
        return integerResult(totientOf(factorsOf(at(0))));
    }
    if (operation == "mobius") {
        checkPositive(at(0), "mobius(n)");
        const Factors factors = factorsOf(at(0));
        for (const auto &[prime, exponent] : factors) {
            if (exponent > 1) return signResult(0);
        }
        return signResult(factors.size() % 2 == 0 ? 1 : -1);
    }
    if (operation == "primitiveRoot") {
        const Integer &n = at(0);
        if (n < 2) throw MathError(ErrorCode::Domain, "primitiveRoot(n) is defined for n >= 2");
        if (n <= 4) return integerResult(n - 1);
        //Only 2, 4, p^k and 2p^k (p an odd prime) have one
        const Factors factors = factorsOf(n);
        const bool odd = factors.count(2) == 0;
        if (factors.size() - (odd ? 0 : 1) != 1 || (!odd && factors.at(2) > 1)) return missing();
        const Integer phi = totientOf(factors);
        const Factors orders = factorsOf(phi);
        for (Integer g = 2; g < n; g++) {
            if (boost::multiprecision::gcd(g, n) != 1) continue;
            bool generator = true;
            for (const auto &[prime, exponent] : orders) {
                if (powerMod(g, phi / prime, n) == 1) {
                    generator = false;
                    break;
                }
            }
            if (generator) return integerResult(g);
            checkpoint();
        }
        return missing();
    }
    if (operation == "legendre") {
        const Integer &p = at(1);
        if (p < 3 || !boost::multiprecision::bit_test(p, 0) || !isPrime(p)) throw MathError(ErrorCode::Domain, "legendre(a, p) is defined for the odd primes p");
        return signResult(jacobiOf(at(0), p));
    }
    if (operation == "jacobi") {
        const Integer &n = at(1);
        if (n < 1 || !boost::multiprecision::bit_test(n, 0)) throw MathError(ErrorCode::Domain, "jacobi(a, n) is defined for the odd positive integers n");
        return signResult(jacobiOf(at(0), n));
    }
    if (operation == "crt") {
        const std::vector<Integer> &remainders = arguments.at(0), &moduli = arguments.at(1);
        if (remainders.size() != moduli.size()) throw MathError(ErrorCode::Argument, "crt() takes as many remainders as moduli");
        //x = r mod m, combined with each congruence: the moduli need not be coprime
        Integer r = 0, m = 1;
        for (size_t i = 0; i < moduli.size(); i++) {
            checkModulus(moduli[i]);
            const Integer mi = magnitude(moduli[i]);
            Integer g, x, y;
            extendedGcdOf(m, mi, g, x, y);
            const Integer difference = remainders[i] - r;
            if (difference % g != 0) return missing();
            const Integer step = mi / g;
            r += m * floorMod(difference / g * x, step);
            m *= step;
            r = floorMod(r, m);
        }
        return integersResult({r, m});
    }
    if (operation == "fibonacci" || operation == "lucas") {
        const bool fibonacci = operation == "fibonacci";
        const unsigned long n = smallOf(magnitude(at(0)), operation + "(n)");
        checkBits(0.6943 * static_cast<double>(n) + 2, operation + "(n)");
        Integer result;
        if (fibonacci) SymEngine::mp_fib_ui(result, n);
        else SymEngine::mp_lucnum_ui(result, n);
        //The negative indices: F(-n) = (-1)^(n + 1) F(n), L(-n) = (-1)^n L(n)
        if (at(0) < 0 && (n % 2 == 0) == fibonacci) result = -result;
        return integerResult(result);
    }
    if (operation == "binomial") {
        const Integer &n = at(0), &k = at(1);
        if (k < 0 || (n >= 0 && k > n)) return integerResult(0);
        //C(n, k) = (-1)^k C(k - n - 1, k) for a negative n
        const Integer top = n >= 0 ? n : Integer(k - n - 1);
        const Integer smaller = std::min(k, Integer(top - k));
        const unsigned long count = smallOf(smaller, "binomial(n, k)");
        if (count > 0) {
            //log2 C(n, k) <= n H(k/n), H the binary entropy (log1p: k/n may be tiny, n = 10^100)
            const double total = top.convert_to<double>(), share = static_cast<double>(count) / total;
            const double entropy = -share * std::log2(share) - (1 - share) * std::log1p(-share) / std::log(2.0);
            checkBits(total * entropy + 1, "binomial(n, k)");
        }
        Integer result;
        SymEngine::mp_bin_ui(result, top, count);
        if (n < 0 && boost::multiprecision::bit_test(k, 0)) result = -result;
        return integerResult(result);
    }
    if (operation == "factorial") {
        if (at(0) < 0) throw MathError(ErrorCode::Domain, "factorial(n) is defined for n >= 0");
        const unsigned long n = smallOf(at(0), "factorial(n)");
        checkBits(factorialBits(static_cast<double>(n)), "factorial(n)");
        return integerResult(n < 2 ? Integer(1) : productOf(2, n - 1, 1));
    }
    if (operation == "doubleFactorial") {
        if (at(0) < -1) throw MathError(ErrorCode::Domain, "doubleFactorial(n) is defined for n >= -1");
        if (at(0) < 2) return integerResult(1);
        const unsigned long n = smallOf(at(0), "doubleFactorial(n)");
        checkBits(factorialBits(static_cast<double>(n)) / 2 + 0.5 * static_cast<double>(n), "doubleFactorial(n)");
        //n (n - 2) … down to 1 or 2
        return integerResult(productOf(2 - n % 2, (n + 1) / 2, 2));
    }
    if (operation == "bernoulli") {
        if (at(0) < 0) throw MathError(ErrorCode::Domain, "bernoulli(n) is defined for n >= 0");
        const unsigned long n = smallOf(at(0), "bernoulli(n)");
        //Its time grows as n^3 (0.15 s at 2000)
        if (n > 2000) throw MathError(ErrorCode::NotSupported, "bernoulli(n) is computed up to n = 2000");
        const auto [numerator, denominator] = bernoulliOf(n);
        return rationalResult(numerator, denominator);
    }
    if (operation == "harmonic") {
        if (at(0) < 0) throw MathError(ErrorCode::Domain, "harmonic(n) is defined for n >= 0");
        const unsigned long n = smallOf(at(0), "harmonic(n)");
        //0.17 s at 50000
        if (n > 50000) throw MathError(ErrorCode::NotSupported, "harmonic(n) is computed up to n = 50000");
        if (n == 0) return rationalResult(0, 1);
        const auto [numerator, denominator] = harmonicRange(1, n + 1);
        const Integer common = boost::multiprecision::gcd(numerator, denominator);
        return rationalResult(numerator / common, denominator / common);
    }
    throw MathError(ErrorCode::Argument, "Unknown operation " + operation);
}

}
