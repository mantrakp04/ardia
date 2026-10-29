from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


class NativeCallbackTests(unittest.TestCase):
    def test_real_callbacks_adopt_tabs_and_close_without_breaking_transfers(self):
        compiler = shutil.which('clang++') or shutil.which('c++')
        if compiler is None:
            self.skipTest('C++ compiler is unavailable')
        source = (Path(__file__).resolve().parents[1] / 'src/ardia/linux/ac_linux_host.cc').read_text()

        def method(name):
            start = source.index('void TabBinding::' + name + '(')
            brace = source.index('{', start)
            depth = 1
            end = brace + 1
            while depth:
                depth += (source[end] == '{') - (source[end] == '}')
                end += 1
            return source[start:end]

        methods = '\n'.join(method(name) for name in ['RemoveViewports', 'Rebind', 'MoveTo', 'DidOpenRequestedURL', 'ReportOpened', 'WebContentsDestroyed'])
        prelude = r'''
        #include <cassert>
        #include <map>
        #include <memory>
        #include <string>
        #include <string_view>
        #include <utility>
        #include <vector>
        namespace base {
        struct DictValue {
          std::map<std::string, std::string> strings;
          std::map<std::string, DictValue> objects;
          DictValue& Set(const char* key, std::string_view value) { strings[key] = value; return *this; }
          DictValue& Set(const char* key, DictValue value) { objects[key] = std::move(value); return *this; }
        };
        std::string NumberToString(int value) { return std::to_string(value); }
        }
        template<typename T> struct raw_ptr {
          T* pointer;
          raw_ptr(T* value = nullptr) : pointer(value) {}
          raw_ptr& operator=(T* value) { pointer = value; return *this; }
          operator T*() const { return pointer; }
          T* operator->() const { return pointer; }
          T* get() const { return pointer; }
        };
        class TabBinding;
        namespace content {
        struct RenderFrameHost {};
        struct Referrer {};
        struct WebContents {
          int id;
          void* context;
          TabBinding* observer = nullptr;
          void* GetBrowserContext() { return context; }
          void Destroy();
        };
        }
        namespace views {
        struct WebView {
          bool visible = true;
          content::WebContents* contents = nullptr;
          int detachments = 0;
          bool GetVisible() { return visible; }
          void SetVisible(bool value) { visible = value; }
          void SetWebContents(content::WebContents* value) { contents = value; if (!value) ++detachments; }
        };
        }
        namespace ui { enum PageTransition { PAGE_TRANSITION_LINK }; }
        enum class WindowOpenDisposition { NEW_POPUP, NEW_WINDOW, NEW_FOREGROUND_TAB, NEW_BACKGROUND_TAB, CURRENT_TAB, OFF_THE_RECORD, SAVE_TO_DISK };
        struct GURL {
          std::string url;
          const std::string& spec() const { return url; }
        };
        struct ShellHostView {
          int removed_views = 0;
          int layouts = 0;
          void LayoutPane(TabBinding*) { ++layouts; }
          int offered = 0;
          void OfferTab(content::WebContents*) { ++offered; }
          void RemoveChildViewT(views::WebView*) { ++removed_views; }
        };
        namespace ardiacore { struct LinuxPageChannel { static inline int detached = 0; static LinuxPageChannel* FromWebContents(content::WebContents*) { static LinuxPageChannel channel; return &channel; } void Detach() { ++detached; } }; inline int forgotten_hangs = 0; inline void ForgetDeferredLinuxHangs(content::WebContents*) { ++forgotten_hangs; } }
        struct FakePage {
          std::vector<std::string>* log;
          bool EmitClosed() { log->push_back("closed"); return true; }
        };
        int TabId(content::WebContents* contents) { return contents->id; }
        class TabBinding {
         public:
          bool presented = false;
          bool presentation_applied = false;
          bool presentation_attached = false;
          bool presentation_departed = false;
          int cancelled_auto_pip_until = 0;
          int requested_auto_pip_until = 0;
          bool pane_visible = false;
          bool devtools_had_focus = false;
          std::unique_ptr<int> devtools_watch;
          int resets = 0;
          int contents_generation_ = 1;
          std::vector<std::string> log;
          std::vector<std::pair<std::string, base::DictValue>> presentations;
          std::unique_ptr<FakePage> page_;
          void Attach() { page_ = std::make_unique<FakePage>(FakePage{&log}); }
          void RetirePage() { if (page_) { page_.reset(); log.push_back("retired"); } }
          void ReportPresentation(std::string name, base::DictValue data) { if (page_) presentations.emplace_back(std::move(name), std::move(data)); }
          struct Weak { TabBinding* binding; explicit operator bool() const { return binding; } };
          Weak GetWeakPtr() { return {this}; }
          void RememberPendingAutoPictureInPicture() {}
          void ResetPageCommands() { ++resets; }
          std::unique_ptr<int> media;
          int media_starts = 0;
          bool frozen = false;
          bool discard_reported = false;
          void StartMedia() { media = std::make_unique<int>(++media_starts); }
          void RemoveViewports();
          TabBinding(ShellHostView* owner, content::WebContents* contents, views::WebView* viewport = nullptr, views::WebView* devtools = nullptr)
              : owner_(owner), contents_(contents), viewport_(viewport), devtools_viewport_(devtools) { Observe(contents); }
          ~TabBinding() { Observe(nullptr); }
          void Observe(content::WebContents* value) {
            if (observed_ && observed_->observer == this) observed_->observer = nullptr;
            observed_ = value;
            if (observed_) observed_->observer = this;
          }
          void Rebind(content::WebContents*);
          void MoveTo(ShellHostView*);
          void DidOpenRequestedURL(content::WebContents*, content::RenderFrameHost*, const GURL&, const content::Referrer&, WindowOpenDisposition, ui::PageTransition, bool, bool);
          void ReportOpened(content::WebContents* opened, const GURL& url, std::string_view disposition);
          void WebContentsDestroyed();
          raw_ptr<ShellHostView> owner_;
          raw_ptr<content::WebContents> contents_;
          raw_ptr<views::WebView> viewport_;
          raw_ptr<views::WebView> devtools_viewport_;
          content::WebContents* observed_ = nullptr;
        };
        void content::WebContents::Destroy() { if (observer) observer->WebContentsDestroyed(); }
        '''
        tests = r'''
        void TestOpen() {
          ShellHostView host;
          int profile = 0;
          int other_profile = 0;
          content::WebContents source{11, &profile};
          content::WebContents target{12, &profile};
          content::WebContents private_target{13, &other_profile};
          content::WebContents invalid{0, &profile};
          TabBinding binding(&host, &source);
          binding.Attach();
          const std::vector<std::pair<WindowOpenDisposition, std::string>> supported = {
            {WindowOpenDisposition::NEW_FOREGROUND_TAB, "foreground"},
            {WindowOpenDisposition::NEW_BACKGROUND_TAB, "background"},
            {WindowOpenDisposition::NEW_POPUP, "popup"},
            {WindowOpenDisposition::NEW_WINDOW, "window"},
          };
          for (const auto& [disposition, expected] : supported) {
            binding.presentations.clear();
            binding.DidOpenRequestedURL(&target, nullptr, {"https://example.test/new"}, {}, disposition, ui::PAGE_TRANSITION_LINK, false, true);
            assert(binding.presentations.size() == 1);
            const auto& [name, value] = binding.presentations.front();
            assert(name == "openWindow");
            assert(!value.strings.contains("type"));
            assert(value.strings.at("disposition") == expected);
            assert(value.strings.at("adoptId") == "tab:12");
            assert(value.strings.at("url") == "https://example.test/new");
            assert(value.strings.at("profile").empty());
          }
          binding.presentations.clear();
          for (auto disposition : {WindowOpenDisposition::CURRENT_TAB, WindowOpenDisposition::OFF_THE_RECORD, WindowOpenDisposition::SAVE_TO_DISK}) {
            binding.DidOpenRequestedURL(&target, nullptr, {"https://example.test"}, {}, disposition, ui::PAGE_TRANSITION_LINK, false, true);
          }
          for (auto* opened : {&private_target, &invalid, static_cast<content::WebContents*>(nullptr)}) {
            binding.DidOpenRequestedURL(opened, nullptr, {"https://example.test"}, {}, WindowOpenDisposition::NEW_FOREGROUND_TAB, ui::PAGE_TRANSITION_LINK, false, true);
          }
          assert(binding.presentations.empty());
          binding.RetirePage();
          const int offered = host.offered;
          binding.DidOpenRequestedURL(&target, nullptr, {"https://example.test"}, {}, WindowOpenDisposition::NEW_FOREGROUND_TAB, ui::PAGE_TRANSITION_LINK, false, true);
          assert(binding.presentations.empty() && host.offered == offered + 1);
        }
        void TestClose() {
          ShellHostView first;
          ShellHostView second;
          int profile = 0;
          content::WebContents original{20, &profile};
          content::WebContents replacement{20, &profile};
          views::WebView viewport;
          views::WebView tools;
          tools.contents = &original;
          TabBinding binding(&first, &original, &viewport, &tools);
          binding.Attach();
          binding.Rebind(&replacement);
          assert(ardiacore::LinuxPageChannel::detached == 1 && ardiacore::forgotten_hangs == 1);
          assert(binding.resets == 1 && !tools.visible && !tools.contents);
          assert(binding.log == std::vector<std::string>{"retired"} && binding.contents_generation_ == 2);
          original.Destroy();
          assert(binding.log.size() == 1);
          binding.presented = true;
          binding.presentation_applied = true;
          binding.presentation_attached = true;
          binding.presentation_departed = true;
          binding.pane_visible = true;
          binding.Attach();
          binding.MoveTo(&second);
          assert(binding.resets == 2 && !binding.pane_visible);
          assert(!binding.devtools_viewport_.get());
          assert(binding.log.size() == 2 && binding.log.back() == "retired");
          assert(!binding.presented);
          assert(!binding.presentation_applied);
          assert(!binding.presentation_attached);
          assert(!binding.presentation_departed);
          assert(first.removed_views == 2);
          assert(binding.viewport_.get() == nullptr);
          binding.Attach();
          replacement.Destroy();
          assert(binding.resets == 3);
          assert((binding.log == std::vector<std::string>{"retired", "retired", "closed", "retired"}));
          assert(binding.contents_.get() == nullptr);
          replacement.Destroy();
          assert(binding.log.size() == 4);
          content::WebContents direct{30, &profile};
          views::WebView direct_view;
          TabBinding direct_binding(&first, &direct, &direct_view);
          direct_binding.devtools_watch = std::make_unique<int>(1);
          direct.Destroy();
          assert(direct_view.detachments == 1);
          assert(!direct_binding.devtools_watch && first.layouts == 1);
          assert(direct_binding.log.empty());
          assert(direct_binding.contents_.get() == nullptr);
        }
        int main(int argc, char** argv) {
          if (argc == 1 || std::string(argv[1]) == "open") TestOpen();
          if (argc == 1 || std::string(argv[1]) == "close") TestClose();
        }
        '''
        with tempfile.TemporaryDirectory(prefix='ardia-native-events-') as scratch:
            root = Path(scratch)
            cpp = root / 'events.cc'
            binary = root / 'events'
            cpp.write_text(prelude + methods + tests)
            result = subprocess.run([compiler, '-std=c++20', '-Wall', '-Wextra', '-Werror', str(cpp), '-o', str(binary)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            subprocess.run([str(binary)], check=True)


if __name__ == '__main__':
    unittest.main()
