import pathlib
import shutil
import subprocess
import tempfile
import unittest


SOURCE = pathlib.Path(__file__).resolve().parents[1] / 'src'


class HostPolicyTests(unittest.TestCase):
    def test_resource_and_document_names_cannot_escape_their_roots(self):
        compiler = shutil.which('clang++') or shutil.which('c++')
        if compiler is None:
            self.skipTest('C++ compiler is unavailable')
        code = '''#include <cassert>
#include <string>
#include "ardia/linux/ac_linux_policy.h"
int main() {
  using namespace ardia::linux_policy;
  assert(ValidDocumentName("bookmarks-cache.json"));
  assert(ValidDocumentName("session.json"));
  assert(!ValidDocumentName("../session.json"));
  assert(!ValidDocumentName("/etc/passwd"));
  assert(!ValidDocumentName(".."));
  assert(!ValidDocumentName("."));
  assert(!ValidDocumentName(""));
  assert(!ValidDocumentName(std::string("state\\0.json", 11)));
  assert(!ValidDocumentName(std::string(129, 'a')));
  assert(ValidAssetPath("index.html"));
  assert(ValidAssetPath("assets/index-A8x.js"));
  assert(ValidAssetPath("favicons/en.wikipedia.org.png"));
  assert(!ValidAssetPath("../index.html"));
  assert(!ValidAssetPath("assets/../../index.html"));
  assert(!ValidAssetPath("assets/%2e%2e/index.html"));
  assert(!ValidAssetPath("assets/%2fetc/passwd"));
  assert(!ValidAssetPath("assets//index.js"));
  assert(!ValidAssetPath("assets/"));
  assert(!ValidAssetPath("/assets/index.js"));
  assert(!ValidAssetPath("assets\\\\index.js"));
  assert(!ValidAssetPath("assets/index.js?url=file:///etc/passwd"));
}
'''
        with tempfile.TemporaryDirectory(prefix='ardia-host-policy-test-') as scratch:
            scratch = pathlib.Path(scratch)
            cpp = scratch / 'policy.cc'
            cpp.write_text(code)
            binary = scratch / 'policy'
            subprocess.run([compiler, '-std=c++20', '-Wall', '-Werror', '-I', str(SOURCE), str(cpp), '-o', str(binary)], check=True, capture_output=True)
            subprocess.run([str(binary)], check=True)


    def test_stored_document_reads_distinguish_missing_from_failed(self):
        compiler = shutil.which('clang++') or shutil.which('c++')
        if compiler is None:
            self.skipTest('C++ compiler is unavailable')
        code = r'''#include <cassert>
#include <cerrno>
#include "ardia/linux/ac_linux_policy.h"
int main() {
  using namespace ardia::linux_policy;
  assert(ClassifyStoredRead(ENOENT, false) == StoredRead::kMissing);
  assert(ClassifyStoredRead(0, true) == StoredRead::kFound);
  assert(ClassifyStoredRead(0, false) == StoredRead::kFailed);
  assert(ClassifyStoredRead(EACCES, false) == StoredRead::kFailed);
  assert(ClassifyStoredRead(EIO, false) == StoredRead::kFailed);
  assert(ClassifyStoredRead(ENOTDIR, false) == StoredRead::kFailed);
}
'''
        with tempfile.TemporaryDirectory(prefix='ardia-stored-read-test-') as scratch:
            scratch = pathlib.Path(scratch)
            cpp = scratch / 'stored.cc'
            cpp.write_text(code)
            binary = scratch / 'stored'
            subprocess.run([compiler, '-std=c++20', '-Wall', '-Werror', '-I', str(SOURCE), str(cpp), '-o', str(binary)], check=True, capture_output=True)
            subprocess.run([str(binary)], check=True)


    def test_only_the_sync_state_may_exceed_the_document_limit_and_its_bound_covers_every_sealed_state(self):
        compiler = shutil.which('clang++') or shutil.which('c++')
        if compiler is None:
            self.skipTest('C++ compiler is unavailable')
        code = r'''#include <cassert>
#include "ardia/linux/ac_linux_policy.h"
#include "ardia/linux/ac_linux_sync.h"
int main() {
  using namespace ardia;
  constexpr size_t mib = 1024 * 1024;
  static_assert(linux_policy::kDocumentLimit == 8 * mib);
  assert(linux_policy::DocumentLimit(linux_policy::kSyncStateDocument) == linux_policy::kSyncStateDocumentLimit);
  assert(linux_policy::DocumentLimit("sync-state.nns") > linux_policy::kDocumentLimit);
  for (const char* name : {"settings.json", "sync.json", "sync-journal.nns", "sync-journal-1.nns", "sync-state.nns.bak", "live.json"})
    assert(linux_policy::DocumentLimit(name) == linux_policy::kDocumentLimit);
  constexpr size_t plain = 4 + linux_sync::kMaxPayloadBytes;
  constexpr size_t padded = (plain + linux_sync::kFilePadding - 1) / linux_sync::kFilePadding * linux_sync::kFilePadding;
  constexpr size_t sealed = 4 + linux_sync::kNonceBytes + padded + linux_sync::kTagBytes;
  static_assert(4 * ((sealed + 2) / 3) <= linux_policy::kSyncStateDocumentLimit);
  static_assert(linux_policy::kSyncStateDocumentLimit <= 48 * mib);
}
'''
        with tempfile.TemporaryDirectory(prefix='ardia-document-limit-test-') as scratch:
            scratch = pathlib.Path(scratch)
            cpp = scratch / 'limit.cc'
            cpp.write_text(code)
            binary = scratch / 'limit'
            subprocess.run([compiler, '-std=c++20', '-Wall', '-Werror', '-I', str(SOURCE), str(cpp), '-o', str(binary)], check=True, capture_output=True)
            subprocess.run([str(binary)], check=True)


if __name__ == '__main__':
    unittest.main()
