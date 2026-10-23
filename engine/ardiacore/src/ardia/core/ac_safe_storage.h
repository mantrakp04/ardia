#ifndef ARDIA_CORE_AC_SAFE_STORAGE_H_
#define ARDIA_CORE_AC_SAFE_STORAGE_H_

namespace base {
class CommandLine;
}

namespace ardiacore {

void GuardSafeStorageKey(const base::CommandLine& command_line);

}

#endif
