#ifndef SYMENGINE_LAMBDA_DOUBLE_H
#define SYMENGINE_LAMBDA_DOUBLE_H

#include <cmath>
#include <limits>
#include <symengine/eval_double.h>
#include <symengine/special_double.h>
#include <symengine/symengine_exception.h>
#include <symengine/visitor.h>

namespace SymEngine
{

template <typename T>
class LambdaDoubleVisitor : public BaseVisitor<LambdaDoubleVisitor<T>>
{
protected:
    /*
       The 'result_' variable is assigned into at the very end of each visit()
       methods below. The only place where these methods are called from is the
       line 'b.accept(*this)' in apply() and the 'result_' is immediately
       returned. Thus no corruption can happen and apply() can be safely called
       recursively.
    */

    typedef std::function<T(const T *x)> fn;
    std::vector<fn> results;
    std::vector<T> cse_intermediate_results;

    std::map<RCP<const Basic>, size_t, RCPBasicKeyLess>
        cse_intermediate_fns_map;
    std::vector<fn> cse_intermediate_fns;
    fn result_;
    vec_basic symbols;

public:
    LambdaDoubleVisitor() = default;
    LambdaDoubleVisitor(LambdaDoubleVisitor &&) = default;
    LambdaDoubleVisitor &operator=(LambdaDoubleVisitor &&) = default;
    // delete copy constructor:
    // https://github.com/symengine/symengine/issues/1674
    LambdaDoubleVisitor(const LambdaDoubleVisitor &) = delete;
    LambdaDoubleVisitor &operator=(const LambdaDoubleVisitor &) = delete;

    void init(const vec_basic &x, const Basic &b, bool cse = false)
    {
        vec_basic outputs = {b.rcp_from_this()};
        init(x, outputs, cse);
    }

    void init(const vec_basic &inputs, const vec_basic &outputs,
              bool cse = false)
    {
        results.clear();
        cse_intermediate_fns.clear();
        symbols = inputs;
        if (not cse) {
            for (auto &p : outputs) {
                results.push_back(apply(*p));
            }
        } else {
            vec_basic reduced_exprs;
            vec_pair replacements;
            // cse the outputs
            SymEngine::cse(replacements, reduced_exprs, outputs);
            cse_intermediate_results.resize(replacements.size());
            for (auto &rep : replacements) {
                auto res = apply(*(rep.second));
                // Store the replacement symbol values in a dictionary for
                // faster
                // lookup for initialization
                cse_intermediate_fns_map[rep.first]
                    = cse_intermediate_fns.size();
                // Store it in a vector for faster use in call
                cse_intermediate_fns.push_back(res);
            }
            // Generate functions for all the reduced exprs and save it
            for (unsigned i = 0; i < outputs.size(); i++) {
                results.push_back(apply(*reduced_exprs[i]));
            }
            // We don't need the cse_intermediate_fns_map anymore
            cse_intermediate_fns_map.clear();
            symbols.clear();
        }
    }

    fn apply(const Basic &b)
    {
        b.accept(*this);
        // lakutata: the complex values without negative zeros
        // (special_double.h), as the numeric evaluation
        if constexpr (std::is_same<T, std::complex<double>>::value) {
            const fn value = result_;
            result_ = [value](const T *x) {
                return special::unsigned_zeros(value(x));
            };
        }
        return result_;
    }

    T call(const std::vector<T> &vec)
    {
        T res;
        call(&res, vec.data());
        return res;
    }

    void call(T *outs, const T *inps)
    {
        if (cse_intermediate_fns.size() > 0) {
            for (unsigned i = 0; i < cse_intermediate_fns.size(); ++i) {
                cse_intermediate_results[i] = cse_intermediate_fns[i](inps);
            }
        }
        for (unsigned i = 0; i < results.size(); ++i) {
            outs[i] = results[i](inps);
        }
        return;
    }

    void bvisit(const Symbol &x)
    {
        for (unsigned i = 0; i < symbols.size(); ++i) {
            if (eq(x, *symbols[i])) {
                result_ = [=](const T *x) { return x[i]; };
                return;
            }
        }
        auto it = cse_intermediate_fns_map.find(x.rcp_from_this());
        if (it != cse_intermediate_fns_map.end()) {
            auto index = it->second;
            T *cse_intermediate_result = &(cse_intermediate_results[index]);
            result_ = [=](const T *x) { return *cse_intermediate_result; };
            return;
        }
        throw SymEngineException("Symbol not in the symbols vector.");
    };

    void bvisit(const Integer &x)
    {
        T tmp = mp_get_d(x.as_integer_class());
        result_ = [=](const T *x_) { return tmp; };
    }

    void bvisit(const Rational &x)
    {
        T tmp = mp_get_d(x.as_rational_class());
        result_ = [=](const T *x) { return tmp; };
    }

    void bvisit(const RealDouble &x)
    {
        T tmp = x.i;
        result_ = [=](const T *x) { return tmp; };
    }

#ifdef HAVE_SYMENGINE_MPFR
    void bvisit(const RealMPFR &x)
    {
        T tmp = mpfr_get_d(x.i.get_mpfr_t(), MPFR_RNDN);
        result_ = [=](const T *x) { return tmp; };
    }
#endif

    void bvisit(const Add &x)
    {
        fn tmp = apply(*x.get_coef());
        fn tmp1, tmp2;
        for (const auto &p : x.get_dict()) {
            tmp1 = apply(*(p.first));
            tmp2 = apply(*(p.second));
            tmp = [=](const T *x) { return tmp(x) + tmp1(x) * tmp2(x); };
        }
        result_ = tmp;
    }

    // lakutata: base**exponent, the integer powers by multiplications, the
    // square roots by sqrt (special_double.h), for the powers and the factors
    // of the products (which used std::pow, by exp and log)
    fn power_of(const Basic &base, const Basic &exponent)
    {
        fn exp_ = apply(exponent);
        if (eq(base, *E))
            return [=](const T *x) { return std::exp(exp_(x)); };
        fn base_ = apply(base);
        if (is_a<Integer>(exponent)
            and mp_fits_slong_p(
                down_cast<const Integer &>(exponent).as_integer_class())) {
            const long n
                = mp_get_si(down_cast<const Integer &>(exponent).as_integer_class());
            if (n == 1)
                return base_;
            return [=](const T *x) {
                return special::integer_power(base_(x), n);
            };
        }
        if (eq(exponent, *rational(1, 2)))
            return [=](const T *x) { return std::sqrt(base_(x)); };
        return [=](const T *x) { return std::pow(base_(x), exp_(x)); };
    }

    void bvisit(const Mul &x)
    {
        fn tmp = apply(*x.get_coef());
        for (const auto &p : x.get_dict()) {
            const fn factor = power_of(*(p.first), *(p.second));
            tmp = [=](const T *x) { return tmp(x) * factor(x); };
        }
        result_ = tmp;
    }

    void bvisit(const Pow &x)
    {
        result_ = power_of(*(x.get_base()), *(x.get_exp()));
    }

    void bvisit(const Sin &x)
    {
        fn tmp = apply(*(x.get_arg()));
        result_ = [=](const T *x) { return std::sin(tmp(x)); };
    }

    void bvisit(const Cos &x)
    {
        fn tmp = apply(*(x.get_arg()));
        result_ = [=](const T *x) { return std::cos(tmp(x)); };
    }

    void bvisit(const Tan &x)
    {
        fn tmp = apply(*(x.get_arg()));
        result_ = [=](const T *x) { return std::tan(tmp(x)); };
    }

    void bvisit(const Log &x)
    {
        fn tmp = apply(*(x.get_arg()));
        result_ = [=](const T *x) { return std::log(tmp(x)); };
    };

    void bvisit(const Cot &x)
    {
        fn tmp = apply(*(x.get_arg()));
        result_ = [=](const T *x) { return 1.0 / std::tan(tmp(x)); };
    };

    void bvisit(const Csc &x)
    {
        fn tmp = apply(*(x.get_arg()));
        result_ = [=](const T *x) { return 1.0 / std::sin(tmp(x)); };
    };

    void bvisit(const Sec &x)
    {
        fn tmp = apply(*(x.get_arg()));
        result_ = [=](const T *x) { return 1.0 / std::cos(tmp(x)); };
    };

    void bvisit(const ASin &x)
    {
        fn tmp = apply(*(x.get_arg()));
        // lakutata: in the reals where the argument is real (special_double.h)
        result_ = [=](const T *x) {
            return special::real_where(
                tmp(x), [](double v) { return std::asin(v); },
                [](const std::complex<double> &v) { return std::asin(v); },
                [](double v) { return v >= -1 and v <= 1; });
        };
    };

    void bvisit(const ACos &x)
    {
        fn tmp = apply(*(x.get_arg()));
        // lakutata: in the reals where the argument is real (special_double.h)
        result_ = [=](const T *x) {
            return special::real_where(
                tmp(x), [](double v) { return std::acos(v); },
                [](const std::complex<double> &v) { return std::acos(v); },
                [](double v) { return v >= -1 and v <= 1; });
        };
    };

    void bvisit(const ASec &x)
    {
        fn tmp = apply(*(x.get_arg()));
        // lakutata: in the reals where the argument is real (special_double.h)
        result_ = [=](const T *x) {
            return special::real_where(
                1.0 / tmp(x), [](double v) { return std::acos(v); },
                [](const std::complex<double> &v) { return std::acos(v); },
                [](double v) { return v >= -1 and v <= 1; });
        };
    };

    void bvisit(const ACsc &x)
    {
        fn tmp = apply(*(x.get_arg()));
        // lakutata: in the reals where the argument is real (special_double.h)
        result_ = [=](const T *x) {
            return special::real_where(
                1.0 / tmp(x), [](double v) { return std::asin(v); },
                [](const std::complex<double> &v) { return std::asin(v); },
                [](double v) { return v >= -1 and v <= 1; });
        };
    };

    void bvisit(const ATan &x)
    {
        fn tmp = apply(*(x.get_arg()));
        // lakutata: in the reals where the argument is real (special_double.h)
        result_ = [=](const T *x) {
            return special::real_where(
                tmp(x), [](double v) { return std::atan(v); },
                [](const std::complex<double> &v) { return std::atan(v); },
                [](double) { return true; });
        };
    };

    void bvisit(const ACot &x)
    {
        fn tmp = apply(*(x.get_arg()));
        // lakutata: in the reals where the argument is real (special_double.h)
        result_ = [=](const T *x) {
            return special::real_where(
                1.0 / tmp(x), [](double v) { return std::atan(v); },
                [](const std::complex<double> &v) { return std::atan(v); },
                [](double) { return true; });
        };
    };

    void bvisit(const Sinh &x)
    {
        fn tmp = apply(*(x.get_arg()));
        result_ = [=](const T *x) { return std::sinh(tmp(x)); };
    };

    void bvisit(const Csch &x)
    {
        fn tmp = apply(*(x.get_arg()));
        result_ = [=](const T *x) { return 1.0 / std::sinh(tmp(x)); };
    };

    void bvisit(const Cosh &x)
    {
        fn tmp = apply(*(x.get_arg()));
        result_ = [=](const T *x) { return std::cosh(tmp(x)); };
    };

    void bvisit(const Sech &x)
    {
        fn tmp = apply(*(x.get_arg()));
        result_ = [=](const T *x) { return 1.0 / std::cosh(tmp(x)); };
    };

    void bvisit(const Tanh &x)
    {
        fn tmp = apply(*(x.get_arg()));
        result_ = [=](const T *x) { return std::tanh(tmp(x)); };
    };

    void bvisit(const Coth &x)
    {
        fn tmp = apply(*(x.get_arg()));
        result_ = [=](const T *x) { return 1.0 / std::tanh(tmp(x)); };
    };

    void bvisit(const ASinh &x)
    {
        fn tmp = apply(*(x.get_arg()));
        // lakutata: in the reals where the argument is real (special_double.h)
        result_ = [=](const T *x) {
            return special::real_where(
                tmp(x), [](double v) { return std::asinh(v); },
                [](const std::complex<double> &v) { return std::asinh(v); },
                [](double) { return true; });
        };
    };

    void bvisit(const ACsch &x)
    {
        fn tmp = apply(*(x.get_arg()));
        // lakutata: in the reals where the argument is real (special_double.h)
        result_ = [=](const T *x) {
            return special::real_where(
                1.0 / tmp(x), [](double v) { return std::asinh(v); },
                [](const std::complex<double> &v) { return std::asinh(v); },
                [](double) { return true; });
        };
    };

    void bvisit(const ACosh &x)
    {
        fn tmp = apply(*(x.get_arg()));
        // lakutata: in the reals where the argument is real (special_double.h)
        result_ = [=](const T *x) {
            return special::real_where(
                tmp(x), [](double v) { return std::acosh(v); },
                [](const std::complex<double> &v) { return std::acosh(v); },
                [](double v) { return v >= 1; });
        };
    };

    void bvisit(const ATanh &x)
    {
        fn tmp = apply(*(x.get_arg()));
        // lakutata: in the reals where the argument is real (special_double.h)
        result_ = [=](const T *x) {
            return special::real_where(
                tmp(x), [](double v) { return std::atanh(v); },
                [](const std::complex<double> &v) { return std::atanh(v); },
                [](double v) { return v > -1 and v < 1; });
        };
    };

    void bvisit(const ACoth &x)
    {
        fn tmp = apply(*(x.get_arg()));
        // lakutata: in the reals where the argument is real (special_double.h)
        result_ = [=](const T *x) {
            return special::real_where(
                1.0 / tmp(x), [](double v) { return std::atanh(v); },
                [](const std::complex<double> &v) { return std::atanh(v); },
                [](double v) { return v > -1 and v < 1; });
        };
    };

    void bvisit(const ASech &x)
    {
        fn tmp = apply(*(x.get_arg()));
        // lakutata: in the reals where the argument is real (special_double.h)
        result_ = [=](const T *x) {
            return special::real_where(
                1.0 / tmp(x), [](double v) { return std::acosh(v); },
                [](const std::complex<double> &v) { return std::acosh(v); },
                [](double v) { return v >= 1; });
        };
    };

    void bvisit(const Constant &x)
    {
        T tmp = eval_double(x);
        result_ = [=](const T *x) { return tmp; };
    };

    void bvisit(const Abs &x)
    {
        fn tmp = apply(*(x.get_arg()));
        result_ = [=](const T *x) { return std::abs(tmp(x)); };
    };

    void bvisit(const Basic &)
    {
        throw NotImplementedError("Not Implemented");
    };

    void bvisit(const UnevaluatedExpr &x)
    {
        apply(*x.get_arg());
    };
};

class LambdaRealDoubleVisitor
    : public BaseVisitor<LambdaRealDoubleVisitor, LambdaDoubleVisitor<double>>
{
public:
    // Classes not implemented are
    // Subs, UpperGamma, LowerGamma, Dirichlet_eta, Zeta
    // LeviCivita, KroneckerDelta, FunctionSymbol, LambertW
    // Derivative, Complex, ComplexDouble, ComplexMPC

    using LambdaDoubleVisitor::bvisit;

    void bvisit(const ATan2 &x)
    {
        fn num = apply(*(x.get_num()));
        fn den = apply(*(x.get_den()));
        // lakutata: + 0.0 makes -0.0 a 0 (atan2(-0.0, -1) is -pi, the exact one pi)
        result_ = [=](const double *x) { return std::atan2(num(x) + 0.0, den(x)); };
    };

    void bvisit(const Gamma &x)
    {
        fn tmp = apply(*(x.get_args()[0]));
        result_ = [=](const double *x) { return std::tgamma(tmp(x)); };
    };

    void bvisit(const LogGamma &x)
    {
        fn tmp = apply(*(x.get_args()[0]));
        // lakutata: NaN left of zero, where log gamma is not real
        result_ = [=](const double *x) { return special::loggamma(tmp(x)); };
    };

    // lakutata: the special functions of special_double.h
    void bvisit(const Zeta &x)
    {
        fn s = apply(*x.get_s()), a = apply(*x.get_a());
        result_ = [=](const double *x) { return special::zeta(s(x), a(x)); };
    };

    void bvisit(const Dirichlet_eta &x)
    {
        fn s = apply(*x.get_s());
        result_ = [=](const double *x) { return special::dirichlet_eta(s(x)); };
    };

    void bvisit(const LambertW &x)
    {
        fn tmp = apply(*(x.get_arg()));
        result_ = [=](const double *x) { return special::lambertw(tmp(x)); };
    };

    void bvisit(const PolyGamma &x)
    {
        fn n = apply(*(x.get_arg1())), tmp = apply(*(x.get_arg2()));
        result_ = [=](const double *x) {
            const double order = n(x);
            if (order < 0 or order != std::floor(order))
                return std::numeric_limits<double>::quiet_NaN();
            return special::polygamma(static_cast<unsigned>(order), tmp(x));
        };
    };

    void bvisit(const Beta &x)
    {
        fn a = apply(*(x.get_arg1())), b = apply(*(x.get_arg2()));
        result_ = [=](const double *x) { return special::beta(a(x), b(x)); };
    };

    void bvisit(const LowerGamma &x)
    {
        fn s = apply(*(x.get_arg1())), t = apply(*(x.get_arg2()));
        result_ = [=](const double *x) { return special::lower_gamma(s(x), t(x)); };
    };

    void bvisit(const UpperGamma &x)
    {
        fn s = apply(*(x.get_arg1())), t = apply(*(x.get_arg2()));
        result_ = [=](const double *x) { return special::upper_gamma(s(x), t(x)); };
    };

    void bvisit(const Conjugate &x)
    {
        result_ = apply(*(x.get_arg()));
    };

    // lakutata: a function wrapper, by its value for the values of its
    // arguments (FunctionWrapper::evaluate_real)
    void bvisit(const FunctionWrapper &x)
    {
        std::vector<fn> arguments;
        for (const auto &argument : x.get_args())
            arguments.push_back(apply(*argument));
        const RCP<const FunctionWrapper> function
            = rcp_static_cast<const FunctionWrapper>(x.rcp_from_this());
        result_ = [=](const double *x) {
            double values[8];
            std::vector<double> many;
            double *at = values;
            if (arguments.size() > 8) {
                many.resize(arguments.size());
                at = many.data();
            }
            for (size_t i = 0; i < arguments.size(); i++)
                at[i] = arguments[i](x);
            return function->evaluate_real(at);
        };
    };

    void bvisit(const Erf &x)
    {
        fn tmp = apply(*(x.get_args()[0]));
        result_ = [=](const double *x) { return std::erf(tmp(x)); };
    }

    void bvisit(const Erfc &x)
    {
        fn tmp = apply(*(x.get_args()[0]));
        result_ = [=](const double *x) { return std::erfc(tmp(x)); };
    }

    void bvisit(const Equality &x)
    {
        fn lhs_ = apply(*(x.get_arg1()));
        fn rhs_ = apply(*(x.get_arg2()));
        result_ = [=](const double *x) { return (lhs_(x) == rhs_(x)); };
    }

    void bvisit(const Unequality &x)
    {
        fn lhs_ = apply(*(x.get_arg1()));
        fn rhs_ = apply(*(x.get_arg2()));
        result_ = [=](const double *x) { return (lhs_(x) != rhs_(x)); };
    }

    void bvisit(const LessThan &x)
    {
        fn lhs_ = apply(*(x.get_arg1()));
        fn rhs_ = apply(*(x.get_arg2()));
        result_ = [=](const double *x) { return (lhs_(x) <= rhs_(x)); };
    }

    void bvisit(const StrictLessThan &x)
    {
        fn lhs_ = apply(*(x.get_arg1()));
        fn rhs_ = apply(*(x.get_arg2()));
        result_ = [=](const double *x) { return (lhs_(x) < rhs_(x)); };
    }

    void bvisit(const And &x)
    {
        std::vector<fn> applys;
        for (const auto &p : x.get_args()) {
            applys.push_back(apply(*p));
        }

        result_ = [=](const double *x) {
            bool result = bool(applys[0](x));
            for (unsigned int i = 0; i < applys.size(); i++) {
                result = result && bool(applys[i](x));
            }
            return double(result);
        };
    }

    void bvisit(const Or &x)
    {
        std::vector<fn> applys;
        for (const auto &p : x.get_args()) {
            applys.push_back(apply(*p));
        }

        result_ = [=](const double *x) {
            bool result = bool(applys[0](x));
            for (unsigned int i = 0; i < applys.size(); i++) {
                result = result || bool(applys[i](x));
            }
            return double(result);
        };
    }

    void bvisit(const Xor &x)
    {
        std::vector<fn> applys;
        for (const auto &p : x.get_args()) {
            applys.push_back(apply(*p));
        }

        result_ = [=](const double *x) {
            bool result = bool(applys[0](x));
            for (unsigned int i = 1; i < applys.size(); i++) {
                result = result != bool(applys[i](x));
            }
            return double(result);
        };
    }

    void bvisit(const Not &x)
    {
        fn tmp = apply(*(x.get_arg()));
        result_ = [=](const double *x) { return double(not bool(tmp(x))); };
    }

    void bvisit(const Max &x)
    {
        std::vector<fn> applys;
        for (const auto &p : x.get_args()) {
            applys.push_back(apply(*p));
        }

        result_ = [=](const double *x) {
            double result = applys[0](x);
            for (unsigned int i = 0; i < applys.size(); i++) {
                result = std::max(result, applys[i](x));
            }
            return result;
        };
    };

    void bvisit(const Min &x)
    {
        std::vector<fn> applys;
        for (const auto &p : x.get_args()) {
            applys.push_back(apply(*p));
        }

        result_ = [=](const double *x) {
            double result = applys[0](x);
            for (unsigned int i = 0; i < applys.size(); i++) {
                result = std::min(result, applys[i](x));
            }
            return result;
        };
    };

    void bvisit(const Sign &x)
    {
        fn tmp = apply(*(x.get_arg()));
        result_ = [=](const double *x) {
            return tmp(x) == 0.0 ? 0.0 : (tmp(x) < 0.0 ? -1.0 : 1.0);
        };
    };

    void bvisit(const Floor &x)
    {
        fn tmp = apply(*(x.get_arg()));
        result_ = [=](const double *x) { return std::floor(tmp(x)); };
    };

    void bvisit(const Ceiling &x)
    {
        fn tmp = apply(*(x.get_arg()));
        result_ = [=](const double *x) { return std::ceil(tmp(x)); };
    };

    void bvisit(const Truncate &x)
    {
        fn tmp = apply(*(x.get_arg()));
        result_ = [=](const double *x) { return std::trunc(tmp(x)); };
    };

    void bvisit(const Infty &x)
    {
        if (x.is_negative_infinity()) {
            result_ = [=](const double * /* x */) {
                return -std::numeric_limits<double>::infinity();
            };
        } else if (x.is_positive_infinity()) {
            result_ = [=](const double * /* x */) {
                return std::numeric_limits<double>::infinity();
            };
        } else {
            throw SymEngineException(
                "LambdaDouble can only represent real valued infinity");
        }
    }
    void bvisit(const NaN &nan)
    {
        assert(&nan == &(*Nan) /* singleton, or do we support NaN quiet/singaling nan with payload? */);
        result_ = [](const double * /* x  */) {
            return std::numeric_limits<double>::signaling_NaN();
        };
    }
    void bvisit(const Contains &cts)
    {
        const auto fn_expr = apply(*cts.get_expr());
        const auto set = cts.get_set();
        if (is_a<Interval>(*set)) {
            const auto &interv = down_cast<const Interval &>(*set);
            const auto fn_start = apply(*interv.get_start());
            const auto fn_end = apply(*interv.get_end());
            const bool left_open = interv.get_left_open();
            const bool right_open = interv.get_right_open();
            result_ = [=](const double *x) {
                const auto val_expr = fn_expr(x);
                const auto val_start = fn_start(x);
                const auto val_end = fn_end(x);
                bool left_ok, right_ok;
                if (val_start == -std::numeric_limits<double>::infinity()) {
                    left_ok = !std::isnan(val_expr);
                } else {
                    left_ok = (left_open) ? (val_start < val_expr)
                                          : (val_start <= val_expr);
                }
                if (val_end == std::numeric_limits<double>::infinity()) {
                    right_ok = !std::isnan(val_expr);
                } else {
                    right_ok = (right_open) ? (val_expr < val_end)
                                            : (val_expr <= val_end);
                }
                return (left_ok && right_ok) ? 1.0 : 0.0;
            };
        } else {
            throw SymEngineException("LambdaDoubleVisitor: only ``Interval`` "
                                     "implemented for ``Contains``.");
        }
    }

    void bvisit(const BooleanAtom &ba)
    {
        const bool val = ba.get_val();
        result_ = [=](const double * /* x */) { return (val) ? 1.0 : 0.0; };
    }

    void bvisit(const Piecewise &pw)
    {
        SYMENGINE_ASSERT_MSG(
            eq(*pw.get_vec().back().second, *boolTrue),
            "LambdaDouble requires a (Expr, True) at the end of Piecewise");

        std::vector<fn> applys;
        std::vector<fn> preds;
        for (const auto &expr_pred : pw.get_vec()) {
            applys.push_back(apply(*expr_pred.first));
            preds.push_back(apply(*expr_pred.second));
        }
        result_ = [=](const double *x) {
            for (size_t i = 0;; ++i) {
                if (preds[i](x) == 1.0) {
                    return applys[i](x);
                }
            }
            throw SymEngineException(
                "Unexpectedly reached end of Piecewise function.");
        };
    }
};

class LambdaComplexDoubleVisitor
    : public BaseVisitor<LambdaComplexDoubleVisitor,
                         LambdaDoubleVisitor<std::complex<double>>>
{
public:
    // lakutata: a function wrapper, by FunctionWrapper::evaluate_complex
    void bvisit(const FunctionWrapper &x)
    {
        std::vector<fn> arguments;
        for (const auto &argument : x.get_args())
            arguments.push_back(apply(*argument));
        const RCP<const FunctionWrapper> function
            = rcp_static_cast<const FunctionWrapper>(x.rcp_from_this());
        result_ = [=](const std::complex<double> *x) {
            std::vector<std::complex<double>> values;
            for (const auto &argument : arguments)
                values.push_back(argument(x));
            return function->evaluate_complex(values.data());
        };
    };

    // Classes not implemented are
    // Subs, UpperGamma, LowerGamma, Dirichlet_eta, Zeta
    // LeviCivita, KroneckerDelta, FunctionSymbol, LambertW
    // Derivative, ATan2, Gamma

    using LambdaDoubleVisitor::bvisit;

    void bvisit(const Complex &x)
    {
        double t1 = mp_get_d(x.real_), t2 = mp_get_d(x.imaginary_);
        result_ = [=](const std::complex<double> *x) {
            return std::complex<double>(t1, t2);
        };
    };

    void bvisit(const ComplexDouble &x)
    {
        std::complex<double> tmp = x.i;
        result_ = [=](const std::complex<double> *x) { return tmp; };
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
        std::complex<double> tmp(real, imag);
        result_ = [=](const std::complex<double> *x) { return tmp; };
    }
#endif
};
} // namespace SymEngine
#endif // SYMENGINE_LAMBDA_DOUBLE_H
