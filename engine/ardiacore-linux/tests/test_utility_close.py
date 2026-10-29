from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from document_host_fixture import ROOT, SOURCES, PRELUDE, WRITER, host_methods, values, close_invoke
from test_renderer_contract import method


class UtilityCloseTests(unittest.TestCase):
    def test_request_targets_renderer_but_ack_and_reject_cannot_cross_windows(self):
        main = r'''
int main() {
  (void)Ignore;
  ShellHostView source;
  ShellHostView target;
  target.window_id_ = "target";
  source.native_profile.regular = true;
  hosts[1] = &source; hosts[2] = &target;
  auto invoke = [](ShellHostView& host, std::string method, base::Value value, auto done) {
    base::ListValue values; values.Append(std::move(value));
    base::DictValue args; args.Set("args", base::Value(std::move(values)));
    host.CloseInvoke(method, args, std::move(done));
  };
  base::DictValue query;
  query.Set("args", base::Value(base::ListValue()));
  source.CloseInvoke("ArdiaShell.windowIdentity", query, [&](bool ready, auto value) {
    assert(ready && value.GetDict().size() == 2);
    assert(*value.GetDict().FindString("windowId") == source.window_id_);
    assert(*value.GetDict().FindString("rendererGeneration") == "9007199254740993");
  });
  assert(source.DocumentClient().id.empty());
  source.handler.authorized = false;
  source.CloseInvoke("ArdiaShell.windowIdentity", query, [](bool ready, auto) { assert(!ready); });
  source.handler.authorized = true;
  source.native_profile.regular = false;
  source.CloseInvoke("ArdiaShell.windowIdentity", query, [](bool ready, auto) { assert(!ready); });
  source.native_profile.regular = true;
  auto saved_generation = source.renderer_generation_;
  source.renderer_generation_ = 0;
  source.CloseInvoke("ArdiaShell.windowIdentity", query, [](bool ready, auto) { assert(!ready); });
  source.renderer_generation_ = saved_generation;
  auto malformed = query.Clone(); malformed.Set("scope", "forged");
  source.CloseInvoke("ArdiaShell.windowIdentity", malformed, [](bool ready, auto) { assert(!ready); });
  source.CloseInvoke("ArdiaShell.windowIdentity", base::DictValue(), [](bool ready, auto) { assert(!ready); });
  base::DictValue identity;
  invoke(source, "ArdiaShell.requestWindowClose", base::Value("settings"),
      [&](bool success, base::Value result) { assert(success); identity = std::move(result.GetDict()); });
  assert(!identity.empty());
  assert(!source.native.widget.IsClosed() && files.tasks.empty());
  assert(target.events.empty());
  assert(source.events.size() == 1);
  target.RequestWindowClose();
  const auto target_identity = target.RequestWindowClose();
  invoke(source, "ArdiaShell.acknowledgeWindowClose", base::Value(Ack(target_identity, 0)),
      [](bool success, auto) { assert(!success); });
  invoke(source, "ArdiaShell.rejectWindowClose", base::Value(target_identity.Clone()),
      [](bool success, auto) { assert(!success); });
  assert(files.tasks.empty());
  bool confirmed = false;
  invoke(source, "ArdiaShell.rejectWindowClose", base::Value(identity.Clone()),
      [&](bool success, auto) { confirmed = success; });
  assert(!confirmed);
  Drain(); assert(confirmed && !source.native.widget.IsClosed());
  invoke(source, "ArdiaShell.rejectWindowClose", base::Value(identity.Clone()),
      [](bool success, auto) { assert(success); });
}
'''
        compiler = shutil.which('clang++') or shutil.which('c++')
        self.assertIsNotNone(compiler)
        with tempfile.TemporaryDirectory(prefix='ardia-close-dispatch-') as scratch:
            root = Path(scratch)
            (root / 'base/json').mkdir(parents=True)
            (root / 'base/values.h').write_text(values())
            (root / 'base/json/json_writer.h').write_text(WRITER)
            (root / 'main.cc').write_text(PRELUDE + host_methods() + close_invoke() + main)
            binary = root / 'close'
            result = subprocess.run([compiler, '-std=c++23', '-Wall', '-Wextra', '-Werror', '-I', str(root), '-I', str(ROOT / 'src'), *[str(ROOT / 'src/ardia/linux' / name) for name in SOURCES], str(root / 'main.cc'), '-o', str(binary)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            result = subprocess.run([str(binary)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_private_window_close_requests_only_come_from_the_window_or_its_opener(self):
        main = r'''
int main() {
  (void)Ignore;
  ShellHostView stranger;
  ShellHostView opener;
  ShellHostView target;
  stranger.window_id_ = "w-new";
  opener.window_id_ = "main";
  target.window_id_ = "w-p1";
  stranger.reach_id_ = 1; opener.reach_id_ = 2; target.reach_id_ = 3;
  target.page_profile_ = "incognito:w-p1@";
  target.opener_host_ = 2;
  target.opener_generation_ = opener.renderer_generation_;
  for (ShellHostView* host : {&stranger, &opener, &target}) host->native_profile.regular = true;
  for (ShellHostView* host : {&stranger, &target}) host->shared_profile = &opener.native_profile;
  hosts[1] = &stranger; hosts[2] = &opener; hosts[3] = &target;
  auto request = [](ShellHostView& host, const char* window) {
    base::ListValue values; values.Append(base::Value(window));
    base::DictValue args; args.Set("args", base::Value(std::move(values)));
    bool accepted = false;
    host.CloseInvoke("ArdiaShell.requestWindowClose", args, [&](bool success, base::Value) { accepted = success; });
    return accepted;
  };
  assert(!request(stranger, "w-p1"));
  assert(target.events.empty());
  stranger.window_id_ = "main";
  assert(!request(stranger, "w-p1"));
  assert(target.events.empty());
  opener.renderer_generation_ += 1;
  assert(!request(opener, "w-p1"));
  assert(target.events.empty());
  opener.renderer_generation_ -= 1;
  assert(request(opener, "w-p1"));
  assert(target.events.size() == 1);
  target.page_profile_ = "";
  assert(request(stranger, "w-p1"));
}
'''
        compiler = shutil.which('clang++') or shutil.which('c++')
        self.assertIsNotNone(compiler)
        with tempfile.TemporaryDirectory(prefix='ardia-private-close-') as scratch:
            root = Path(scratch)
            (root / 'base/json').mkdir(parents=True)
            (root / 'base/values.h').write_text(values())
            (root / 'base/json/json_writer.h').write_text(WRITER)
            (root / 'main.cc').write_text(PRELUDE + host_methods() + close_invoke() + main)
            binary = root / 'close'
            result = subprocess.run([compiler, '-std=c++23', '-Wall', '-Wextra', '-Werror', '-I', str(root), '-I', str(ROOT / 'src'), *[str(ROOT / 'src/ardia/linux' / name) for name in SOURCES], str(root / 'main.cc'), '-o', str(binary)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            result = subprocess.run([str(binary)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_bare_close_is_request_only_and_all_host_widgets_install_the_gate(self):
        source = (ROOT / 'src/ardia/linux/ac_linux_host.cc').read_text()
        close = method(source, '  if (method == "ArdiaShell.windowFrame" || method == "ArdiaShell.closeWindow"')
        self.assertIn('target->RequestWindowClose()', close)
        self.assertNotIn('CloseNativeWindow', close)
        self.assertNotIn('CloseUtilityAfterSave', close)
        initialize = method(source, 'void ShellHostView::Initialize()')
        self.assertLess(initialize.index('ArmWindowClose()'), initialize.index('if (is_utility())'))
        self.assertLess(source.index('close_.Sealed(identity'), source.index('host->CloseNativeWindow(identity)'))


if __name__ == '__main__':
    unittest.main()
