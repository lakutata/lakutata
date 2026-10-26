// lakutata: the checkpoints of the long loops of SymEngine, where the addon stops an operation cancelled or past its
// time limit: a function set by the addon, which throws then (none by default)
#ifndef SYMENGINE_INTERRUPTION_H
#define SYMENGINE_INTERRUPTION_H

namespace SymEngine
{

extern void (*interruption_check)();

inline void check_interruption()
{
    if (interruption_check != nullptr)
        interruption_check();
}

} // namespace SymEngine

#endif
