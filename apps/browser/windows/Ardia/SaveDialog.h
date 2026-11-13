#pragma once

#include <shobjidl.h>

#include <optional>
#include <string>

namespace Ardia {

namespace DialogParts {

struct SaveRequest {
  std::wstring name;
  std::wstring extension;
  std::wstring kind;
  std::wstring message;
};

inline constexpr DWORD kSaveMessageControl = 1;

inline std::optional<std::wstring> ShowSaveFile(HWND owner, SaveRequest const &request) noexcept {
  ComApartment apartment;
  ModalOverWindow modal(owner, "save panel");
  winrt::com_ptr<IFileSaveDialog> dialog;
  if (FAILED(CoCreateInstance(CLSID_FileSaveDialog, nullptr, CLSCTX_INPROC_SERVER, __uuidof(IFileSaveDialog), dialog.put_void())) || !dialog) return std::nullopt;
  FILEOPENDIALOGOPTIONS options = 0;
  dialog->GetOptions(&options);
  dialog->SetOptions(options | FOS_FORCEFILESYSTEM | FOS_OVERWRITEPROMPT | FOS_PATHMUSTEXIST);
  if (!request.name.empty()) dialog->SetFileName(request.name.c_str());
  if (!request.extension.empty()) {
    std::wstring pattern = L"*." + request.extension;
    std::wstring kind = request.kind.empty() ? request.extension : request.kind;
    COMDLG_FILTERSPEC types[] = {{kind.c_str(), pattern.c_str()}, {L"All files", L"*.*"}};
    dialog->SetFileTypes(2, types);
    dialog->SetFileTypeIndex(1);
    dialog->SetDefaultExtension(request.extension.c_str());
  }
  if (!request.message.empty()) {
    winrt::com_ptr<IFileDialogCustomize> customize = dialog.try_as<IFileDialogCustomize>();
    if (customize) customize->AddText(kSaveMessageControl, request.message.c_str());
  }
  if (FAILED(dialog->Show(owner))) return std::nullopt;
  winrt::com_ptr<IShellItem> result;
  if (FAILED(dialog->GetResult(result.put())) || !result) return std::nullopt;
  std::wstring path = ItemPath(result.get());
  if (path.empty()) return std::nullopt;
  return path;
}

inline std::string DescribeSavePanel(SaveRequest const &request) noexcept {
  return "save panel (not shown): type=" + Paths::Utf8(request.extension) + (request.message.empty() ? std::string{} : " | with a warning");
}

}

}
