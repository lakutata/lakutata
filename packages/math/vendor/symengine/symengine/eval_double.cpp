#include <symengine/visitor.h>
#include <symengine/eval_double.h>
#include <symengine/symengine_exception.h>
#include <symengine/special_double.h>

namespace SymEngine
{

template <typename T, typename C>
class EvalDoubleVisitor : public BaseVisitor<C>
{
protected:
    /*
       The 'result_' variable is assigned into at the very end of each visit()
       methods below. The only place where these methods are called from is the
       line 'b.accept(*this)' in apply() and the 'result_' is immediately
       returned. Thus no corruption can happen and apply() can be safely called
       recursively.
    */
    T result_;

public:
    T apply(const Basic &b)
    {
        b.accept(*down_cast<C *>(this));
        // lakutata: without negative zeros (special_double.h)
        return special::unsigned_zeros(result_);
    }

    void bvisit(const Integer &x)
    {
        T tmp = mp_get_d(x.as_integer_class());
        result_ = tmp;
    }

    void bvisit(const Rational &x)
    {
        T tmp = mp_get_d(x.as_rational_class());
        result_ = tmp;
    }

    void bvisit(const RealDouble &x)
    {
        T tmp = x.i;
        result_ = tmp;
    }
#ifdef HAVE_SYMENGINE_MPFR
    void bvisit(const RealMPFR &x)
    {
        T tmp = mpfr_get_d(x.i.get_mpfr_t(), MPFR_RNDN);
        result_ = tmp;
    }
#endif
    void bvisit(const Add &x)
    {
        T tmp = 0;
        for (const auto &p : x.get_args())
            tmp += apply(*p);
        result_ = tmp;
    }

    void bvisit(const Mul &x)
    {
        T tmp = 1;
        for (const auto &p : x.get_args())
            tmp *= apply(*p);
        result_ = tmp;
    }

    void bvisit(const Pow &x)
    {
        T exp_ = apply(*(x.get_exp()));
        if (eq(*(x.get_base()), *E)) {
            result_ = std::exp(exp_);
        } else {
            T base_ = apply(*(x.get_base()));
            // lakutata: the integer powers by multiplications, the square
            // roots by sqrt (special_double.h)
            if (is_a<Integer>(*x.get_exp())
                and mp_fits_slong_p(
                    down_cast<const Integer &>(*x.get_exp()).as_integer_class()))
                result_ = special::integer_power(
                    base_, mp_get_si(down_cast<const Integer &>(*x.get_exp())
                                         .as_integer_class()));
            else if (eq(*x.get_exp(), *rational(1, 2)))
                result_ = std::sqrt(base_);
            else
                result_ = std::pow(base_, exp_);
        }
    }

    void bvisit(const Sin &x)
    {
        T tmp = apply(*(x.get_arg()));
        result_ = std::sin(tmp);
    }

    void bvisit(const Cos &x)
    {
        T tmp = apply(*(x.get_arg()));
        result_ = std::cos(tmp);
    }

    void bvisit(const Tan &x)
    {
        T tmp = apply(*(x.get_arg()));
        result_ = std::tan(tmp);
    }

    void bvisit(const Symbol &)
    {
        throw SymEngineException("Symbol cannot be evaluated.");
    };

    void bvisit(const Log &x)
    {
        T tmp = apply(*(x.get_arg()));
        result_ = std::log(tmp);
    };

    void bvisit(const Cot &x)
    {
        T tmp = apply(*(x.get_arg()));
        result_ = 1.0 / std::tan(tmp);
    };

    void bvisit(const Csc &x)
    {
        T tmp = apply(*(x.get_arg()));
        result_ = 1.0 / std::sin(tmp);
    };

    void bvisit(const Sec &x)
    {
        T tmp = apply(*(x.get_arg()));
        result_ = 1.0 / std::cos(tmp);
    };

    void bvisit(const ASin &x)
    {
        T tmp = apply(*(x.get_arg()));
        result_ = special::real_where(
            tmp, [](double v) { return std::asin(v); },
            [](const std::complex<double> &v) {
                return std::asin(special::below_beyond_one(v));
            },
            [](double v) { return v >= -1 and v <= 1; });
    };

    void bvisit(const ACos &x)
    {
        T tmp = apply(*(x.get_arg()));
        result_ = special::real_where(
            tmp, [](double v) { return std::acos(v); },
            [](const std::complex<double> &v) {
                return std::acos(special::below_beyond_one(v));
            },
            [](double v) { return v >= -1 and v <= 1; });
    };

    void bvisit(const ASec &x)
    {
        T tmp = apply(*(x.get_arg()));
        result_ = special::real_where(
            special::unsigned_zeros(1.0 / tmp), [](double v) { return std::acos(v); },
            [](const std::complex<double> &v) {
                return std::acos(special::below_beyond_one(v));
            },
            [](double v) { return v >= -1 and v <= 1; });
    };

    void bvisit(const ACsc &x)
    {
        T tmp = apply(*(x.get_arg()));
        result_ = special::real_where(
            special::unsigned_zeros(1.0 / tmp), [](double v) { return std::asin(v); },
            [](const std::complex<double> &v) {
                return std::asin(special::below_beyond_one(v));
            },
            [](double v) { return v >= -1 and v <= 1; });
    };

    void bvisit(const ATan &x)
    {
        T tmp = apply(*(x.get_arg()));
        result_ = special::real_where(
            tmp, [](double v) { return std::atan(v); },
            [](const std::complex<double> &v) {
                return std::atan(special::left_below_minus_i(v));
            },
            [](double) { return true; });
    };

    void bvisit(const ACot &x)
    {
        T tmp = apply(*(x.get_arg()));
        result_ = special::real_where(
            special::unsigned_zeros(1.0 / tmp), [](double v) { return std::atan(v); },
            [](const std::complex<double> &v) {
                return std::atan(special::left_below_minus_i(v));
            },
            [](double) { return true; });
    };

    void bvisit(const Sinh &x)
    {
        T tmp = apply(*(x.get_arg()));
        result_ = std::sinh(tmp);
    };

    void bvisit(const Csch &x)
    {
        T tmp = apply(*(x.get_arg()));
        result_ = 1.0 / std::sinh(tmp);
    };

    void bvisit(const Cosh &x)
    {
        T tmp = apply(*(x.get_arg()));
        result_ = std::cosh(tmp);
    };

    void bvisit(const Sech &x)
    {
        T tmp = apply(*(x.get_arg()));
        result_ = 1.0 / std::cosh(tmp);
    };

    void bvisit(const Tanh &x)
    {
        T tmp = apply(*(x.get_arg()));
        result_ = std::tanh(tmp);
    };

    void bvisit(const Coth &x)
    {
        T tmp = apply(*(x.get_arg()));
        result_ = 1.0 / std::tanh(tmp);
    };

    void bvisit(const ASinh &x)
    {
        T tmp = apply(*(x.get_arg()));
        result_ = special::real_where(
            tmp, [](double v) { return std::asinh(v); },
            [](const std::complex<double> &v) {
                return std::asinh(special::left_below_minus_i(v));
            },
            [](double) { return true; });
    };

    void bvisit(const ACsch &x)
    {
        T tmp = apply(*(x.get_arg()));
        result_ = special::real_where(
            special::unsigned_zeros(1.0 / tmp), [](double v) { return std::asinh(v); },
            [](const std::complex<double> &v) {
                return std::asinh(special::left_below_minus_i(v));
            },
            [](double) { return true; });
    };

    void bvisit(const ACosh &x)
    {
        T tmp = apply(*(x.get_arg()));
        result_ = special::real_where(
            tmp, [](double v) { return std::acosh(v); },
            [](const std::complex<double> &v) { return std::acosh(v); },
            [](double v) { return v >= 1; });
    };

    void bvisit(const ATanh &x)
    {
        T tmp = apply(*(x.get_arg()));
        result_ = special::real_where(
            tmp, [](double v) { return std::atanh(v); },
            [](const std::complex<double> &v) {
                return std::atanh(special::below_beyond_one(v));
            },
            [](double v) { return v > -1 and v < 1; });
    };

    void bvisit(const ACoth &x)
    {
        T tmp = apply(*(x.get_arg()));
        result_ = special::real_where(
            special::unsigned_zeros(1.0 / tmp), [](double v) { return std::atanh(v); },
            [](const std::complex<double> &v) {
                return std::atanh(special::below_beyond_one(v));
            },
            [](double v) { return v > -1 and v < 1; });
    };

    void bvisit(const ASech &x)
    {
        T tmp = apply(*(x.get_arg()));
        result_ = special::real_where(
            special::unsigned_zeros(1.0 / tmp), [](double v) { return std::acosh(v); },
            [](const std::complex<double> &v) { return std::acosh(v); },
            [](double v) { return v >= 1; });
    };

    void bvisit(const Constant &x)
    {
        if (eq(x, *pi)) {
            result_ = std::atan2(0, -1);
        } else if (eq(x, *E)) {
            result_ = std::exp(1);
        } else if (eq(x, *EulerGamma)) {
            result_ = 0.5772156649015328606065; // use until polygamma or
                                                // digamma is implemented
        } else if (eq(x, *Catalan)) {
            result_ = 0.9159655941772190150546;
        } else if (eq(x, *GoldenRatio)) {
            result_ = 1.6180339887498948482045;
        } else {
            throw NotImplementedError("Constant " + x.get_name()
                                      + " is not implemented.");
        }
    };

    void bvisit(const Abs &x)
    {
        T tmp = apply(*(x.get_arg()));
        result_ = std::abs(tmp);
    };

    // lakutata: the special functions and the ones of integer parts, for real
    // and complex values (special_double.h); NaN where a real value has none
    void bvisit(const Sign &x)
    {
        result_ = special::sign(apply(*(x.get_arg())));
    }

    void bvisit(const Floor &x)
    {
        result_ = special::floor(apply(*(x.get_arg())));
    }

    void bvisit(const Ceiling &x)
    {
        result_ = special::ceiling(apply(*(x.get_arg())));
    }

    void bvisit(const Truncate &x)
    {
        result_ = special::truncate(apply(*(x.get_arg())));
    }

    void bvisit(const Conjugate &x)
    {
        result_ = special::conjugate(apply(*(x.get_arg())));
    }

    void bvisit(const Gamma &x)
    {
        T tmp = apply(*(x.get_args()[0]));
        special::assign(result_, special::gamma(std::complex<double>(tmp)));
    }

    void bvisit(const LogGamma &x)
    {
        T tmp = apply(*(x.get_args()[0]));
        special::assign(result_, special::loggamma(std::complex<double>(tmp)));
    }

    void bvisit(const Erf &x)
    {
        T tmp = apply(*(x.get_args()[0]));
        special::assign(result_, special::erf(std::complex<double>(tmp)));
    }

    void bvisit(const Erfc &x)
    {
        T tmp = apply(*(x.get_args()[0]));
        special::assign(result_, special::erfc(std::complex<double>(tmp)));
    }

    void bvisit(const Zeta &x)
    {
        result_ = special::zeta(apply(*x.get_s()), apply(*x.get_a()));
    }

    void bvisit(const Dirichlet_eta &x)
    {
        result_ = special::dirichlet_eta(apply(*x.get_s()));
    }

    void bvisit(const LambertW &x)
    {
        result_ = special::lambertw(apply(*(x.get_arg())));
    }

    void bvisit(const PolyGamma &x)
    {
        const T order = apply(*(x.get_arg1()));
        const double n = std::real(order);
        if (std::imag(order) != 0 or n < 0 or n != std::floor(n))
            throw NotImplementedError("Not Implemented");
        result_ = special::polygamma(static_cast<unsigned>(n),
                                     apply(*(x.get_arg2())));
    }

    void bvisit(const Beta &x)
    {
        result_ = special::beta(apply(*(x.get_arg1())), apply(*(x.get_arg2())));
    }

    void bvisit(const LowerGamma &x)
    {
        result_ = special::lower_gamma(apply(*(x.get_arg1())),
                                       apply(*(x.get_arg2())));
    }

    void bvisit(const UpperGamma &x)
    {
        result_ = special::upper_gamma(apply(*(x.get_arg1())),
                                       apply(*(x.get_arg2())));
    }

    void bvisit(const Basic &)
    {
        throw NotImplementedError("Not Implemented");
    };

    void bvisit(const NumberWrapper &x)
    {
        apply(*(x.eval(53)));
    }

    void bvisit(const FunctionWrapper &x)
    {
        apply(*(x.eval(53)));
    }

    void bvisit(const UnevaluatedExpr &x)
    {
        apply(*x.get_arg());
    }
};

template <typename C>
class EvalRealDoubleVisitor : public EvalDoubleVisitor<double, C>
{
public:
    // Classes not implemented are
    // Subs, UpperGamma, LowerGamma, Dirichlet_eta, Zeta
    // LeviCivita, KroneckerDelta, LambertW
    // Derivative, Complex, ComplexDouble, ComplexMPC

    using EvalDoubleVisitor<double, C>::bvisit;
    using EvalDoubleVisitor<double, C>::apply;
    using EvalDoubleVisitor<double, C>::result_;

    void bvisit(const ATan2 &x)
    {
        double num = apply(*(x.get_num()));
        double den = apply(*(x.get_den()));
        result_ = std::atan2(num + 0.0, den); // lakutata: -0.0 as 0
    };

    void bvisit(const Gamma &x)
    {
        double tmp = apply(*(x.get_args()[0]));
        result_ = special::gamma_of(tmp); // lakutata: Boost.Math's
    };

    void bvisit(const LogGamma &x)
    {
        double tmp = apply(*(x.get_args()[0]));
        result_ = special::loggamma(tmp); // lakutata: NaN left of zero
    }

    void bvisit(const Erf &x)
    {
        double tmp = apply(*(x.get_args()[0]));
        result_ = special::real_erf(tmp); // lakutata: Boost.Math's
    }

    void bvisit(const Erfc &x)
    {
        double tmp = apply(*(x.get_args()[0]));
        result_ = special::real_erfc(tmp); // lakutata: Boost.Math's
    }

    void bvisit(const Equality &x)
    {
        double lhs_ = apply(*(x.get_arg1()));
        double rhs_ = apply(*(x.get_arg2()));
        result_ = (lhs_ == rhs_);
    }

    void bvisit(const Unequality &x)
    {
        double lhs_ = apply(*(x.get_arg1()));
        double rhs_ = apply(*(x.get_arg2()));
        result_ = (lhs_ != rhs_);
    }

    void bvisit(const LessThan &x)
    {
        double lhs_ = apply(*(x.get_arg1()));
        double rhs_ = apply(*(x.get_arg2()));
        result_ = (lhs_ <= rhs_);
    }

    void bvisit(const StrictLessThan &x)
    {
        double lhs_ = apply(*(x.get_arg1()));
        double rhs_ = apply(*(x.get_arg2()));
        result_ = (lhs_ < rhs_);
    }

    void bvisit(const Max &x)
    {
        auto d = x.get_args();
        auto p = d.begin();
        double result = apply(*(*p));
        p++;

        for (; p != d.end(); p++) {
            double tmp = apply(*(*p));
            result = special::max_of(result, tmp);
        }
        result_ = result;
    };

    void bvisit(const Min &x)
    {
        auto d = x.get_args();
        auto p = d.begin();
        double result = apply(*(*p));
        p++;

        for (; p != d.end(); p++) {
            double tmp = apply(*(*p));
            result = special::min_of(result, tmp);
        }
        result_ = result;
    };

    void bvisit(const BooleanAtom &ba)
    {
        result_ = ba.get_val();
    }

    void bvisit(const Piecewise &pw)
    {
        SYMENGINE_ASSERT_MSG(
            eq(*pw.get_vec().back().second, *boolTrue),
            "EvalDouble requires a (Expr, True) at the end of Piecewise");

        for (const auto &expr_pred : pw.get_vec()) {
            if (apply(*expr_pred.second) == 1.0) {
                result_ = apply(*expr_pred.first);
                return;
            }
        }
        throw SymEngineException(
            "Unexpectedly reached end of Piecewise function.");
    }
};

class EvalRealDoubleVisitorPattern
    : public EvalRealDoubleVisitor<EvalRealDoubleVisitorPattern>
{
};

class EvalRealDoubleVisitorFinal
    : public EvalRealDoubleVisitor<EvalRealDoubleVisitorFinal>
{
};

class EvalComplexDoubleVisitor
    : public EvalDoubleVisitor<std::complex<double>, EvalComplexDoubleVisitor>
{
public:
    // Classes not implemented are
    // Subs, UpperGamma, LowerGamma, Dirichlet_eta, Zeta
    // LeviCivita, KroneckerDelta, LambertW
    // Derivative, ATan2, Gamma

    using EvalDoubleVisitor::bvisit;

    // lakutata: the maximum and the minimum of real values (of imaginary parts
    // 0); of complex numbers, none
    void bvisit(const Max &x)
    {
        result_ = extremum(x.get_args(), true);
    }

    void bvisit(const Min &x)
    {
        result_ = extremum(x.get_args(), false);
    }

    std::complex<double> extremum(const vec_basic &args, bool maximum)
    {
        double result = 0;
        for (size_t i = 0; i < args.size(); i++) {
            const std::complex<double> value = apply(*args[i]);
            if (value.imag() != 0)
                throw NotImplementedError("The maximum of complex numbers");
            result = i == 0      ? value.real()
                     : maximum ? special::max_of(result, value.real())
                               : special::min_of(result, value.real());
        }
        return result;
    }

    // lakutata: atan2 of real values
    void bvisit(const ATan2 &x)
    {
        const std::complex<double> num = apply(*(x.get_num()));
        const std::complex<double> den = apply(*(x.get_den()));
        if (num.imag() != 0 or den.imag() != 0)
            throw NotImplementedError("Not Implemented");
        result_ = std::atan2(num.real() + 0.0, den.real());
    }

    void bvisit(const Complex &x)
    {
        result_
            = std::complex<double>(mp_get_d(x.real_), mp_get_d(x.imaginary_));
    };

    void bvisit(const ComplexDouble &x)
    {
        result_ = x.i;
    };
#ifdef HAVE_SYMENGINE_MPC
    void bvisit(const ComplexMPC &x)
    {
        mpfr_class t(x.get_prec());
        double real, imag;
        mpc_real(t.get_mpfr_t(), x.as_mpc().get_mpc_t(), MPFR_RNDN);
        real = mpfr_get_d(t.get_mpfr_t(), MPFR_RNDN);
        mpc_imag(t.get_mpfr_t(), x.as_mpc().get_mpc_t(), MPFR_RNDN);
        imag = mpfr_get_d(t.get_mpfr_t(), MPFR_RNDN);
        result_ = std::complex<double>(real, imag);
    }
#endif
};

/*
 * These two seem to be equivalent and about the same fast.
 */
// typedef double (*fn)(const Basic &);
typedef std::function<double(const Basic &)> fn;

static inline std::vector<fn> init_eval_double()
{
    std::vector<fn> table;
    table.assign(TypeID_Count, [](const Basic &x) -> double {
        throw NotImplementedError("Not Implemented");
    });
    table[SYMENGINE_INTEGER] = [](const Basic &x) {
        double tmp
            = mp_get_d((down_cast<const Integer &>(x)).as_integer_class());
        return tmp;
    };
    table[SYMENGINE_RATIONAL] = [](const Basic &x) {
        double tmp
            = mp_get_d((down_cast<const Rational &>(x)).as_rational_class());
        return tmp;
    };
    table[SYMENGINE_REAL_DOUBLE] = [](const Basic &x) {
        double tmp = (down_cast<const RealDouble &>(x)).i;
        return tmp;
    };
#ifdef HAVE_SYMENGINE_MPFR
    table[SYMENGINE_REAL_MPFR] = [](const Basic &x) {
        double tmp = mpfr_get_d(down_cast<const RealMPFR &>(x).i.get_mpfr_t(),
                                MPFR_RNDN);
        return tmp;
    };
#endif
    table[SYMENGINE_ADD] = [](const Basic &x) {
        double tmp = 0;
        for (const auto &p : x.get_args())
            tmp += eval_double_single_dispatch(*p);
        return tmp;
    };
    table[SYMENGINE_MUL] = [](const Basic &x) {
        double tmp = 1;
        for (const auto &p : x.get_args())
            tmp *= eval_double_single_dispatch(*p);
        return tmp;
    };
    table[SYMENGINE_POW] = [](const Basic &x) {
        double a = eval_double_single_dispatch(
            *(down_cast<const Pow &>(x)).get_base());
        double b = eval_double_single_dispatch(
            *(down_cast<const Pow &>(x)).get_exp());
        return ::pow(a, b);
    };
    table[SYMENGINE_SIN] = [](const Basic &x) {
        double tmp = eval_double_single_dispatch(
            *(down_cast<const Sin &>(x)).get_arg());
        return ::sin(tmp);
    };
    table[SYMENGINE_COS] = [](const Basic &x) {
        double tmp = eval_double_single_dispatch(
            *(down_cast<const Cos &>(x)).get_arg());
        return ::cos(tmp);
    };
    table[SYMENGINE_TAN] = [](const Basic &x) {
        double tmp = eval_double_single_dispatch(
            *(down_cast<const Tan &>(x)).get_arg());
        return ::tan(tmp);
    };
    table[SYMENGINE_LOG] = [](const Basic &x) {
        double tmp = eval_double_single_dispatch(
            *(down_cast<const Log &>(x)).get_arg());
        return ::log(tmp);
    };
    table[SYMENGINE_COT] = [](const Basic &x) {
        double tmp = eval_double_single_dispatch(
            *(down_cast<const Cot &>(x)).get_arg());
        return 1 / ::tan(tmp);
    };
    table[SYMENGINE_CSC] = [](const Basic &x) {
        double tmp = eval_double_single_dispatch(
            *(down_cast<const Csc &>(x)).get_arg());
        return 1 / ::sin(tmp);
    };
    table[SYMENGINE_SEC] = [](const Basic &x) {
        double tmp = eval_double_single_dispatch(
            *(down_cast<const Sec &>(x)).get_arg());
        return 1 / ::cos(tmp);
    };
    table[SYMENGINE_ASIN] = [](const Basic &x) {
        double tmp = eval_double_single_dispatch(
            *(down_cast<const ASin &>(x)).get_arg());
        return ::asin(tmp);
    };
    table[SYMENGINE_ACOS] = [](const Basic &x) {
        double tmp = eval_double_single_dispatch(
            *(down_cast<const ACos &>(x)).get_arg());
        return ::acos(tmp);
    };
    table[SYMENGINE_ASEC] = [](const Basic &x) {
        double tmp = eval_double_single_dispatch(
            *(down_cast<const ASec &>(x)).get_arg());
        return ::acos(1 / tmp);
    };
    table[SYMENGINE_ACSC] = [](const Basic &x) {
        double tmp = eval_double_single_dispatch(
            *(down_cast<const ACsc &>(x)).get_arg());
        return ::asin(1 / tmp);
    };
    table[SYMENGINE_ATAN] = [](const Basic &x) {
        double tmp = eval_double_single_dispatch(
            *(down_cast<const ATan &>(x)).get_arg());
        return ::atan(tmp);
    };
    table[SYMENGINE_ACOT] = [](const Basic &x) {
        double tmp = eval_double_single_dispatch(
            *(down_cast<const ACot &>(x)).get_arg());
        return ::atan(1 / tmp);
    };
    table[SYMENGINE_ATAN2] = [](const Basic &x) {
        double num = eval_double_single_dispatch(
            *(down_cast<const ATan2 &>(x)).get_num());
        double den = eval_double_single_dispatch(
            *(down_cast<const ATan2 &>(x)).get_den());
        return ::atan2(num, den);
    };
    table[SYMENGINE_SINH] = [](const Basic &x) {
        double tmp = eval_double_single_dispatch(
            *(down_cast<const Sinh &>(x)).get_arg());
        return ::sinh(tmp);
    };
    table[SYMENGINE_CSCH] = [](const Basic &x) {
        double tmp = eval_double_single_dispatch(
            *(down_cast<const Csch &>(x)).get_arg());
        return 1 / ::sinh(tmp);
    };
    table[SYMENGINE_COSH] = [](const Basic &x) {
        double tmp = eval_double_single_dispatch(
            *(down_cast<const Cosh &>(x)).get_arg());
        return ::cosh(tmp);
    };
    table[SYMENGINE_SECH] = [](const Basic &x) {
        double tmp = eval_double_single_dispatch(
            *(down_cast<const Sech &>(x)).get_arg());
        return 1 / ::cosh(tmp);
    };
    table[SYMENGINE_TANH] = [](const Basic &x) {
        double tmp = eval_double_single_dispatch(
            *(down_cast<const Tanh &>(x)).get_arg());
        return ::tanh(tmp);
    };
    table[SYMENGINE_COTH] = [](const Basic &x) {
        double tmp = eval_double_single_dispatch(
            *(down_cast<const Coth &>(x)).get_arg());
        return 1 / ::tanh(tmp);
    };
    table[SYMENGINE_ASINH] = [](const Basic &x) {
        double tmp = eval_double_single_dispatch(
            *(down_cast<const ASinh &>(x)).get_arg());
        return ::asinh(tmp);
    };
    table[SYMENGINE_ACSCH] = [](const Basic &x) {
        double tmp = eval_double_single_dispatch(
            *(down_cast<const ACsch &>(x)).get_arg());
        return ::asinh(1 / tmp);
    };
    table[SYMENGINE_ACOSH] = [](const Basic &x) {
        double tmp = eval_double_single_dispatch(
            *(down_cast<const ACosh &>(x)).get_arg());
        return ::acosh(tmp);
    };
    table[SYMENGINE_ATANH] = [](const Basic &x) {
        double tmp = eval_double_single_dispatch(
            *(down_cast<const ATanh &>(x)).get_arg());
        return ::atanh(tmp);
    };
    table[SYMENGINE_ACOTH] = [](const Basic &x) {
        double tmp = eval_double_single_dispatch(
            *(down_cast<const ACoth &>(x)).get_arg());
        return std::atanh(1 / tmp);
    };
    table[SYMENGINE_ASECH] = [](const Basic &x) {
        double tmp = eval_double_single_dispatch(
            *(down_cast<const ASech &>(x)).get_arg());
        return ::acosh(1 / tmp);
    };
    table[SYMENGINE_GAMMA] = [](const Basic &x) {
        double tmp = eval_double_single_dispatch(
            *(down_cast<const Gamma &>(x)).get_args()[0]);
        return special::gamma_of(tmp); // lakutata: Boost.Math's
    };
    table[SYMENGINE_LOGGAMMA] = [](const Basic &x) {
        double tmp = eval_double_single_dispatch(
            *(down_cast<const LogGamma &>(x)).get_args()[0]);
        return special::loggamma(tmp); // lakutata: Boost.Math's, NaN left of zero
    };
    table[SYMENGINE_ERF] = [](const Basic &x) {
        double tmp = eval_double_single_dispatch(
            *(down_cast<const Erf &>(x)).get_args()[0]);
        return special::real_erf(tmp); // lakutata: Boost.Math's
    };
    table[SYMENGINE_ERFC] = [](const Basic &x) {
        double tmp = eval_double_single_dispatch(
            *(down_cast<const Erfc &>(x)).get_args()[0]);
        return special::real_erfc(tmp); // lakutata: Boost.Math's
    };
    table[SYMENGINE_EQUALITY] = [](const Basic &x) {
        double lhs = eval_double_single_dispatch(
            *(down_cast<const Equality &>(x)).get_arg1());
        double rhs = eval_double_single_dispatch(
            *(down_cast<const Equality &>(x)).get_arg2());
        return (lhs == rhs);
    };
    table[SYMENGINE_UNEQUALITY] = [](const Basic &x) {
        double lhs = eval_double_single_dispatch(
            *(down_cast<const Unequality &>(x)).get_arg1());
        double rhs = eval_double_single_dispatch(
            *(down_cast<const Unequality &>(x)).get_arg2());
        return (lhs != rhs);
    };
    table[SYMENGINE_LESSTHAN] = [](const Basic &x) {
        double lhs = eval_double_single_dispatch(
            *(down_cast<const LessThan &>(x)).get_arg1());
        double rhs = eval_double_single_dispatch(
            *(down_cast<const LessThan &>(x)).get_arg2());
        return (lhs <= rhs);
    };
    table[SYMENGINE_STRICTLESSTHAN] = [](const Basic &x) {
        double lhs = eval_double_single_dispatch(
            *(down_cast<const StrictLessThan &>(x)).get_arg1());
        double rhs = eval_double_single_dispatch(
            *(down_cast<const StrictLessThan &>(x)).get_arg2());
        return (lhs < rhs);
    };
    table[SYMENGINE_CONSTANT] = [](const Basic &x) {
        if (eq(x, *pi)) {
            return std::atan2(0, -1);
        } else if (eq(x, *E)) {
            return std::exp(1);
        } else if (eq(x, *EulerGamma)) {
            return 0.5772156649015328606065; // use until polygamma or digamma
                                             // is implemented
        } else if (eq(x, *Catalan)) {
            return 0.9159655941772190150546;
        } else if (eq(x, *GoldenRatio)) {
            return 1.6180339887498948482045;
        } else {
            throw NotImplementedError(
                "Constant " + down_cast<const Constant &>(x).get_name()
                + " is not implemented.");
        }
    };
    table[SYMENGINE_ABS] = [](const Basic &x) {
        double tmp = eval_double_single_dispatch(
            *(down_cast<const Abs &>(x)).get_arg());
        return std::abs(tmp);
    };
    table[SYMENGINE_MAX] = [](const Basic &x) {
        double result;
        result = eval_double_single_dispatch(
            *(down_cast<const Max &>(x).get_args()[0]));
        for (const auto &p : down_cast<const Max &>(x).get_args()) {
            double tmp = eval_double_single_dispatch(*p);
            result = special::max_of(result, tmp);
        }
        return result;
    };
    table[SYMENGINE_MIN] = [](const Basic &x) {
        double result;
        result = eval_double_single_dispatch(
            *(down_cast<const Min &>(x).get_args()[0]));
        for (const auto &p : down_cast<const Min &>(x).get_args()) {
            double tmp = eval_double_single_dispatch(*p);
            result = special::min_of(result, tmp);
        }
        return result;
    };
    return table;
}

double eval_double(const Basic &b)
{
    EvalRealDoubleVisitorFinal v;
    return v.apply(b);
}

std::complex<double> eval_complex_double(const Basic &b)
{
    EvalComplexDoubleVisitor v;
    return v.apply(b);
}

double eval_double_single_dispatch(const Basic &b)
{
    // lakutata: never destroyed, the threads of the addon may use it when the process exits
    static const std::vector<fn> &table_eval_double
        = *new std::vector<fn>(init_eval_double());
    return table_eval_double[b.get_type_code()](b);
}

double eval_double_visitor_pattern(const Basic &b)
{
    EvalRealDoubleVisitorPattern v;
    return v.apply(b);
}

#define ACCEPT(CLASS)                                                          \
    void CLASS::accept(EvalRealDoubleVisitorFinal &v) const                    \
    {                                                                          \
        v.bvisit(*this);                                                       \
    }

#define SYMENGINE_ENUM(TypeID, Class) ACCEPT(Class)
#include "symengine/type_codes.inc"
#undef SYMENGINE_ENUM

} // namespace SymEngine
