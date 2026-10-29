import pathlib
import tempfile
import unittest

from test_downloads import compile_and_run
from test_renderer_contract import method

ROOT = pathlib.Path(__file__).resolve().parents[1]
LINUX = ROOT / 'src/ardia/linux'
ENGINE = ROOT.parents[0] / 'chromium/src/chrome/browser/ardia'


class BookmarkChangeTests(unittest.TestCase):
    def setUp(self):
        self.host = (LINUX / 'ac_linux_host.cc').read_text()

    def test_an_applied_bookmark_write_is_announced_as_a_bookmark_change(self):
        code = r'''
#include "ardia/linux/ac_linux_contract.h"
#include <cassert>
using namespace ardiacore::linux_contract;
int main() {
  assert(ChangeAnnouncedAfter("bookmarks.apply", 1) == "bookmarks.changed");
  assert(ChangeAnnouncedAfter("bookmarks.apply", 3) == "bookmarks.changed");
  assert(EventName(ChangeAnnouncedAfter("bookmarks.apply", 1)) == "bookmarks.changed");
  assert(ChangeAnnouncedAfter("bookmarks.apply", 0).empty());
  assert(ChangeAnnouncedAfter("bookmarks.apply", -1).empty());
  for (auto name : {"bookmarks.tree", "bookmarks.watch", "history.add", "history.query", "history.deleteUrls", "favicons.set", "extensions.install", ""})
    assert(ChangeAnnouncedAfter(name, 1).empty());
}
'''
        with tempfile.TemporaryDirectory(prefix='ardia-bookmark-changes-') as directory:
            source = pathlib.Path(directory) / 'changes.cc'
            source.write_text(code)
            compile_and_run(self, 'bookmark-changes', [source])

    def test_a_history_import_is_announced_so_other_windows_read_history_again(self):
        code = r'''
#include "ardia/linux/ac_linux_contract.h"
#include <cassert>
#include <optional>
using namespace ardiacore::linux_contract;
int main() {
  assert(ChangeAnnouncedAfter("history.import", std::nullopt) == "history.imported");
  assert(ChangeAnnouncedAfter("history.import", 0) == "history.imported");
  assert(EventName(ChangeAnnouncedAfter("history.import", std::nullopt)) == "history.imported");
  assert(EventName("history.imported") == "history.imported");
  assert(ChangeAnnouncedAfter("bookmarks.apply", std::nullopt).empty());
  assert(ChangeAnnouncedAfter("history.add", std::nullopt).empty());
}
'''
        with tempfile.TemporaryDirectory(prefix='ardia-history-imports-') as directory:
            source = pathlib.Path(directory) / 'imports.cc'
            source.write_text(code)
            compile_and_run(self, 'history-imports', [source])

    def test_the_engine_still_mutes_its_own_change_event_while_applying(self):
        engine = (ENGINE / 'ac_bookmarks.cc').read_text()
        apply = engine[engine.index('AC_PROFILE_CALL(ac_bookmarks_apply)'):engine.index('AC_PROFILE_CALL(ac_bookmarks_watch)')]
        self.assertLess(apply.index('watcher.set_applying(true);'), apply.index('ardia::Apply(model, op)'))
        self.assertLess(apply.index('ardia::Apply(model, op)'), apply.index('watcher.set_applying(false);'))
        self.assertIn('if (applying_ || pending_) {', engine)

    def test_the_host_announces_a_successful_write_to_every_other_window_with_the_written_profile(self):
        struct = self.host[self.host.index('  struct EngineReply {'):]
        struct = struct[:struct.index('};')]
        self.assertIn('std::string profile_path;', struct)
        replied = method(self.host, '  static void Replied(void* context, const char* json) {')
        error = replied.index('value->GetDict().Find("error")')
        announce = replied.index('ardiacore::linux_contract::ChangeAnnouncedAfter(')
        resolve = replied.index('reply->handler->Resolve(reply->id, std::move(*value));')
        self.assertLess(error, announce)
        self.assertLess(announce, resolve)
        block = replied[announce:resolve]
        self.assertIn(': std::nullopt', block)
        self.assertIn('FindInt("applied")', block)
        self.assertIn('!reply->profile_path.empty()', block)
        self.assertIn('Hosts()', block)
        self.assertIn('host != reply->handler->host_.get()', block)
        self.assertIn('host->EngineEvent(change, changed)', block)
        self.assertIn('.Set("profile", reply->profile_path)', block)
        request = method(self.host, '  void Request(const base::ListValue& arguments) {')
        generic = request[request.index('const auto* route = ardiacore::linux_contract::FindRoute(name);'):]
        generic = generic[:generic.index('if (arguments[1].GetString() != "host.invoke")')]
        self.assertIn('const std::string path = resolved->GetPath().value();', generic)
        self.assertIn('new EngineReply{name, handler, id, path}', generic)


if __name__ == '__main__':
    unittest.main()
