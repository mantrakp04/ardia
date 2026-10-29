from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from document_host_fixture import ROOT, SOURCES, WRITER, values
from test_renderer_contract import method


PRELUDE = r'''
#include <cassert>
#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <tuple>
#include <utility>
#include <vector>
#include "ardia/linux/ac_linux_document_service.h"
#include "ardia/linux/ac_linux_policy.h"
using namespace ardia;
namespace base {
struct FilePath {
  std::string path;
  FilePath AppendASCII(std::string_view name) const { return {path + "/" + std::string(name)}; }
  FilePath BaseName() const { return {path.substr(path.rfind('/') + 1)}; }
  const std::string& value() const { return path; }
  bool empty() const { return path.empty(); }
  auto operator<=>(const FilePath&) const = default;
};
struct File {
  enum { FLAG_OPEN = 1, FLAG_READ = 2, FILE_ERROR_NOT_FOUND = -1, FILE_ERROR_ACCESS_DENIED = -2 };
  static inline int error = 0;
  File(const FilePath&, int) {}
  bool IsValid() const { return !error; }
  int error_details() const { return error; }
};
struct Uuid {
  static inline int ids = 0;
  int id;
  static Uuid GenerateRandomV4() { return {++ids}; }
  std::string AsLowercaseString() const { return "native-" + std::to_string(id); }
};
static bool link = false;
bool IsLink(const FilePath&) { return link; }
static bool ui = true;
constexpr int JSON_PARSE_RFC = 0;
struct JSONReader {
  static inline bool corrupt = false;
  static std::optional<Value> Read(std::string_view, int, int) {
    if (corrupt) return std::nullopt;
    DictValue value; value.Set("format", Value(1));
    return Value(std::move(value));
  }
};
std::optional<std::string> WriteJsonWithOptions(ValueView, int, int) { return "encoded"; }
constexpr int OPTIONS_OMIT_DOUBLE_TYPE_PRESERVATION = 0;
template<class T> struct NoDestructor {
  T value;
  T* operator->() { return &value; }
  T& operator*() { return value; }
};
static int constructions = 0;
static int destructions = 0;
std::vector<std::move_only_function<void()>> tasks;
template<class T> class SequenceBound {
  std::shared_ptr<std::unique_ptr<T>> value = std::make_shared<std::unique_ptr<T>>();
 public:
  template<class... Args> SequenceBound(int, Args... args) {
    tasks.emplace_back([value = value, args = std::tuple(std::move(args)...)]() mutable {
      assert(!ui); ++constructions;
      std::apply([&](auto&&... args) { *value = std::make_unique<T>(std::move(args)...); }, args);
    });
  }
  ~SequenceBound() {
    tasks.emplace_back([value = value] { assert(!ui); value->reset(); ++destructions; });
  }
};
struct FileEnumerator {
  enum { FILES = 1 };
  static inline std::vector<std::string> entries;
  size_t index = 0;
  FileEnumerator(const FilePath&, bool, int) {}
  FilePath Next() { return {index < entries.size() ? entries[index++] : ""}; }
};
}
namespace content { struct BrowserThread { enum { UI }; static bool CurrentlyOn(int) { return base::ui; } }; }
#define CHECK(value) assert(value)
struct Profile {
  base::FilePath path;
  bool regular = true;
  bool IsRegularProfile() { assert(base::ui); return regular; }
  base::FilePath GetPath() { assert(base::ui); return path; }
};
base::FilePath DocumentDirectory(Profile* profile) { return profile->GetPath().AppendASCII("Ardia"); }
int FileRunner() { return 1; }
static bool prepare = true;
static std::optional<std::string> text = "json";
static std::vector<std::string> reads;
bool PrepareDocuments(const base::FilePath&) { return prepare; }
std::optional<std::string> ReadDocument(const base::FilePath&, const std::string& name) { reads.push_back(name); return text; }
bool WriteDocument(const base::FilePath&, const std::string& name, const std::optional<std::string>& contents) {
  assert(name == "live.canonical.json" && contents); return true;
}
constexpr char kSessionName[] = "linux-session.json";
constexpr size_t kDocumentLimit = 8 * 1024 * 1024;
void Drain() {
  base::ui = false;
  auto tasks = std::move(base::tasks); base::tasks.clear();
  for (auto& task : tasks) task();
  base::ui = true;
}
'''


MAIN = r'''
int main() {
  Profile regular{{"/native/Profile1"}};
  Profile same{{"/native/Profile1"}};
  Profile other{{"/native/Profile2"}};
  Profile private_profile{{"/native/Private"}, false};
  Profile unknown{{""}};
  assert(!DocumentsFor(nullptr) && !DocumentsFor(&private_profile) && !DocumentsFor(&unknown));
  auto first = DocumentsFor(&regular);
  auto peer = DocumentsFor(&same);
  auto second = DocumentsFor(&other);
  assert(first == peer && first != second && first->scope != second->scope);
  assert(base::constructions == 0);
  Drain(); assert(base::constructions == 2);
  first.reset(); Drain(); assert(base::destructions == 0);
  peer.reset(); Drain(); assert(base::destructions == 1);
  second.reset(); Drain(); assert(base::destructions == 2);
  auto renewed = DocumentsFor(&regular);
  Drain(); assert(base::constructions == 3);
  renewed.reset(); Drain(); assert(base::destructions == 3);
  const base::FilePath root{"/native/Profile1/Ardia"};
  base::File::error = base::File::FILE_ERROR_NOT_FOUND;
  assert(ReadCanonicalDocument(root, "live.canonical.json").state == LinuxDocumentRead::State::kMissing);
  base::File::error = base::File::FILE_ERROR_ACCESS_DENIED;
  assert(ReadCanonicalDocument(root, "live.canonical.json").state == LinuxDocumentRead::State::kError);
  base::File::error = 0;
  base::JSONReader::corrupt = true;
  const auto corrupt = ReadCanonicalDocument(root, "live.canonical.json");
  assert(corrupt.state == LinuxDocumentRead::State::kFound);
  assert(*corrupt.value.FindString("format") == "invalid");
  base::JSONReader::corrupt = false;
  assert(ReadCanonicalDocument(root, "live.canonical.json").state == LinuxDocumentRead::State::kFound);
  text.reset();
  assert(ReadCanonicalDocument(root, "live.canonical.json").state == LinuxDocumentRead::State::kError);
  text = "ok"; base::link = true;
  assert(ReadCanonicalDocument(root, "live.canonical.json").state == LinuxDocumentRead::State::kError);
  base::link = false;
  assert(ReadCanonicalDocument(root, "secrets.json").state == LinuxDocumentRead::State::kError);
  reads.clear();
  base::FileEnumerator::entries = {"live.json", "live.canonical.json", "settings.json", "linux-session.json", "sync-state.nns"};
  const auto bootstrap = ReadDocuments(root);
  assert(bootstrap.size() == 1 && bootstrap.FindString("settings.json"));
  assert(reads == std::vector<std::string>{"settings.json"});
  assert(ReadCanonicalDocument(root, "live.json").state == LinuxDocumentRead::State::kFound);
  assert(reads.back() == "live.json");
}
'''


class DocumentAuthorityTests(unittest.TestCase):
    def test_registry_sequence_lifetime_storage_errors_and_bootstrap_reservations(self):
        compiler = shutil.which('clang++') or shutil.which('c++')
        self.assertIsNotNone(compiler)
        source = (ROOT / 'src/ardia/linux/ac_linux_host.cc').read_text()
        reserved = method((ROOT / 'src/ardia/linux/ac_linux_documents.cc').read_text(), 'bool LinuxDocuments::Reserved(')
        authority = source[source.index('struct DocumentAuthority {'):source.index('\nstd::shared_ptr<DocumentAuthority> DocumentsFor')]
        production = '\n'.join([reserved, method(source, 'LinuxDocumentRead ReadCanonicalDocument('), authority, method(source, 'std::shared_ptr<DocumentAuthority> DocumentsFor('), method(source, 'base::DictValue ReadDocuments(')])
        with tempfile.TemporaryDirectory(prefix='ardia-document-authority-') as scratch:
            root = Path(scratch)
            (root / 'base/json').mkdir(parents=True)
            (root / 'base/values.h').write_text(values())
            (root / 'base/json/json_writer.h').write_text(WRITER)
            (root / 'main.cc').write_text(PRELUDE + production + MAIN)
            binary = root / 'authority'
            helper_sources = [name for name in SOURCES if name != 'ac_linux_documents.cc']
            documents = (ROOT / 'src/ardia/linux/ac_linux_documents.cc').read_text().replace(reserved, '')
            (root / 'documents.cc').write_text(documents)
            result = subprocess.run([compiler, '-std=c++23', '-Wall', '-Wextra', '-Werror', '-I', str(root), '-I', str(ROOT / 'src'), *[str(ROOT / 'src/ardia/linux' / name) for name in helper_sources], str(root / 'documents.cc'), str(root / 'main.cc'), '-o', str(binary)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            result = subprocess.run([str(binary)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
