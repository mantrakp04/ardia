import shutil

from document_host_fixture import PRELUDE, PROFILE, WRITER, values, host_methods
from test_chromium_close import patched_sources, production_methods, method, FIXTURES


def fixture(scratch):
    scratch.mkdir(exist_ok=True)
    source_root = scratch / 'pinned'
    source_root.mkdir(exist_ok=True)
    unload, manager = patched_sources(source_root)
    for name in ['functional/callback.h', 'functional/bind.h', 'unguessable_token.h', 'check.h', 'location.h', 'no_destructor.h', 'task/single_thread_task_runner.h']:
        target = scratch / 'base' / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text('#include "close_base.h"\n')
    (scratch / 'base/json').mkdir(exist_ok=True)
    (scratch / 'base/values.h').write_text(values())
    (scratch / 'base/json/json_writer.h').write_text(WRITER)
    for name in ['close_content_types.h', 'close_content_support.h']:
        shutil.copyfile(FIXTURES / name, scratch / name)
    base = (FIXTURES / 'close_base.h').read_text()
    base = base.replace('#include <functional>', '#include <functional>\n#include <deque>')
    base = base.replace('  T* get() const { auto alive', '  WeakPtr(T* ptr, std::shared_ptr<bool> alive) : ptr_(ptr), alive_(alive) {}\n  void reset() { ptr_ = nullptr; alive_.reset(); }\n  T* get() const { auto alive')
    base = base.replace('  bool RunsTasksInCurrentSequence() const', '  void One() { auto task = std::move(tasks.front()); tasks.erase(tasks.begin()); std::move(task).Run(); }\n  std::vector<OnceClosure> timers;\n  void PostDelayedTask(int, OnceClosure task, int) { timers.push_back(std::move(task)); }\n  bool RunsTasksInCurrentSequence() const')
    base = base.replace('struct ElapsedTimer', 'inline int Seconds(int n) { return n; }\ninline std::string NumberToString(uint64_t n) { return std::to_string(n); }\nstruct ElapsedTimer')
    base = base.replace('struct Profile {', 'struct Profile { bool IsRegularProfile() const { return true; }')
    base = base.replace('struct BrowserManagerService {', 'void FinalizeWidget(BrowserWindowInterface*);\nstruct BrowserManagerService {')
    base = base.replace('browser->destroyed = true;', 'browser->destroyed = true; FinalizeWidget(browser);')
    (scratch / 'close_base.h').write_text(base)
    content = (source_root / 'content/browser/renderer_host/render_frame_host_impl.cc').read_text()
    content_manager = (source_root / 'content/browser/renderer_host/render_frame_host_manager.cc').read_text()
    content_methods = '\n'.join(method(content, 'void RenderFrameHostImpl::' + name + '(') for name in [
        'SuddenTerminationDisablerChanged',
        'StartLinuxBeforeUnloadDispatch', 'CompleteLinuxBeforeUnloadDispatch',
        'ProcessLinuxBeforeUnloadCompleted', 'DispatchBeforeUnload',
        'ProcessBeforeUnloadCompleted', 'ProcessBeforeUnloadCompletedFromFrame',
        'SimulateBeforeUnloadCompleted', 'SendBeforeUnload', 'ContinueNavigationAfterBeforeUnloadCheck'])
    content_methods += '\n' + method(content_manager, 'void RenderFrameHostManager::BeforeUnloadCompleted(')
    asyncs = PRELUDE[PRELUDE.index('base::SingleThreadTaskRunner files;'):PRELUDE.index('struct ShellHostView;')].replace('auto* ui =', 'auto ui =')
    widget = PRELUDE[PRELUDE.index('struct ShellHostView;'):PRELUDE.index('struct Browser {')]
    host = PRELUDE[PRELUDE.index('struct Handler {'):]
    host = host.replace(PROFILE, '')
    host = host.replace('  Browser native;', '  BrowserWindowInterface& native;\n  views::Widget native_widget;')
    host = host.replace('Browser*', 'BrowserWindowInterface*')
    host = host.replace('  ShellHostView() {\n    native.widget.owner = this;\n    native.on_cancel = [this](base::UnguessableToken token) { ChromeCloseCancelled(token); };\n  }', '  explicit ShellHostView(BrowserWindowInterface& b) : native(b) { native_widget.owner = this; }')
    host = host.replace('native.widget', 'native_widget')
    preamble = '#include "ardia/linux/ac_linux_close_hooks.h"\n#include "ardia/linux/ac_linux_document_service.h"\n#include "ardia/linux/ac_linux_close.h"\n#include "base/json/json_writer.h"\n#include <iostream>\nusing namespace ardia;\n'
    return preamble + production_methods(unload, manager) + '\nnamespace content {\n' + content_methods + '\n}\n' + asyncs + widget + host + host_methods()
