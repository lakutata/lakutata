// lakutata: the special functions of real arguments by Boost.Math, with the policy of the addon
// (native/config/boost_math_policy.h), declared in special_double.h: the same code on every platform, where
// std::tgamma, std::lgamma and std::erf are those of each C library. Compiled here only, so that the evaluations of
// SymEngine do not include Boost.Math.
#include <symengine/special_double.h>

#include <boost_math_policy.h>

#include <boost/math/special_functions/beta.hpp>
#include <boost/math/special_functions/digamma.hpp>
#include <boost/math/special_functions/erf.hpp>
#include <boost/math/special_functions/gamma.hpp>
#include <boost/math/special_functions/lambert_w.hpp>
#include <boost/math/special_functions/polygamma.hpp>
#include <boost/math/special_functions/zeta.hpp>

namespace SymEngine
{
namespace special
{

namespace
{
const lakutata::BoostPolicy POLICY;
}

double real_tgamma(double x)
{
    // An infinity of the sign of a zero, as std::tgamma; NaN at the negative integers
    if (x == 0)
        return std::copysign(INF, x);
    return boost::math::tgamma(x, POLICY);
}

double real_lgamma(double x)
{
    return boost::math::lgamma(x, POLICY);
}

double real_polygamma(unsigned n, double x)
{
    if (n == 0)
        return boost::math::digamma(x, POLICY);
    return boost::math::polygamma(static_cast<int>(n), x, POLICY);
}

double real_zeta(double s)
{
    if (s == 1)
        return INF;
    return boost::math::zeta(s, POLICY);
}

double real_lambert_w0(double x)
{
    return boost::math::lambert_w0(x, POLICY);
}

double real_erf(double x)
{
    return boost::math::erf(x, POLICY);
}

double real_erfc(double x)
{
    return boost::math::erfc(x, POLICY);
}

double real_lower_gamma(double s, double x)
{
    return boost::math::tgamma_lower(s, x, POLICY);
}

double real_upper_gamma(double s, double x)
{
    return boost::math::tgamma(s, x, POLICY);
}

double real_beta(double a, double b)
{
    return boost::math::beta(a, b, POLICY);
}

} // namespace special
} // namespace SymEngine
