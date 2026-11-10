#pragma once

#include <filesystem>
#include <fstream>
#include <optional>
#include <string>
#include <string_view>
#include <system_error>
#include <vector>

#include "Events.h"
#include "FileDropItems.h"
#include "FileDropTarget.h"
#include "NativeModules.h"
#include "Paths.h"

namespace Ardia {

REACT_STRUCT(FileDropAreaFrame)
struct FileDropAreaFrame {
  REACT_FIELD(windowId)
  std::string windowId;
  REACT_FIELD(area)
  std::string area;
  REACT_FIELD(depth)
  double depth{0};
  REACT_FIELD(x)
  double x{0};
  REACT_FIELD(y)
  double y{0};
  REACT_FIELD(width)
  double width{0};
  REACT_FIELD(height)
  double height{0};
  REACT_FIELD(accepts)
  std::string accepts;
  REACT_FIELD(enabled)
  bool enabled{true};
};

namespace FileDropParts {

inline std::vector<std::wstring> WideStrings(winrt::Microsoft::ReactNative::JSValue const &value) noexcept {
  std::vector<std::wstring> strings;
  if (auto array = value.TryGetArray()) {
    for (auto const &item : *array) {
      if (auto text = item.TryGetString()) strings.push_back(Paths::Wide(*text));
    }
  }
  return strings;
}

inline std::vector<std::wstring> &LastFileDrag() noexcept {
  static std::vector<std::wstring> paths;
  return paths;
}

inline std::optional<DropPayload> DevPayload(winrt::Microsoft::ReactNative::JSValue const &value) noexcept {
  auto object = value.TryGetObject();
  if (!object) return std::nullopt;
  DropPayload payload;
  if (auto fileDrag = value.TryGetObjectProperty("fileDrag"); fileDrag && fileDrag->TryGetBoolean() && *fileDrag->TryGetBoolean()) {
    payload.files = LastFileDrag();
  }
  if (auto files = value.TryGetObjectProperty("files")) {
    for (std::wstring &file : WideStrings(*files)) payload.files.push_back(std::move(file));
  }
  for (const char *name : {"urls", "publicURLs"}) {
    if (auto urls = value.TryGetObjectProperty(name)) {
      for (std::wstring &url : WideStrings(*urls)) payload.urls.push_back(std::move(url));
    }
  }
  if (auto text = value.TryGetObjectProperty("text")) {
    if (auto string = text->TryGetString()) payload.text = Paths::Wide(*string);
  }
  return payload;
}

inline bool IsPlainFileName(std::string_view name) noexcept {
  if (name.empty() || name.size() > 128 || name == "." || name == "..") return false;
  return name.find_first_of("/\\:*?\"<>|") == std::string_view::npos;
}

}

REACT_MODULE(FileDropModule, L"ArdiaFileDrop")
struct FileDropModule {
  using JSValue = winrt::Microsoft::ReactNative::JSValue;

  REACT_INIT(Initialize)
  void Initialize(winrt::Microsoft::ReactNative::ReactContext const &context) noexcept {
    m_context = context;
    RunOnUI(context, [context]() noexcept { FileDropParts::DropHub::Shared().Attach(context); });
  }

  REACT_METHOD(setDropArea)
  void setDropArea(FileDropAreaFrame frame) noexcept {
    FileDropParts::DropArea area;
    area.key = frame.area;
    area.depth = frame.depth;
    area.x = frame.x;
    area.y = frame.y;
    area.width = frame.width;
    area.height = frame.height;
    area.mode = FileDropParts::AcceptModeNamed(frame.accepts);
    area.enabled = frame.enabled;
    if (area.key.empty() || !(area.width > 0) || !(area.height > 0)) area.enabled = false;
    std::string windowId = frame.windowId;
    RunOnUI(m_context, [windowId, area]() noexcept { FileDropParts::DropHub::Shared().SetArea(windowId, area); });
  }

  REACT_METHOD(removeDropArea)
  void removeDropArea(std::string windowId, std::string area) noexcept {
    RunOnUI(m_context, [windowId, area]() noexcept { FileDropParts::DropHub::Shared().RemoveArea(windowId, area); });
  }

  REACT_METHOD(devDrag)
  void devDrag(std::string windowId, std::string action, double x, double y, JSValue payload, winrt::Microsoft::ReactNative::ReactPromise<std::string> promise) noexcept {
    std::optional<FileDropParts::DropPayload> parsed = FileDropParts::DevPayload(payload);
    RunOnUI(m_context, [windowId, action, x, y, parsed, promise]() noexcept {
      promise.Resolve(FileDropParts::DropHub::Shared().DevDrag(windowId, action, x, y, parsed));
    });
  }

  REACT_METHOD(devLastFileDrag)
  void devLastFileDrag(winrt::Microsoft::ReactNative::ReactPromise<std::vector<std::string>> promise) noexcept {
    std::vector<std::string> paths;
    if (FileDropParts::DropHub::DevAvailable()) {
      for (std::wstring const &path : FileDropParts::LastFileDrag()) paths.push_back(Paths::Utf8(path));
    }
    promise.Resolve(paths);
  }

  REACT_METHOD(devDropTarget)
  void devDropTarget(std::string windowId, winrt::Microsoft::ReactNative::ReactPromise<JSValue> promise) noexcept {
    if (!FileDropParts::DropHub::DevAvailable()) return promise.Resolve(JSValue{nullptr});
    RunOnUI(m_context, [windowId, promise]() noexcept {
      auto report = FileDropParts::DropHub::Shared().DevTarget(windowId);
      if (!report) return promise.Resolve(JSValue{nullptr});
      promise.Resolve(JSValue{std::move(*report)});
    });
  }

  REACT_METHOD(devWriteDropFixture)
  void devWriteDropFixture(std::string name, std::string contents, winrt::Microsoft::ReactNative::ReactPromise<std::string> promise) noexcept {
    if (!FileDropParts::DropHub::DevAvailable() || !Paths::HasCustomDataDirectory()) return promise.Reject("fixtures are for self-check instances only");
    if (!FileDropParts::IsPlainFileName(name)) return promise.Reject("a fixture name is a plain file name");
    try {
      std::filesystem::path folder = Paths::DataDirectory() / L"drop-fixtures";
      std::error_code error;
      std::filesystem::create_directories(folder, error);
      std::filesystem::path file = folder / Paths::Wide(name);
      std::ofstream stream(file, std::ios::binary | std::ios::trunc);
      stream.write(contents.data(), static_cast<std::streamsize>(contents.size()));
      stream.close();
      if (!stream) return promise.Reject("the fixture could not be written");
      promise.Resolve(Paths::Utf8(file.wstring()));
    } catch (...) {
      promise.Reject("the fixture could not be written");
    }
  }

 private:
  winrt::Microsoft::ReactNative::ReactContext m_context{nullptr};
};

}
