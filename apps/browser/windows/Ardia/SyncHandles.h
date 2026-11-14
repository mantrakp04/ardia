#pragma once

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include <winternl.h>

#include "Paths.h"
#include "SyncFiles.h"

#pragma comment(lib, "ntdll.lib")

namespace Ardia::SyncHandles {

constexpr ULONG OpenExisting = 0x1;
constexpr ULONG CreateNew = 0x2;
constexpr ULONG OpenOrCreate = 0x3;
constexpr ULONG DirectoryOnly = 0x1;
constexpr ULONG SequentialOnly = 0x4;
constexpr ULONG SynchronousIo = 0x20;
constexpr ULONG FileOnly = 0x40;
constexpr ULONG NoFollow = 0x00200000;
constexpr ULONG NoRecall = 0x00400000;
constexpr ULONG ShareAll = FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE;
constexpr ACCESS_MASK DirectoryAccess = FILE_LIST_DIRECTORY | FILE_TRAVERSE | FILE_READ_ATTRIBUTES;
constexpr size_t ListingBuffer = 64 * 1024;
constexpr int DeepestTree = 16;

using SyncFiles::Failure;

class Handle {
 public:
  Handle() = default;
  explicit Handle(HANDLE handle) noexcept : m_handle(handle) {}
  Handle(Handle const &) = delete;
  Handle &operator=(Handle const &) = delete;
  Handle(Handle &&other) noexcept : m_handle(std::exchange(other.m_handle, nullptr)) {}
  Handle &operator=(Handle &&other) noexcept {
    if (this != &other) {
      Close();
      m_handle = std::exchange(other.m_handle, nullptr);
    }
    return *this;
  }
  ~Handle() { Close(); }

  HANDLE get() const noexcept { return m_handle; }
  explicit operator bool() const noexcept { return m_handle && m_handle != INVALID_HANDLE_VALUE; }

 private:
  void Close() noexcept {
    if (m_handle && m_handle != INVALID_HANDLE_VALUE) CloseHandle(m_handle);
    m_handle = nullptr;
  }

  HANDLE m_handle = nullptr;
};

struct Opened {
  Handle handle;
  DWORD error = ERROR_SUCCESS;
};

inline bool IsPlainName(std::wstring const &name) noexcept {
  return !name.empty() && name.size() < 256 && name != L"." && name != L".." && name.find_first_of(std::wstring_view{L"\\/:\0", 4}) == std::wstring::npos;
}

inline Opened OpenAt(HANDLE parent, std::wstring const &name, ACCESS_MASK access, ULONG share, ULONG disposition, ULONG options, ULONG attributes = FILE_ATTRIBUTE_NORMAL) {
  if (!IsPlainName(name)) return Opened{Handle{}, ERROR_INVALID_NAME};
  UNICODE_STRING text{};
  text.Buffer = const_cast<PWSTR>(name.c_str());
  text.Length = static_cast<USHORT>(name.size() * sizeof(wchar_t));
  text.MaximumLength = text.Length;
  OBJECT_ATTRIBUTES object{};
  InitializeObjectAttributes(&object, &text, OBJ_CASE_INSENSITIVE, parent, nullptr);
  IO_STATUS_BLOCK io{};
  HANDLE opened = nullptr;
  NTSTATUS status = NtCreateFile(&opened, access | SYNCHRONIZE, &object, &io, nullptr, attributes, share, disposition, options | SynchronousIo, nullptr, 0);
  if (status < 0) return Opened{Handle{}, RtlNtStatusToDosError(status)};
  return Opened{Handle{opened}, ERROR_SUCCESS};
}

inline std::optional<FILE_ATTRIBUTE_TAG_INFO> TagOf(HANDLE handle) noexcept {
  FILE_ATTRIBUTE_TAG_INFO tag{};
  if (!GetFileInformationByHandleEx(handle, FileAttributeTagInfo, &tag, sizeof(tag))) return std::nullopt;
  return tag;
}

inline bool IsLinkTag(FILE_ATTRIBUTE_TAG_INFO const &tag) noexcept { return (tag.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) && IsReparseTagNameSurrogate(tag.ReparseTag); }

enum class Folder { Directory, Absent, Link, Unreachable };

struct OpenedFolder {
  Handle handle;
  Folder state = Folder::Unreachable;
};

inline OpenedFolder OpenRoot(std::wstring const &path) {
  Handle root{CreateFileW(path.c_str(), DirectoryAccess | SYNCHRONIZE, ShareAll, nullptr, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS, nullptr)};
  if (!root) return OpenedFolder{Handle{}, SyncFiles::IsMissing(GetLastError()) ? Folder::Absent : Folder::Unreachable};
  std::optional<FILE_ATTRIBUTE_TAG_INFO> tag = TagOf(root.get());
  if (!tag || !(tag->FileAttributes & FILE_ATTRIBUTE_DIRECTORY)) return OpenedFolder{Handle{}, Folder::Unreachable};
  return OpenedFolder{std::move(root), Folder::Directory};
}

inline OpenedFolder OpenFolderAt(HANDLE parent, std::wstring const &name, bool create, ACCESS_MASK extra = 0) {
  Opened opened = OpenAt(parent, name, DirectoryAccess | extra, ShareAll, create ? OpenOrCreate : OpenExisting, DirectoryOnly | NoFollow);
  if (!opened.handle) {
    if (SyncFiles::IsMissing(opened.error)) return OpenedFolder{Handle{}, Folder::Absent};
    Opened probe = OpenAt(parent, name, FILE_READ_ATTRIBUTES, ShareAll, OpenExisting, NoFollow);
    std::optional<FILE_ATTRIBUTE_TAG_INFO> tag = probe.handle ? TagOf(probe.handle.get()) : std::nullopt;
    return OpenedFolder{Handle{}, tag && IsLinkTag(*tag) ? Folder::Link : Folder::Unreachable};
  }
  std::optional<FILE_ATTRIBUTE_TAG_INFO> tag = TagOf(opened.handle.get());
  if (!tag) return OpenedFolder{Handle{}, Folder::Unreachable};
  if (IsLinkTag(*tag)) return OpenedFolder{Handle{}, Folder::Link};
  return OpenedFolder{std::move(opened.handle), Folder::Directory};
}

struct Entry {
  std::wstring name;
  DWORD attributes = 0;
  DWORD reparseTag = 0;
  int64_t modified = 0;
};

inline std::optional<std::vector<Entry>> Entries(HANDLE directory) {
  std::vector<uint8_t> buffer(ListingBuffer);
  std::vector<Entry> entries;
  FILE_INFO_BY_HANDLE_CLASS kind = FileFullDirectoryRestartInfo;
  while (true) {
    if (!GetFileInformationByHandleEx(directory, kind, buffer.data(), static_cast<DWORD>(buffer.size()))) {
      if (GetLastError() == ERROR_NO_MORE_FILES) return entries;
      return std::nullopt;
    }
    kind = FileFullDirectoryInfo;
    size_t offset = 0;
    while (true) {
      auto const *info = reinterpret_cast<FILE_FULL_DIR_INFO const *>(buffer.data() + offset);
      std::wstring name(info->FileName, info->FileNameLength / sizeof(wchar_t));
      if (name != L"." && name != L"..") {
        FILETIME written{info->LastWriteTime.LowPart, static_cast<DWORD>(info->LastWriteTime.HighPart)};
        entries.push_back(Entry{std::move(name), info->FileAttributes, (info->FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) ? info->EaSize : 0,
                                static_cast<int64_t>(SyncFiles::UnixMilliseconds(written))});
      }
      if (!info->NextEntryOffset) break;
      offset += info->NextEntryOffset;
    }
  }
}

inline std::string ListJson(HANDLE directory) {
  std::optional<std::vector<Entry>> entries = Entries(directory);
  if (!entries) throw Failure(SyncFiles::Problem("the folder couldn't be listed", GetLastError()));
  std::string out = "[";
  for (Entry const &entry : *entries) {
    if (out.size() > 1) out.push_back(',');
    bool folder = (entry.attributes & FILE_ATTRIBUTE_DIRECTORY) != 0;
    out += "{\"name\":" + SyncFiles::Quoted(Paths::Utf8(entry.name)) + ",\"dir\":" + (folder ? "true" : "false") + ",\"modified\":" + std::to_string(entry.modified) +
        ",\"placeholder\":" + (!folder && SyncFiles::IsPlaceholder(entry.attributes) ? "true" : "false") + "}";
  }
  out.push_back(']');
  return out;
}

inline SyncFiles::Read ReadAt(HANDLE directory, std::wstring const &name) {
  using State = SyncFiles::Read::State;
  Opened opened = OpenAt(directory, name, GENERIC_READ | FILE_READ_ATTRIBUTES, FILE_SHARE_READ | FILE_SHARE_DELETE, OpenExisting, FileOnly | NoFollow | NoRecall | SequentialOnly);
  if (!opened.handle) {
    if (SyncFiles::IsMissing(opened.error)) return SyncFiles::Read{};
    if (SyncFiles::IsBusy(opened.error) || opened.error == ERROR_DIRECTORY || opened.error == ERROR_INVALID_FUNCTION) return SyncFiles::Read{State::Busy, {}};
    throw Failure(SyncFiles::Problem("a sync file couldn't be opened", opened.error));
  }
  std::optional<FILE_ATTRIBUTE_TAG_INFO> tag = TagOf(opened.handle.get());
  if (!tag || IsLinkTag(*tag)) return SyncFiles::Read{State::Busy, {}};
  if (SyncFiles::IsPlaceholder(tag->FileAttributes)) return SyncFiles::Read{State::Placeholder, {}};
  return SyncFiles::ReadOpened(opened.handle.get());
}

using SetInformation = NTSTATUS(NTAPI *)(HANDLE, PIO_STATUS_BLOCK, PVOID, ULONG, ULONG);
constexpr ULONG FileRenameInformationClass = 10;

inline bool RenameWithin(HANDLE file, HANDLE directory, std::wstring const &name, DWORD &error) {
  static SetInformation const set = reinterpret_cast<SetInformation>(GetProcAddress(GetModuleHandleW(L"ntdll.dll"), "NtSetInformationFile"));
  if (!set) {
    error = ERROR_PROC_NOT_FOUND;
    return false;
  }
  std::vector<uint8_t> buffer(sizeof(FILE_RENAME_INFO) + name.size() * sizeof(wchar_t), 0);
  auto *info = reinterpret_cast<FILE_RENAME_INFO *>(buffer.data());
  info->ReplaceIfExists = FALSE;
  info->RootDirectory = directory;
  info->FileNameLength = static_cast<DWORD>(name.size() * sizeof(wchar_t));
  memcpy(info->FileName, name.c_str(), name.size() * sizeof(wchar_t));
  IO_STATUS_BLOCK io{};
  NTSTATUS status = set(file, &io, info, static_cast<ULONG>(buffer.size()), FileRenameInformationClass);
  if (status < 0) {
    error = RtlNtStatusToDosError(status);
    return false;
  }
  return true;
}

inline void Discard(HANDLE file) noexcept {
  FILE_DISPOSITION_INFO gone{TRUE};
  SetFileInformationByHandle(file, FileDispositionInfo, &gone, sizeof(gone));
}

inline void PublishAt(HANDLE directory, std::wstring const &name, std::string_view bytes) {
  if (!IsPlainName(name)) throw Failure("not a sync file name");
  Opened staged = OpenAt(directory, SyncFiles::StagingName(name), GENERIC_WRITE | DELETE | FILE_READ_ATTRIBUTES | FILE_WRITE_ATTRIBUTES, 0, CreateNew, FileOnly, FILE_ATTRIBUTE_HIDDEN);
  if (!staged.handle) throw Failure(SyncFiles::Problem("a sync file couldn't be written", staged.error));
  DWORD done = 0;
  bool ok = bytes.empty() || (WriteFile(staged.handle.get(), bytes.data(), static_cast<DWORD>(bytes.size()), &done, nullptr) && done == bytes.size());
  ok = ok && FlushFileBuffers(staged.handle.get());
  FILE_BASIC_INFO basic{};
  ok = ok && GetFileInformationByHandleEx(staged.handle.get(), FileBasicInfo, &basic, sizeof(basic));
  basic.FileAttributes = FILE_ATTRIBUTE_NORMAL;
  ok = ok && SetFileInformationByHandle(staged.handle.get(), FileBasicInfo, &basic, sizeof(basic));
  DWORD error = ok ? ERROR_SUCCESS : GetLastError();
  if (ok) ok = RenameWithin(staged.handle.get(), directory, name, error);
  if (!ok) {
    Discard(staged.handle.get());
    throw Failure(SyncFiles::Problem("a sync file couldn't be written", error));
  }
}

inline void Writable(HANDLE item) noexcept {
  FILE_BASIC_INFO basic{};
  if (!GetFileInformationByHandleEx(item, FileBasicInfo, &basic, sizeof(basic)) || !(basic.FileAttributes & FILE_ATTRIBUTE_READONLY)) return;
  basic.FileAttributes &= ~FILE_ATTRIBUTE_READONLY;
  if (!basic.FileAttributes) basic.FileAttributes = FILE_ATTRIBUTE_NORMAL;
  SetFileInformationByHandle(item, FileBasicInfo, &basic, sizeof(basic));
}

inline std::string RemoveAt(HANDLE directory, std::wstring const &name) {
  Opened opened = OpenAt(directory, name, DELETE | FILE_READ_ATTRIBUTES | FILE_WRITE_ATTRIBUTES, ShareAll, OpenExisting, FileOnly | NoFollow);
  if (!opened.handle) {
    if (SyncFiles::IsMissing(opened.error)) return "missing";
    throw Failure(SyncFiles::Problem("a sync file couldn't be removed", opened.error));
  }
  Writable(opened.handle.get());
  FILE_DISPOSITION_INFO gone{TRUE};
  if (!SetFileInformationByHandle(opened.handle.get(), FileDispositionInfo, &gone, sizeof(gone))) throw Failure(SyncFiles::Problem("a sync file couldn't be removed", GetLastError()));
  return "removed";
}

inline bool EmptyAt(HANDLE directory, int depth) {
  if (depth > DeepestTree) return false;
  std::optional<std::vector<Entry>> entries = Entries(directory);
  if (!entries) return false;
  bool ok = true;
  for (Entry const &entry : *entries) {
    bool link = (entry.attributes & FILE_ATTRIBUTE_REPARSE_POINT) && IsReparseTagNameSurrogate(entry.reparseTag);
    if ((entry.attributes & FILE_ATTRIBUTE_DIRECTORY) && !link) {
      OpenedFolder child = OpenFolderAt(directory, entry.name, false, DELETE | FILE_WRITE_ATTRIBUTES);
      if (child.state == Folder::Directory) {
        ok = EmptyAt(child.handle.get(), depth + 1) && ok;
        Writable(child.handle.get());
        FILE_DISPOSITION_INFO gone{TRUE};
        ok = SetFileInformationByHandle(child.handle.get(), FileDispositionInfo, &gone, sizeof(gone)) && ok;
        continue;
      }
      if (child.state != Folder::Link) {
        ok = false;
        continue;
      }
    }
    Opened item = OpenAt(directory, entry.name, DELETE | FILE_READ_ATTRIBUTES | FILE_WRITE_ATTRIBUTES, ShareAll, OpenExisting, NoFollow);
    if (!item.handle) {
      ok = SyncFiles::IsMissing(item.error) && ok;
      continue;
    }
    if (entry.attributes & FILE_ATTRIBUTE_READONLY) Writable(item.handle.get());
    FILE_DISPOSITION_INFO gone{TRUE};
    ok = SetFileInformationByHandle(item.handle.get(), FileDispositionInfo, &gone, sizeof(gone)) && ok;
  }
  return ok;
}

inline bool RemoveFolderAt(HANDLE parent, std::wstring const &name) {
  OpenedFolder folder = OpenFolderAt(parent, name, false, DELETE | FILE_WRITE_ATTRIBUTES);
  if (folder.state == Folder::Absent) return true;
  if (folder.state == Folder::Link) {
    Opened link = OpenAt(parent, name, DELETE | FILE_READ_ATTRIBUTES, ShareAll, OpenExisting, NoFollow);
    FILE_DISPOSITION_INFO gone{TRUE};
    return link.handle && SetFileInformationByHandle(link.handle.get(), FileDispositionInfo, &gone, sizeof(gone));
  }
  if (folder.state != Folder::Directory) return false;
  bool emptied = EmptyAt(folder.handle.get(), 0);
  Writable(folder.handle.get());
  FILE_DISPOSITION_INFO gone{TRUE};
  return SetFileInformationByHandle(folder.handle.get(), FileDispositionInfo, &gone, sizeof(gone)) && emptied;
}

}
