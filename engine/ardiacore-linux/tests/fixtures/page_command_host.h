#pragma once

#include "page_commands_fixture.h"

#ifndef FROM_HERE
#define FROM_HERE 0
#endif

namespace base {
template <typename Signature> class OnceCallback;
template <typename R, typename... Args> class OnceCallback<R(Args...)> {
 public:
  OnceCallback() = default;
  template <typename F> OnceCallback(F f) : fn_(std::move(f)) {}
  R Run(Args... args) && {
    auto fn = std::move(fn_);
    return fn(std::forward<Args>(args)...);
  }
 private:
  std::function<R(Args...)> fn_;
};
inline std::string NumberToString(int value) { return std::to_string(value); }
}

namespace content {
class WeakDocumentPtr {
 public:
  WeakDocumentPtr() = default;
  WeakDocumentPtr(RenderFrameHost* frame, std::weak_ptr<bool> alive) : frame_(frame), alive_(std::move(alive)) {}
  RenderFrameHost* AsRenderFrameHostIfValid() const { return alive_.expired() ? nullptr : frame_; }
 private:
  RenderFrameHost* frame_ = nullptr;
  std::weak_ptr<bool> alive_;
};
}

namespace ardiacore {
inline bool background = false;
inline bool BackgroundInstance() { return background; }
}

struct SentEvent {
  std::string module;
  std::string event;
  base::Value payload;
};

class HostMessageHandler {
 public:
  bool Authorized() { return authorized; }
  void SendEvent(std::string_view module, std::string_view event, const base::Value& payload) {
    events.push_back({std::string(module), std::string(event), payload});
    if (on_event) {
      auto hook = on_event;
      hook();
    }
  }
  base::WeakPtr<HostMessageHandler> GetWeakPtr() { return weak.GetWeakPtr(); }
  bool authorized = true;
  std::vector<SentEvent> events;
  std::function<void()> on_event;
  base::WeakPtrFactory<HostMessageHandler> weak{this};
};

namespace ardiacore {
struct FakePage;
struct LinuxPageRequest {
  std::weak_ptr<FakePage> page;
  uint64_t epoch = 0;
};
struct FakePage : std::enable_shared_from_this<FakePage> {
  FakePage(HostMessageHandler* owner, int tab, std::string lease) : handler(owner), id(tab), claim(std::move(lease)) {}
  HostMessageHandler* handler;
  int id;
  std::string claim;
  uint64_t epoch = 1;
  bool provisional = false;
  std::optional<LinuxPageRequest> Capture() {
    if (provisional) return std::nullopt;
    return LinuxPageRequest{weak_from_this(), epoch};
  }
};
inline bool EmitLinuxPageEvent(const LinuxPageRequest& request, std::string name, base::Value data) {
  auto page = request.page.lock();
  if (!page || !page->handler || page->provisional || page->epoch != request.epoch) return false;
  page->handler->SendEvent("ArdiaWebView", std::to_string(page->id), base::Value(base::DictValue()
      .Set("type", "pageEvent").Set("claim", page->claim)
      .Set("event", base::DictValue().Set("name", std::move(name)).Set("data", std::move(data)))));
  return true;
}
}

inline std::map<content::WebContents*, int> tab_ids;
inline int TabId(content::WebContents* contents) { return tab_ids.contains(contents) ? tab_ids.at(contents) : 0; }

struct Arguments_ {
  int id;
  std::string claim;
  std::string command;
  base::ListValue args;
};
inline std::map<const base::DictValue*, Arguments_> request_table;
inline std::string String(const base::DictValue& args, const char* key) {
  const auto& request = request_table.at(&args);
  return std::string_view(key) == "claim" ? request.claim : request.command;
}
inline const base::ListValue& Arguments(const base::DictValue& args) { return request_table.at(&args).args; }

class TabBinding {
 public:
  explicit TabBinding(content::WebContents* contents) : contents_(contents) {}
  content::WebContents* contents() const { return contents_; }
  void ResetPageCommands();
  ardiacore::FakePage* page() const { return page_.get(); }
  std::shared_ptr<ardiacore::FakePage> page_;
  std::optional<ardiacore::LinuxPageRequest> page_command_request;
  std::unique_ptr<ardiacore::LinuxPageCommands> page_commands;
  std::string claim;
  uint64_t renderer_generation = 0;
  content::WebContents* contents_;
};

ARDIA_RESET_PAGE_COMMANDS

class ShellHostView {
 public:
  ShellHostView(Profile* profile, BrowserWindowInterface* browser) : profile_(profile), browser_(browser) {}
ARDIA_AUTHORITY
  static TabBinding* PageCommandBinding(const PageCommandAuthority& authority);
  static void EmitPageCommandEvent(const PageCommandAuthority& authority, base::DictValue event);
  ardiacore::LinuxPageCommands* EnsurePageCommands(TabBinding* binding);
  void PageCommand(TabBinding* binding, const std::string& command, const base::ListValue& values,
                   base::OnceCallback<void(bool, base::Value)> done);
  void AdoptDevTools(TabBinding* binding);
  void TabCommand(const base::DictValue& args, base::OnceCallback<void(bool, base::Value)> done);
  void PresentDevTools(content::WebContents* inspected) { presentations.push_back(inspected); }
  bool is_utility() const { return utility; }
  BrowserWindowInterface* browser() const { return browser_; }
  Profile* profile() const { return profile_; }
  Profile* page_profile() const { return profile_; }
  content::WebContents* shell() { return &shell_contents; }
  bool OwnsHandler(HostMessageHandler* handler, uint64_t generation) const {
    return handler && handler == handler_ && generation == renderer_generation_;
  }
  TabBinding* Binding(int id) { return bindings_.contains(id) ? bindings_.at(id).get() : nullptr; }
  TabBinding* ClaimedBinding(const base::DictValue& args) {
    const auto& request = request_table.at(&args);
    auto* binding = Binding(request.id);
    return handler_ && binding && binding->contents() && binding->renderer_generation == renderer_generation_ &&
           !binding->claim.empty() && binding->claim == request.claim ? binding : nullptr;
  }
  base::WeakPtr<ShellHostView> GetWeakPtr() { return weak.GetWeakPtr(); }
  void CommitRenderer(HostMessageHandler* handler) {
    for (auto& [id, binding] : bindings_) {
      binding->page_.reset();
      binding->ResetPageCommands();
    }
    handler_ = handler;
    ++renderer_generation_;
    document_alive_ = std::make_shared<bool>(true);
    renderer_document_ = content::WeakDocumentPtr(shell()->GetPrimaryMainFrame(), document_alive_);
    for (auto& [id, binding] : bindings_) binding->claim.clear();
  }
  TabBinding* Bind(int id, content::WebContents* contents, std::string claim) {
    tab_ids[contents] = id;
    auto& binding = bindings_[id];
    if (!binding) binding = std::make_unique<TabBinding>(contents);
    binding->page_.reset();
    binding->ResetPageCommands();
    binding->claim = std::move(claim);
    binding->renderer_generation = renderer_generation_;
    binding->page_ = std::make_shared<ardiacore::FakePage>(handler_, id, binding->claim);
    return binding.get();
  }
  Profile* profile_;
  BrowserWindowInterface* browser_;
  content::WebContents shell_contents{profile_};
  HostMessageHandler* handler_ = nullptr;
  uint64_t renderer_generation_ = 0;
  std::shared_ptr<bool> document_alive_;
  content::WeakDocumentPtr renderer_document_;
  std::map<int, std::unique_ptr<TabBinding>> bindings_;
  std::vector<content::WebContents*> presentations;
  bool utility = false;
  base::WeakPtrFactory<ShellHostView> weak{this};
};

ARDIA_HOST_METHODS
