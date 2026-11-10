#pragma once

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <functional>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "DocumentsModule.h"
#include "NativeModules.h"
#include "Paths.h"

namespace Ardia {

REACT_STRUCT(TelemetryLocalStats)
struct TelemetryLocalStats {
  REACT_FIELD(bytes)
  int64_t bytes = 0;
  REACT_FIELD(lines)
  int64_t lines = 0;
  REACT_FIELD(files)
  int64_t files = 0;
  REACT_FIELD(droppedLines)
  int64_t droppedLines = 0;
  REACT_FIELD(pruneMs)
  double pruneMs = 0;
  REACT_FIELD(writeMs)
  std::vector<double> writeMs;
};

REACT_STRUCT(TelemetryLocalExport)
struct TelemetryLocalExport {
  REACT_FIELD(path)
  std::string path;
  REACT_FIELD(bytes)
  int64_t bytes = 0;
  REACT_FIELD(lines)
  int64_t lines = 0;
};

namespace Gzip {

inline uint32_t Crc32(std::string_view data) noexcept {
  static const std::array<uint32_t, 256> table = [] {
    std::array<uint32_t, 256> built{};
    for (uint32_t n = 0; n < 256; n++) {
      uint32_t c = n;
      for (int k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320u ^ (c >> 1) : c >> 1;
      built[n] = c;
    }
    return built;
  }();
  uint32_t crc = 0xFFFFFFFFu;
  for (unsigned char byte : data) crc = table[(crc ^ byte) & 0xFF] ^ (crc >> 8);
  return crc ^ 0xFFFFFFFFu;
}

inline void PutLittle32(std::string &out, uint32_t value) {
  for (int shift = 0; shift < 32; shift += 8) out.push_back(static_cast<char>((value >> shift) & 0xFF));
}

inline std::optional<std::string> Stored(std::string_view data) noexcept {
  try {
    std::string out;
    size_t blocks = data.size() / 65535 + 1;
    out.reserve(data.size() + blocks * 5 + 18);
    const char header[10] = {'\x1f', '\x8b', '\x08', 0, 0, 0, 0, 0, 0, '\xff'};
    out.append(header, sizeof(header));
    size_t offset = 0;
    do {
      size_t length = std::min<size_t>(data.size() - offset, 65535);
      bool last = offset + length >= data.size();
      out.push_back(last ? '\x01' : '\x00');
      uint16_t len = static_cast<uint16_t>(length);
      uint16_t nlen = static_cast<uint16_t>(~len);
      out.push_back(static_cast<char>(len & 0xFF));
      out.push_back(static_cast<char>(len >> 8));
      out.push_back(static_cast<char>(nlen & 0xFF));
      out.push_back(static_cast<char>(nlen >> 8));
      out.append(data.data() + offset, length);
      offset += length;
    } while (offset < data.size());
    PutLittle32(out, Crc32(data));
    PutLittle32(out, static_cast<uint32_t>(data.size() & 0xFFFFFFFFu));
    return out;
  } catch (...) {
    return std::nullopt;
  }
}

}

class TelemetryLocalStore {
 public:
  using StatsDone = std::function<void(TelemetryLocalStats const &)>;
  using ExportDone = std::function<void(std::optional<TelemetryLocalExport> const &)>;

  static bool ValidDay(std::string_view day) noexcept {
    if (day.size() != 10) return false;
    for (size_t i = 0; i < day.size(); i++) {
      bool dash = i == 4 || i == 7;
      if (dash ? day[i] != '-' : (day[i] < '0' || day[i] > '9')) return false;
    }
    return true;
  }

  static void Append(std::string day, std::string text) noexcept {
    if (!ValidDay(day) || text.empty()) return;
    RegisterDrainOnExit();
    Queue().Async([day = std::move(day), text = std::move(text)]() { Write(day, text); });
  }

  static void AppendNow(std::string day, std::string text) noexcept {
    if (!ValidDay(day) || text.empty()) return;
    Queue().Sync([day = std::move(day), text = std::move(text)]() { Write(day, text); });
  }

  static void Configure(double maxBytes, double keepDays) noexcept {
    int64_t bytes = std::isfinite(maxBytes) ? static_cast<int64_t>(std::max(1.0, std::min(maxBytes, 9.0e15))) : 1;
    double days = std::isfinite(keepDays) ? std::max(1.0, std::floor(keepDays)) : 1.0;
    Queue().Async([bytes, days]() {
      State().maxBytes = bytes;
      State().keepMs = days * DayMs;
    });
  }

  static void PruneAndMeasure(double now, StatsDone done) noexcept {
    Queue().Async([now, done = std::move(done)]() {
      TelemetryLocalStats stats = Prune(now);
      stats.droppedLines = State().droppedSincePrune;
      State().droppedSincePrune = 0;
      stats.writeMs = std::move(State().writeMs);
      State().writeMs.clear();
      done(stats);
    });
  }

  static void Clear(std::function<void()> done) noexcept {
    Queue().Async([done = std::move(done)]() {
      if (auto dir = Directory()) {
        for (auto const &file : AppFiles(*dir)) Files::RemoveFile(file.path);
      }
      State().totalBytes = 0;
      done();
    });
  }

  static void ExportForReport(double since, ExportDone done) noexcept {
    Queue().Async([since, done = std::move(done)]() {
      auto dir = Directory();
      if (!dir) return done(std::nullopt);
      auto [data, lines] = Collect(*dir, since, false);
      std::filesystem::path exportDir = dir->parent_path() / L"export";
      std::error_code ignored;
      std::filesystem::create_directories(exportDir, ignored);
      auto gz = Gzip::Stored(data);
      if (!gz) return done(std::nullopt);
      std::filesystem::path target = exportDir / L"local-events.jsonl.gz";
      if (Files::ReplaceAtomically(target, *gz) != ERROR_SUCCESS) return done(std::nullopt);
      done(TelemetryLocalExport{Paths::Utf8(target.wstring()), static_cast<int64_t>(gz->size()), lines});
    });
  }

  static void ExportToDownloads(double now, ExportDone done) noexcept {
    Queue().Async([now, done = std::move(done)]() {
      auto dir = Directory();
      if (!dir) return done(std::nullopt);
      auto [data, lines] = Collect(*dir, now - State().keepMs, true);
      std::filesystem::path downloads =
          Paths::HasCustomDataDirectory() ? Paths::DataDirectory() / L"Downloads" : Paths::KnownFolder(FOLDERID_Downloads);
      if (downloads.empty()) return done(std::nullopt);
      std::error_code ignored;
      std::filesystem::create_directories(downloads, ignored);
      std::wstring base = L"Ardia data " + Paths::Wide(UtcDay(now));
      std::filesystem::path target = downloads / (base + L".jsonl");
      for (int n = 2; GetFileAttributesW(target.c_str()) != INVALID_FILE_ATTRIBUTES && n < 10000; n++) {
        target = downloads / (base + L" " + std::to_wstring(n) + L".jsonl");
      }
      if (Files::ReplaceAtomically(target, data) != ERROR_SUCCESS) return done(std::nullopt);
      done(TelemetryLocalExport{Paths::Utf8(target.wstring()), static_cast<int64_t>(data.size()), lines});
    });
  }

  static std::string UtcDay(double ms) noexcept {
    double safe = std::isfinite(ms) ? ms : 0.0;
    int64_t days = static_cast<int64_t>(std::floor(safe / DayMs));
    int64_t z = days + 719468;
    int64_t era = (z >= 0 ? z : z - 146096) / 146097;
    int64_t doe = z - era * 146097;
    int64_t yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    int64_t year = yoe + era * 400;
    int64_t doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    int64_t mp = (5 * doy + 2) / 153;
    int64_t day = doy - (153 * mp + 2) / 5 + 1;
    int64_t month = mp < 10 ? mp + 3 : mp - 9;
    if (month <= 2) year += 1;
    char text[32]{};
    snprintf(text, sizeof(text), "%04lld-%02lld-%02lld", static_cast<long long>(year), static_cast<long long>(month), static_cast<long long>(day));
    return text;
  }

 private:
  static constexpr double DayMs = 86400000.0;
  static constexpr size_t MaxWriteSamples = 4096;

  struct AppFile {
    std::string day;
    std::filesystem::path path;
    int64_t size = 0;
  };

  struct Shared {
    int64_t maxBytes = 8 * 1048576;
    double keepMs = 7.0 * DayMs;
    std::optional<int64_t> totalBytes;
    std::vector<double> writeMs;
    int64_t droppedSincePrune = 0;
  };

  static Shared &State() noexcept {
    static Shared *shared = new Shared();
    return *shared;
  }

  static SerialQueue &Queue() noexcept {
    static SerialQueue *queue = new SerialQueue();
    return *queue;
  }

  static void RegisterDrainOnExit() noexcept {
    static const bool registered = [] {
      std::atexit([] { Queue().Sync([] {}); });
      return true;
    }();
    (void)registered;
  }

  static std::optional<std::filesystem::path> Directory() noexcept {
    try {
      std::filesystem::path dir = Paths::DataDirectory() / L"Telemetry" / L"local";
      std::error_code failed;
      std::filesystem::create_directories(dir, failed);
      if (failed) return std::nullopt;
      return dir;
    } catch (...) {
      return std::nullopt;
    }
  }

  static double NowMs() noexcept {
    FILETIME now{};
    GetSystemTimeAsFileTime(&now);
    uint64_t ticks = (static_cast<uint64_t>(now.dwHighDateTime) << 32) | now.dwLowDateTime;
    return static_cast<double>(ticks - 116444736000000000ull) / 10000.0;
  }

  static double ElapsedMs(LARGE_INTEGER const &start) noexcept {
    LARGE_INTEGER end{};
    LARGE_INTEGER frequency{};
    QueryPerformanceCounter(&end);
    QueryPerformanceFrequency(&frequency);
    if (frequency.QuadPart == 0) return 0;
    return static_cast<double>(end.QuadPart - start.QuadPart) * 1000.0 / static_cast<double>(frequency.QuadPart);
  }

  static void Write(std::string const &day, std::string const &text) noexcept {
    auto dir = Directory();
    if (!dir) return;
    LARGE_INTEGER start{};
    QueryPerformanceCounter(&start);
    std::filesystem::path path = *dir / Paths::Wide(day + ".jsonl");
    HANDLE file = CreateFileW(
        path.c_str(), FILE_APPEND_DATA, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL,
        nullptr);
    if (file == INVALID_HANDLE_VALUE) return;
    size_t offset = 0;
    while (offset < text.size()) {
      DWORD chunk = static_cast<DWORD>(std::min<size_t>(text.size() - offset, 1u << 20));
      DWORD wrote = 0;
      if (!WriteFile(file, text.data() + offset, chunk, &wrote, nullptr) || wrote == 0) break;
      offset += wrote;
    }
    CloseHandle(file);
    try {
      auto &samples = State().writeMs;
      if (samples.size() >= MaxWriteSamples) samples.erase(samples.begin(), samples.begin() + static_cast<ptrdiff_t>(samples.size() - MaxWriteSamples + 1));
      samples.push_back(ElapsedMs(start));
    } catch (...) {
    }
    if (State().totalBytes) {
      int64_t total = *State().totalBytes + static_cast<int64_t>(offset);
      State().totalBytes = total;
      if (total > State().maxBytes) Prune(NowMs());
    }
  }

  static bool MatchesDayAt(std::wstring_view name, size_t at) noexcept {
    if (name.size() < at + 10) return false;
    for (size_t i = 0; i < 10; i++) {
      wchar_t c = name[at + i];
      bool dash = i == 4 || i == 7;
      if (dash ? c != L'-' : (c < L'0' || c > L'9')) return false;
    }
    return true;
  }

  static bool IsAppFileName(std::wstring_view name) noexcept {
    return name.size() == 16 && MatchesDayAt(name, 0) && name.substr(10) == L".jsonl";
  }

  static bool IsCliFileName(std::wstring_view name) noexcept {
    return name.size() == 20 && name.substr(0, 4) == L"cli-" && MatchesDayAt(name, 4) && name.substr(14) == L".jsonl";
  }

  static std::vector<std::wstring> Names(std::filesystem::path const &dir) noexcept {
    std::vector<std::wstring> names;
    try {
      std::error_code failed;
      for (std::filesystem::directory_iterator it(dir, failed), end; !failed && it != end; it.increment(failed)) {
        names.push_back(it->path().filename().wstring());
      }
    } catch (...) {
    }
    std::sort(names.begin(), names.end());
    return names;
  }

  static std::vector<AppFile> AppFiles(std::filesystem::path const &dir) noexcept {
    std::vector<AppFile> files;
    try {
      for (auto const &name : Names(dir)) {
        if (!IsAppFileName(name)) continue;
        AppFile file;
        file.day = Paths::Utf8(std::wstring_view(name).substr(0, 10));
        file.path = dir / name;
        std::error_code failed;
        auto size = std::filesystem::file_size(file.path, failed);
        file.size = failed ? 0 : static_cast<int64_t>(size);
        files.push_back(std::move(file));
      }
    } catch (...) {
    }
    std::sort(files.begin(), files.end(), [](AppFile const &a, AppFile const &b) { return a.day < b.day; });
    return files;
  }

  static int64_t Newlines(std::string_view data) noexcept { return static_cast<int64_t>(std::count(data.begin(), data.end(), '\n')); }

  static std::optional<double> LineTime(std::string_view line) noexcept {
    constexpr std::string_view prefix = "{\"at\":";
    if (line.size() <= prefix.size() || line.substr(0, prefix.size()) != prefix) return std::nullopt;
    double value = 0;
    int digits = 0;
    for (char c : line.substr(prefix.size())) {
      if (c < '0' || c > '9') break;
      value = value * 10 + (c - '0');
      digits++;
    }
    if (digits == 0) return std::nullopt;
    return value;
  }

  template <class TKeep>
  static size_t OffsetOfFirstLine(std::string_view data, TKeep &&keep) noexcept {
    size_t start = 0;
    while (start < data.size()) {
      size_t newline = data.find('\n', start);
      size_t end = newline == std::string_view::npos ? data.size() : newline + 1;
      if (keep(data.substr(start, end - start))) return start;
      start = end;
    }
    return data.size();
  }

  static int64_t KeepTail(std::filesystem::path const &path, size_t offset, std::string_view data) noexcept {
    int64_t dropped = Newlines(data.substr(0, std::min(offset, data.size())));
    if (offset >= data.size()) Files::RemoveFile(path);
    else Files::ReplaceAtomically(path, data.substr(offset));
    return dropped;
  }

  static int64_t FileNewlines(std::filesystem::path const &path) noexcept {
    auto data = Files::ReadAll(path);
    return data ? Newlines(*data) : 0;
  }

  static TelemetryLocalStats Prune(double now) noexcept {
    LARGE_INTEGER started{};
    QueryPerformanceCounter(&started);
    TelemetryLocalStats stats;
    auto dir = Directory();
    if (!dir) return stats;
    try {
      double cutoff = now - State().keepMs;
      std::string oldestDay = UtcDay(cutoff);
      std::string newestDay = UtcDay(now + DayMs);
      std::vector<AppFile> files;
      for (auto &file : AppFiles(*dir)) {
        if (file.day < oldestDay || file.day > newestDay) {
          State().droppedSincePrune += FileNewlines(file.path);
          Files::RemoveFile(file.path);
          continue;
        }
        files.push_back(std::move(file));
      }
      if (!files.empty() && files.front().day == oldestDay) {
        if (auto data = Files::ReadAll(files.front().path)) {
          size_t offset = OffsetOfFirstLine(*data, [&](std::string_view line) { return LineTime(line).value_or(now) >= cutoff; });
          if (offset > 0) {
            State().droppedSincePrune += KeepTail(files.front().path, offset, *data);
            files.front().size = static_cast<int64_t>(data->size() - offset);
            if (offset >= data->size()) files.erase(files.begin());
          }
        }
      }
      int64_t total = 0;
      for (auto const &file : files) total += file.size;
      int64_t maxBytes = State().maxBytes;
      int64_t target = maxBytes - maxBytes / 10;
      while (total > maxBytes && !files.empty()) {
        AppFile &oldest = files.front();
        int64_t excess = total - target;
        if (oldest.size <= excess) {
          State().droppedSincePrune += FileNewlines(oldest.path);
          Files::RemoveFile(oldest.path);
          total -= oldest.size;
          files.erase(files.begin());
          continue;
        }
        auto data = Files::ReadAll(oldest.path);
        if (!data) break;
        size_t offset = static_cast<size_t>(std::min<int64_t>(excess, static_cast<int64_t>(data->size())));
        if (offset > 0 && (*data)[offset - 1] != '\n') {
          size_t newline = data->find('\n', offset);
          offset = newline == std::string::npos ? data->size() : newline + 1;
        }
        State().droppedSincePrune += KeepTail(oldest.path, offset, *data);
        total -= static_cast<int64_t>(offset);
        oldest.size = static_cast<int64_t>(data->size() - offset);
        if (offset >= data->size()) files.erase(files.begin());
        break;
      }
      for (auto const &file : files) {
        auto data = Files::ReadAll(file.path);
        if (!data) continue;
        stats.bytes += static_cast<int64_t>(data->size());
        stats.lines += Newlines(*data);
        stats.files += 1;
      }
    } catch (...) {
    }
    State().totalBytes = stats.bytes;
    stats.pruneMs = ElapsedMs(started);
    return stats;
  }

  struct Collected {
    std::string data;
    int64_t lines = 0;
  };

  static Collected Collect(std::filesystem::path const &dir, double since, bool includeCli) noexcept {
    Collected out;
    try {
      std::string fromDay = UtcDay(since);
      for (auto const &file : AppFiles(dir)) {
        if (file.day < fromDay) continue;
        auto data = Files::ReadAll(file.path);
        if (!data) continue;
        size_t offset =
            file.day == fromDay ? OffsetOfFirstLine(*data, [&](std::string_view line) { return LineTime(line).value_or(since) >= since; }) : 0;
        std::string_view kept = std::string_view(*data).substr(offset);
        out.data.append(kept);
        if (!kept.empty() && kept.back() != '\n') out.data.push_back('\n');
        out.lines += Newlines(kept) + (!kept.empty() && kept.back() != '\n' ? 1 : 0);
      }
      if (includeCli) {
        for (auto const &name : Names(dir)) {
          if (!IsCliFileName(name)) continue;
          auto data = Files::ReadAll(dir / name);
          if (!data || data->empty()) continue;
          out.data.append(*data);
          if (data->back() != '\n') out.data.push_back('\n');
          out.lines += Newlines(*data) + (data->back() == '\n' ? 0 : 1);
        }
      }
    } catch (...) {
    }
    return out;
  }
};

REACT_MODULE(TelemetryLocalModule, L"ArdiaTelemetryLocal")
struct TelemetryLocalModule {
  REACT_SYNC_METHOD(append)
  bool append(std::string day, std::string text) noexcept {
    TelemetryLocalStore::Append(std::move(day), std::move(text));
    return true;
  }

  REACT_SYNC_METHOD(appendNow)
  bool appendNow(std::string day, std::string text) noexcept {
    TelemetryLocalStore::AppendNow(std::move(day), std::move(text));
    return true;
  }

  REACT_SYNC_METHOD(configure)
  bool configure(double maxBytes, double keepDays) noexcept {
    TelemetryLocalStore::Configure(maxBytes, keepDays);
    return true;
  }

  REACT_METHOD(prune)
  void prune(double now, winrt::Microsoft::ReactNative::ReactPromise<TelemetryLocalStats> promise) noexcept {
    TelemetryLocalStore::PruneAndMeasure(now, [promise](TelemetryLocalStats const &stats) { promise.Resolve(stats); });
  }

  REACT_METHOD(clear)
  void clear(winrt::Microsoft::ReactNative::ReactPromise<void> promise) noexcept {
    TelemetryLocalStore::Clear([promise]() { promise.Resolve(); });
  }

  REACT_METHOD(exportForReport)
  void exportForReport(double since, winrt::Microsoft::ReactNative::ReactPromise<std::optional<TelemetryLocalExport>> promise) noexcept {
    TelemetryLocalStore::ExportForReport(since, [promise](std::optional<TelemetryLocalExport> const &exported) { promise.Resolve(exported); });
  }

  REACT_METHOD(exportToDownloads)
  void exportToDownloads(double now, winrt::Microsoft::ReactNative::ReactPromise<std::optional<TelemetryLocalExport>> promise) noexcept {
    TelemetryLocalStore::ExportToDownloads(now, [promise](std::optional<TelemetryLocalExport> const &exported) { promise.Resolve(exported); });
  }
};

}
