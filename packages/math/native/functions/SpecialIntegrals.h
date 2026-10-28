//The special functions that integrals give: Si(x), Ci(x), Shi(x), Chi(x), Ei(x), li(x), fresnelS(x), fresnelC(x), the
//integrals of sin(t)/t, cos(t)/t, sinh(t)/t, cosh(t)/t, e^t/t, 1/ln(t), sin(pi t^2/2) and cos(pi t^2/2) (as SymPy names
//them). Their values in doubles: power series for small arguments, the continued fractions of E1 and erfc of complex
//arguments for large ones (DLMF 6.9 and 7.9), Ei by Boost.Math; of real arguments (Ci and Chi of a negative one have
//an imaginary part of pi, li of one is complex); their decimals in DecimalSpecial.cpp (specialIntegralDecimal).
#pragma once

#include <optional>

#include "Functions.h"

namespace math {

class SpecialIntegral : public MathFunction {
public:
    enum class Kind { Si, Ci, Shi, Chi, Ei, Li, FresnelS, FresnelC };

    SpecialIntegral(Kind kind, const Expr &x);

    Kind kind() const;

    Expr create(const SymEngine::vec_basic &arguments) const override;

    Expr diff_impl(const SymEngine::RCP<const SymEngine::Symbol> &variable) const override;

    std::complex<double> value(const std::vector<std::complex<double>> &arguments) const override;

private:
    Kind kind_;
};

//The function of a kind of an argument: its values at 0, inf and -inf, the odd ones of a negative argument with the
//sign in front (Si(-x) is -Si(x)), a call otherwise
Expr specialIntegralOf(SpecialIntegral::Kind kind, const Expr &x);

Expr siOf(const Expr &x);
Expr ciOf(const Expr &x);
Expr shiOf(const Expr &x);
Expr chiOf(const Expr &x);
Expr eiOf(const Expr &x);
Expr liOf(const Expr &x);
Expr fresnelSOf(const Expr &x);
Expr fresnelCOf(const Expr &x);

//The power series of Si, Shi, fresnelS or fresnelC of u at u = 0 to the power order of u (u of x going to 0 there, its
//higher powers are beyond the order in x); nothing for Ci, Chi, Ei and li, which have a logarithm at 0
std::optional<Expr> specialIntegralSeries(SpecialIntegral::Kind kind, const Expr &u, unsigned order);

//The value of a special integral of a kind at inf (sign 1) or -inf (sign -1): pi/2 for Si at inf… or nothing (Chi at
//-inf is complex)
Expr specialIntegralAtInfinity(SpecialIntegral::Kind kind, int sign);

}
