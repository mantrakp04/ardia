#include "ardia/linux/ac_linux_contract.h"
#include <cassert>
#include <cstdint>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <vector>
struct GURL {
  std::string text;
  explicit GURL(std::string value) : text(std::move(value)) {}
  std::string host() const { return text == "chrome://ardia/" ? "ardia" : "other"; }
};
namespace url {
struct Origin {
  std::string text;
  static Origin Create(const GURL& url) { return {url.text}; }
  bool operator==(const Origin& other) const { return text == other.text; }
};
}
namespace base {
inline std::string NumberToString(uint64_t value) { return std::to_string(value); }
struct DictValue {
  std::map<std::string, int> ints;
  std::map<std::string, std::string> strings;
  std::optional<int> FindInt(const char* key) const {
    const auto found = ints.find(key);
    return found == ints.end() ? std::nullopt : std::optional(found->second);
  }
};
using ListValue = std::vector<int>;
enum TerminationStatus { TERMINATION_STATUS_PROCESS_CRASHED };
template<class F, class... A> int BindRepeating(F, A...) { return 0; }
template<class T> T* Unretained(T* value) { return value; }
}
namespace content {
struct WebUI;
struct RenderFrameHost;
struct WeakDocumentPtr {
  RenderFrameHost* frame = nullptr;
  std::weak_ptr<int> life;
  RenderFrameHost* AsRenderFrameHostIfValid() const { return life.expired() ? nullptr : frame; }
};
struct RenderFrameHost {
  WebUI* ui = nullptr;
  bool live = true;
  std::shared_ptr<int> life = std::make_shared<int>(0);
  url::Origin origin = url::Origin::Create(GURL("chrome://ardia/"));
  WebUI* GetWebUI() { return ui; }
  bool IsRenderFrameLive() { return live; }
  url::Origin GetLastCommittedOrigin() { return origin; }
  WeakDocumentPtr GetWeakDocumentPtr() { return {this, life}; }
  void NewDocument(WebUI* value) { life = std::make_shared<int>(0); ui = value; }
};
struct WebContents {
  RenderFrameHost* primary = nullptr;
  RenderFrameHost* GetPrimaryMainFrame() { return primary; }
  GURL GetLastCommittedURL() { return GURL("chrome://ardia/"); }
};
struct WebUI {
  RenderFrameHost* frame = nullptr;
  WebContents* contents = nullptr;
  RenderFrameHost* GetRenderFrameHost() { return frame; }
  WebContents* GetWebContents() { return contents; }
  void RegisterMessageCallback(const char*, int) {}
};
struct Page {
  RenderFrameHost* frame;
  RenderFrameHost& GetMainDocument() { return *frame; }
};
}
std::string String(const base::DictValue& args, const char* key) {
  const auto found = args.strings.find(key);
  return found == args.strings.end() ? "" : found->second;
}
struct ShellHostView;
struct HostMessageHandler {
  ShellHostView* host_ = nullptr;
  uint64_t generation_ = 0;
  content::WebUI ui_;
  struct Factory {
    HostMessageHandler* value;
    HostMessageHandler* GetWeakPtr() { return value; }
    void InvalidateWeakPtrs() {}
  } weak_factory_{this};
  explicit HostMessageHandler(ShellHostView* host = nullptr) : host_(host) {}
  ~HostMessageHandler();
  content::WebUI* web_ui() { return &ui_; }
  void Request(const base::ListValue&) {}
  void RegisterMessages();
  void ActivateCommittedRenderer();
  void PrimaryPageChanged(content::Page&);
  void PrimaryMainFrameRenderProcessGone(base::TerminationStatus);
  void OnJavascriptDisallowed();
};
struct FocusManager { void set_shortcut_handling_suspended(bool) {} };
namespace base { template<class C, class V> bool Contains(const C& container, const V& value) { for (const auto& item : container) if (item == value) return true; return false; } }
struct TabBinding {
  int page_command_resets = 0;
  void ResetPageCommands() { ++page_command_resets; }
  bool live = true;
  bool temporary = false;
  bool transferable = true;
  std::string claim;
  uint64_t renderer_generation = 0;
  int retired_pages = 0;
  std::string claim_at_retirement = "unretired";
  std::vector<int> replaced_ids;
  void RetirePage() { ++retired_pages; claim_at_retirement = claim; }
  TabBinding* contents() { return live ? this : nullptr; }
};
struct ShellHostView {
  HostMessageHandler* handler_ = nullptr;
  struct Dialogs {
    struct Controller {
      std::vector<std::string> replaced;
      std::vector<std::string> retired;
      bool ReplaceRenderer(const std::string& generation) { replaced.push_back(generation); return true; }
      void RetireRenderer(const std::string& generation) { retired.push_back(generation); }
    } controller_;
    Controller& controller() { return controller_; }
  };
  std::unique_ptr<Dialogs> dialogs_ = std::make_unique<Dialogs>();
  uint64_t renderer_generation_ = 0;
  content::WeakDocumentPtr renderer_document_;
  content::RenderFrameHost frame_;
  content::WebContents contents_{&frame_};
  int browser_ = 1;
  std::map<int, std::unique_ptr<TabBinding>> bindings_;
  bool utility_ready_ = false;
  bool switcher_capture_ = false;
  std::unique_ptr<int> switcher_source_;
  FocusManager* focus_manager_ = nullptr;
  bool shortcut_recording_ = false;
  int detached = 0;
  int closed = 0;
  int released_drag_escapes = 0;
  void ReleaseDragEscape() { ++released_drag_escapes; }
  content::WebContents* shell() const { return const_cast<content::WebContents*>(&contents_); }
  bool RetireDocuments() { return true; }
  void DetachViewports() { ++detached; }
  ShellHostView* GetWeakPtr() { return this; }
  bool DisposeTemporary(TabBinding* binding) { binding->live = false; ++closed; return true; }
  TabBinding* Binding(int id) {
    const auto found = bindings_.find(id);
    return found == bindings_.end() ? nullptr : found->second.get();
  }
  uint64_t CommitHandler(HostMessageHandler* handler) {
    handler->ui_ = {&frame_, &contents_};
    if (frame_.GetWebUI() != handler->web_ui()) frame_.NewDocument(handler->web_ui());
    return SetHandler(handler, handler->web_ui());
  }
  bool Trusted(content::WebUI*) const;
  TabBinding* ClaimedBinding(const base::DictValue&);
  ARDIA_METHODS
};
ARDIA_GUARD
ARDIA_TRUSTED
ARDIA_HANDLER_METHODS
