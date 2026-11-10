#pragma once

#include <atomic>
#include <exception>
#include <string>

#include <dbghelp.h>

#include "LaunchLog.h"

#pragma comment(lib, "dbghelp.lib")

namespace Ardia {

struct CrashLog {
  static void Install() noexcept {
    SetUnhandledExceptionFilter(&CrashLog::OnCrash);
    AddVectoredExceptionHandler(1, &CrashLog::OnFirstChance);
    std::set_terminate(&CrashLog::OnTerminate);
  }

 private:
  static constexpr int kMaxFrames = 48;
  static constexpr DWORD kMaxSymbolName = 255;

  static void OnTerminate() noexcept {
    LaunchLog::Write(L"fatal", L"terminate was called: an exception left a noexcept function or no handler took it");
    HANDLE process = GetCurrentProcess();
    SymSetOptions(SYMOPT_LOAD_LINES | SYMOPT_UNDNAME | SYMOPT_DEFERRED_LOADS);
    SymInitializeW(process, nullptr, TRUE);
    void *frames[kMaxFrames]{};
    USHORT count = CaptureStackBackTrace(0, kMaxFrames, frames, nullptr);
    for (USHORT i = 0; i < count; i++) LaunchLog::Write(L"fatal", std::wstring(L"  ").append(Describe(process, reinterpret_cast<DWORD64>(frames[i]))));
    TerminateProcess(process, 3);
  }

  static bool IsHardFault(DWORD code) noexcept {
    return code == EXCEPTION_ACCESS_VIOLATION || code == EXCEPTION_STACK_OVERFLOW || code == EXCEPTION_ILLEGAL_INSTRUCTION ||
           code == EXCEPTION_IN_PAGE_ERROR || code == EXCEPTION_PRIV_INSTRUCTION || code == EXCEPTION_INT_DIVIDE_BY_ZERO ||
           code == EXCEPTION_ARRAY_BOUNDS_EXCEEDED;
  }

  static LONG WINAPI OnFirstChance(EXCEPTION_POINTERS *info) noexcept {
    if (info && info->ExceptionRecord && IsHardFault(info->ExceptionRecord->ExceptionCode)) Report(info);
    return EXCEPTION_CONTINUE_SEARCH;
  }

  static LONG WINAPI OnCrash(EXCEPTION_POINTERS *info) noexcept {
    Report(info);
    return EXCEPTION_CONTINUE_SEARCH;
  }

  static void Report(EXCEPTION_POINTERS *info) noexcept {
    static std::atomic<bool> entered{false};
    if (!info || !info->ExceptionRecord || !info->ContextRecord || entered.exchange(true)) return;
    HANDLE process = GetCurrentProcess();
    SymSetOptions(SYMOPT_LOAD_LINES | SYMOPT_UNDNAME | SYMOPT_DEFERRED_LOADS);
    SymInitializeW(process, nullptr, TRUE);

    wchar_t code[32]{};
    swprintf_s(code, L"0x%08lX", static_cast<unsigned long>(info->ExceptionRecord->ExceptionCode));
    std::wstring headline{L"crash "};
    headline.append(code).append(L" at ").append(Describe(process, reinterpret_cast<DWORD64>(info->ExceptionRecord->ExceptionAddress)));
    if (info->ExceptionRecord->ExceptionCode == EXCEPTION_ACCESS_VIOLATION && info->ExceptionRecord->NumberParameters >= 2) {
      wchar_t target[32]{};
      swprintf_s(target, L"0x%llX", static_cast<unsigned long long>(info->ExceptionRecord->ExceptionInformation[1]));
      headline.append(info->ExceptionRecord->ExceptionInformation[0] == 1 ? L", writing " : L", reading ").append(target);
    }
    LaunchLog::Write(L"fatal", headline);

    CONTEXT context = *info->ContextRecord;
    STACKFRAME64 frame{};
#if defined(_M_X64)
    DWORD machine = IMAGE_FILE_MACHINE_AMD64;
    frame.AddrPC.Offset = context.Rip;
    frame.AddrFrame.Offset = context.Rbp;
    frame.AddrStack.Offset = context.Rsp;
#elif defined(_M_ARM64)
    DWORD machine = IMAGE_FILE_MACHINE_ARM64;
    frame.AddrPC.Offset = context.Pc;
    frame.AddrFrame.Offset = context.Fp;
    frame.AddrStack.Offset = context.Sp;
#else
    DWORD machine = IMAGE_FILE_MACHINE_I386;
    frame.AddrPC.Offset = context.Eip;
    frame.AddrFrame.Offset = context.Ebp;
    frame.AddrStack.Offset = context.Esp;
#endif
    frame.AddrPC.Mode = AddrModeFlat;
    frame.AddrFrame.Mode = AddrModeFlat;
    frame.AddrStack.Mode = AddrModeFlat;
    for (int i = 0; i < kMaxFrames; i++) {
      if (!StackWalk64(machine, process, GetCurrentThread(), &frame, &context, nullptr, SymFunctionTableAccess64, SymGetModuleBase64, nullptr)) break;
      if (!frame.AddrPC.Offset) break;
      LaunchLog::Write(L"fatal", std::wstring(L"  ").append(Describe(process, frame.AddrPC.Offset)));
    }
  }

  static std::wstring Describe(HANDLE process, DWORD64 address) noexcept {
    std::wstring text;
    HMODULE module = nullptr;
    wchar_t path[MAX_PATH]{};
    if (GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT, reinterpret_cast<LPCWSTR>(address), &module) && module &&
        GetModuleFileNameW(module, path, MAX_PATH)) {
      std::wstring full{path};
      size_t slash = full.find_last_of(L"\\/");
      wchar_t offset[32]{};
      swprintf_s(offset, L"+0x%llX", static_cast<unsigned long long>(address - reinterpret_cast<DWORD64>(module)));
      text.append(slash == std::wstring::npos ? full : full.substr(slash + 1)).append(offset);
    } else {
      wchar_t raw[32]{};
      swprintf_s(raw, L"0x%llX", static_cast<unsigned long long>(address));
      text.append(raw);
    }

    alignas(SYMBOL_INFOW) unsigned char storage[sizeof(SYMBOL_INFOW) + (kMaxSymbolName + 1) * sizeof(wchar_t)]{};
    auto *symbol = reinterpret_cast<SYMBOL_INFOW *>(storage);
    symbol->SizeOfStruct = sizeof(SYMBOL_INFOW);
    symbol->MaxNameLen = kMaxSymbolName;
    DWORD64 displacement = 0;
    if (SymFromAddrW(process, address, &displacement, symbol)) text.append(L" ").append(symbol->Name);

    IMAGEHLP_LINEW64 line{};
    line.SizeOfStruct = sizeof(line);
    DWORD column = 0;
    if (SymGetLineFromAddrW64(process, address, &column, &line) && line.FileName) {
      std::wstring file{line.FileName};
      size_t slash = file.find_last_of(L"\\/");
      text.append(L" (").append(slash == std::wstring::npos ? file : file.substr(slash + 1)).append(L":").append(std::to_wstring(line.LineNumber)).append(L")");
    }
    return text;
  }
};

}
