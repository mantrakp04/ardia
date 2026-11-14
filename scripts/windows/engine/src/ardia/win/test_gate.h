#ifndef ARDIA_WIN_TEST_GATE_H_
#define ARDIA_WIN_TEST_GATE_H_

#include <string>

namespace ardia_win {

inline constexpr char kTestInstanceSwitch[] = "ardia-test-instance";
inline constexpr wchar_t kTestBuildMarker[] = L"Ardia.test-build";

std::wstring TestGateRefusal(const std::wstring& data_dir,
                             const std::wstring& chromium_user_data_dir);

std::wstring HoldScratchFolders(const std::wstring& data_dir,
                                const std::wstring& chromium_user_data_dir);

}

#endif
