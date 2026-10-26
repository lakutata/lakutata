// lakutata: see interruption.h
#include <symengine/interruption.h>

namespace SymEngine
{

void (*interruption_check)() = nullptr;

} // namespace SymEngine
