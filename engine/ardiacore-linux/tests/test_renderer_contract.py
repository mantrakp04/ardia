from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'src/ardia/linux/ac_linux_host.cc'


def method(source, signature):
    start = source.index(signature)
    brace = source.index('{', start)
    depth = 1
    end = brace + 1
    while depth:
        depth += (source[end] == '{') - (source[end] == '}')
        end += 1
    return source[start:end]


class RendererContractTests(unittest.TestCase):
    def compile_and_run(self, code, mode):
        compiler = shutil.which('clang++') or shutil.which('c++')
        if compiler is None:
            self.skipTest('C++ compiler is unavailable')
        with tempfile.TemporaryDirectory(prefix='ardia-renderer-contract-') as scratch:
            cpp = Path(scratch) / 'renderer.cc'
            binary = Path(scratch) / 'renderer'
            cpp.write_text(code)
            result = subprocess.run([compiler, '-std=c++20', '-Wall', '-Wextra', '-Werror', '-I', str(ROOT / 'src'), str(cpp), '-o', str(binary)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            result = subprocess.run([str(binary), mode], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)

    def lifecycle_fixture(self):
        source = SOURCE.read_text()
        methods = '\n'.join(method(source, signature) for signature in [
            '  uint64_t SetHandler(', '  bool ClearHandler(', '  bool OwnsHandler(', '  void RetireRenderer()',
        ])
        guard = method(source, 'TabBinding* ShellHostView::ClaimedBinding(')
        trusted = method(source, 'bool ShellHostView::Trusted(')
        handlers = []
        for name in ['~HostMessageHandler', 'RegisterMessages', 'ActivateCommittedRenderer', 'PrimaryPageChanged', 'PrimaryMainFrameRenderProcessGone', 'OnJavascriptDisallowed']:
            signature = ('  ~' if name.startswith('~') else '  void ') + name.lstrip('~') + '('
            native = method(source[source.index('class HostMessageHandler :'):], signature).strip().replace(' override', '')
            native = native.replace(name + '(', 'HostMessageHandler::' + name + '(', 1)
            handlers.append(native)
        code = (ROOT / 'tests/fixtures/renderer.h').read_text()
        methods = '  std::string LiveCaller() const { return "live"; }\n' + methods
        code = code.replace('struct ShellHostView {', 'inline void LinuxLiveCallerGone(const std::string&) {}\nstruct ShellHostView {', 1)
        code = code.replace('ARDIA_METHODS', methods).replace('ARDIA_GUARD', guard).replace('ARDIA_TRUSTED', trusted).replace('ARDIA_HANDLER_METHODS', '\n'.join(handlers))
        return code + r'''
int main(int argc, char** argv) {
  assert(argc == 2);
  if (std::string(argv[1]) == "destruction") {
    ShellHostView replacement;
    auto old = std::make_unique<HostMessageHandler>(&replacement);
    replacement.CommitHandler(old.get());
    auto ordinary = std::make_unique<TabBinding>();
    ordinary->claim = "old";
    ordinary->renderer_generation = replacement.renderer_generation_;
    replacement.bindings_[7] = std::move(ordinary);
    auto temporary = std::make_unique<TabBinding>();
    temporary->temporary = true;
    replacement.bindings_[8] = std::move(temporary);
    auto current = std::make_unique<HostMessageHandler>(&replacement);
    replacement.CommitHandler(current.get());
    replacement.Binding(7)->claim = "current";
    replacement.Binding(7)->renderer_generation = replacement.renderer_generation_;
    const auto generation = replacement.renderer_generation_;
    old.reset();
    assert(replacement.OwnsHandler(current.get(), generation));
    assert(replacement.Binding(7)->claim == "current");
    assert(!replacement.Binding(8)->live);
    assert(replacement.closed == 1);
    current.reset();
    assert(replacement.Binding(7)->claim.empty());
    assert(replacement.Binding(7)->live);
    assert(replacement.closed == 1);
    return 0;
  }
  ShellHostView host;
  HostMessageHandler a;
  HostMessageHandler b;
  host.CommitHandler(&a);
  const auto a_generation = host.renderer_generation_;
  auto ordinary = std::make_unique<TabBinding>();
  ordinary->claim = "a";
  ordinary->renderer_generation = host.renderer_generation_;
  host.bindings_[7] = std::move(ordinary);
  auto temporary = std::make_unique<TabBinding>();
  temporary->claim = "temporary";
  temporary->temporary = true;
  temporary->renderer_generation = host.renderer_generation_;
  host.bindings_[8] = std::move(temporary);
  base::DictValue args;
  args.ints["id"] = 7;
  args.strings["claim"] = "a";
  assert(host.ClaimedBinding(args));
  assert(host.OwnsHandler(&a, a_generation));
  if (std::string(argv[1]) == "replacement") {
    host.CommitHandler(&b);
    assert(host.Binding(7)->page_command_resets == 1 && host.Binding(8)->page_command_resets == 1);
    assert(!host.ClearHandler(&a));
    assert(!host.OwnsHandler(&a, a_generation));
    assert(!host.OwnsHandler(&a, host.renderer_generation_));
    assert(host.OwnsHandler(&b, host.renderer_generation_));
    assert(!host.ClaimedBinding(args));
    assert(host.Binding(7)->claim.empty());
    assert(host.Binding(7)->retired_pages == 1 && host.Binding(7)->claim_at_retirement == "a");
    assert(host.Binding(7)->live);
    assert(!host.Binding(8)->live);
    host.Binding(7)->claim = "b";
    host.Binding(7)->renderer_generation = host.renderer_generation_;
    args.strings["claim"] = "b";
    assert(host.ClaimedBinding(args));
    const auto generation = host.renderer_generation_;
    host.CommitHandler(&b);
    assert(host.renderer_generation_ == generation);
    assert(!host.ClearHandler(&a));
    assert(host.ClaimedBinding(args));
    host.Binding(7)->renderer_generation = generation - 1;
    assert(!host.ClaimedBinding(args));
  } else {
    assert(host.ClearHandler(&a));
    assert(!host.Binding(8)->live);
    assert(host.Binding(7)->live);
    assert(host.closed == 1);
    assert(!host.ClearHandler(&a));
    assert(host.closed == 1);
    host.CommitHandler(&b);
    host.Binding(7)->claim = "b";
    host.Binding(7)->renderer_generation = host.renderer_generation_;
    args.strings["claim"] = "b";
    assert(host.ClaimedBinding(args));
  }
}
'''

    def test_handler_replacement_retires_the_predecessor_atomically(self):
        self.compile_and_run(self.lifecycle_fixture(), 'replacement')

    def test_handler_destructors_cannot_retire_a_replacement(self):
        self.compile_and_run(self.lifecycle_fixture(), 'destruction')

    def test_renderer_teardown_closes_temporary_and_retains_logical_tabs(self):
        self.compile_and_run(self.lifecycle_fixture(), 'teardown')


if __name__ == '__main__':
    unittest.main()
