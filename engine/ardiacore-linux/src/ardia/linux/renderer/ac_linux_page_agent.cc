#include "ardia/linux/renderer/ac_linux_page_agent.h"

#include <map>
#include <string>
#include <tuple>

#include "ardia/linux/ac_linux_page_messages.h"
#include "ardia/linux/mojom/page.mojom.h"
#include "ardia/linux/page_script.h"
#include "base/functional/bind.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "base/no_destructor.h"
#include "chrome/common/chrome_isolated_world_ids.h"
#include "content/public/renderer/render_frame.h"
#include "content/public/renderer/render_frame_observer.h"
#include "gin/arguments.h"
#include "gin/converter.h"
#include "gin/function_template.h"
#include "mojo/public/cpp/bindings/associated_receiver_set.h"
#include "mojo/public/cpp/bindings/associated_remote.h"
#include "third_party/blink/public/common/associated_interfaces/associated_interface_provider.h"
#include "third_party/blink/public/common/associated_interfaces/associated_interface_registry.h"
#include "third_party/blink/public/platform/scheduler/web_agent_group_scheduler.h"
#include "third_party/blink/public/platform/web_isolated_world_info.h"
#include "third_party/blink/public/platform/web_security_origin.h"
#include "third_party/blink/public/platform/web_string.h"
#include "third_party/blink/public/platform/web_url.h"
#include "third_party/blink/public/web/web_document.h"
#include "third_party/blink/public/web/web_local_frame.h"
#include "third_party/blink/public/web/web_script_source.h"
#include "url/gurl.h"
#include "url/origin.h"
#include "v8/include/v8-context.h"
#include "v8/include/v8-function.h"
#include "v8/include/v8-exception.h"
#include "v8/include/v8-json.h"
#include "v8/include/v8-object.h"
#include "v8/include/v8-isolate.h"
#include "v8/include/v8-local-handle.h"
#include "v8/include/v8-persistent-handle.h"
#include "v8/include/v8-primitive.h"

namespace ardia {

namespace {

constexpr char kArdiaPageWorldPolicy[] = "script-src 'none'; object-src 'none'";

void ConfigureArdiaPageWorld() {
  static bool configured = false;
  if (configured) return;
  configured = true;
  blink::WebIsolatedWorldInfo info;
  info.security_origin = blink::WebSecurityOrigin(url::Origin());
  info.content_security_policy = blink::WebString::FromUtf8(kArdiaPageWorldPolicy);
  info.human_readable_name = blink::WebString::FromUtf8("Ardia");
  blink::SetIsolatedWorldInfo(ISOLATED_WORLD_ID_ARDIA_PAGE, info);
}

bool FitsUtf8(v8::Isolate* isolate, v8::Local<v8::String> text, size_t limit) {
  return static_cast<size_t>(text->Length()) <= limit && text->Utf8Length(isolate) <= limit;
}

class LinuxPageAgent : public content::RenderFrameObserver,
                       public linux_page::mojom::PageAgent {
 public:
  explicit LinuxPageAgent(content::RenderFrame* frame)
      : content::RenderFrameObserver(frame), registered_frame_(frame) {
    Agents()[frame] = this;
    frame->GetAssociatedInterfaceRegistry()->AddInterface<linux_page::mojom::PageAgent>(
        base::BindRepeating(&LinuxPageAgent::Bind, weak_factory_.GetWeakPtr()));
  }

  ~LinuxPageAgent() override { Agents().erase(registered_frame_); }

  static LinuxPageAgent* For(content::RenderFrame* frame) {
    auto it = Agents().find(frame);
    return it == Agents().end() ? nullptr : it->second;
  }

  void OnDestruct() override { delete this; }

  void DidCommitProvisionalLoad(ui::PageTransition) override { Forget(); }

  void WillReleaseScriptContext(v8::Local<v8::Context>, int32_t world_id) override {
    if (world_id == ISOLATED_WORLD_ID_ARDIA_PAGE || world_id == 0) Forget();
  }

  void RunAtDocumentStart() {
    const GURL url = render_frame()->GetWebFrame()->GetDocument().Url();
    if (!url.SchemeIsHTTPOrHTTPS() && !url.SchemeIsFile()) return;
    Install();
  }

  void Call(const std::string& kind, const std::string& json) override {
    if (receive_.IsEmpty() || !ardiacore::LinuxPageMessageEnvelopeFits(kind, json)) return;
    blink::WebLocalFrame* frame = render_frame()->GetWebFrame();
    v8::Isolate* isolate = frame->GetAgentGroupScheduler()->Isolate();
    v8::HandleScope handle_scope(isolate);
    v8::Local<v8::Context> context = context_.Get(isolate);
    if (context.IsEmpty() || frame->GetScriptContextFromWorldId(isolate, ISOLATED_WORLD_ID_ARDIA_PAGE) != context) {
      Forget();
      return;
    }
    v8::Context::Scope context_scope(context);
    v8::Local<v8::Value> args[] = {gin::StringToV8(isolate, kind), gin::StringToV8(isolate, json)};
    std::ignore = frame->CallFunctionEvenIfScriptDisabled(receive_.Get(isolate), v8::Undefined(isolate), 2, args);
  }

 private:
  static std::map<content::RenderFrame*, LinuxPageAgent*>& Agents() {
    static base::NoDestructor<std::map<content::RenderFrame*, LinuxPageAgent*>> agents;
    return *agents;
  }

  void Bind(mojo::PendingAssociatedReceiver<linux_page::mojom::PageAgent> receiver) {
    receivers_.Add(this, std::move(receiver));
  }

  void Forget() {
    receive_.Reset();
    context_.Reset();
    post_weak_factory_.InvalidateWeakPtrs();
  }

  void Install() {
    Forget();
    ConfigureArdiaPageWorld();
    blink::WebLocalFrame* frame = render_frame()->GetWebFrame();
    v8::Isolate* isolate = frame->GetAgentGroupScheduler()->Isolate();
    v8::HandleScope handle_scope(isolate);
    base::WeakPtr<LinuxPageAgent> alive = weak_factory_.GetWeakPtr();
    v8::Local<v8::Value> install = frame->ExecuteScriptInIsolatedWorldAndReturnValue(
        ISOLATED_WORLD_ID_ARDIA_PAGE,
        blink::WebScriptSource(blink::WebString::FromUtf8(kArdiaLinuxPageScript), blink::WebURL(GURL("ardia://page-script"))),
        blink::BackForwardCacheAware::kAllow);
    if (!alive || install.IsEmpty() || !install->IsFunction()) return;
    v8::Local<v8::Context> context = frame->GetScriptContextFromWorldId(isolate, ISOLATED_WORLD_ID_ARDIA_PAGE);
    if (context.IsEmpty()) return;
    v8::Context::Scope context_scope(context);
    v8::Local<v8::Value> post = gin::CreateFunctionTemplate(
        isolate, base::BindRepeating(&LinuxPageAgent::Post, post_weak_factory_.GetWeakPtr()))
        ->GetFunction(context).ToLocalChecked();
    v8::Local<v8::Value> receive;
    const bool ran = frame->CallFunctionEvenIfScriptDisabled(install.As<v8::Function>(), v8::Undefined(isolate), 1, &post)
                         .ToLocal(&receive);
    if (!alive || !ran || !receive->IsFunction() ||
        frame->GetScriptContextFromWorldId(isolate, ISOLATED_WORLD_ID_ARDIA_PAGE) != context) {
      return;
    }
    receive_.Reset(isolate, receive.As<v8::Function>());
    context_.Reset(isolate, context);
  }

  void Post(gin::Arguments* args) {
    v8::Isolate* isolate = args->isolate();
    v8::Local<v8::Value> kind_value;
    if (!args->GetNext(&kind_value) || !kind_value->IsString() ||
        !FitsUtf8(isolate, kind_value.As<v8::String>(), ardiacore::kLinuxPageMessageKindMax)) {
      return;
    }
    const std::string kind = gin::V8ToString(isolate, kind_value);
    std::string json = "null";
    v8::Local<v8::Value> value;
    if (args->GetNext(&value) && value->IsString() && kind == "nowPlaying") {
      if (!FitsUtf8(isolate, value.As<v8::String>(), ardiacore::kLinuxNowPlayingBytesMax)) return;
      json = NowPlayingReport(isolate, value.As<v8::String>());
    } else if (!value.IsEmpty() && value->IsString()) {
      if (!FitsUtf8(isolate, value.As<v8::String>(), ardiacore::kLinuxPageMessageBytesMax)) return;
      json = gin::V8ToString(isolate, value);
    }
    if (!ardiacore::LinuxPageMessageKindOf(kind)) return;
    if (!host_.is_bound()) render_frame()->GetRemoteAssociatedInterfaces()->GetInterface(&host_);
    host_->Post(kind, json);
  }

  static std::string NowPlayingReport(v8::Isolate* isolate, v8::Local<v8::String> json) {
    v8::TryCatch try_catch(isolate);
    v8::Local<v8::Context> context = isolate->GetCurrentContext();
    v8::Local<v8::Value> parsed;
    if (context.IsEmpty() || !v8::JSON::Parse(context, json).ToLocal(&parsed) || !parsed->IsObject())
      return ardiacore::LinuxNowPlayingReport(false, false, "");
    v8::Local<v8::Object> state = parsed.As<v8::Object>();
    v8::Local<v8::Value> has_video;
    v8::Local<v8::Value> playback_state;
    const bool video = state->Get(context, gin::StringToV8(isolate, "hasVideo")).ToLocal(&has_video) && has_video->IsTrue();
    std::string playback;
    if (state->Get(context, gin::StringToV8(isolate, "playbackState")).ToLocal(&playback_state) &&
        playback_state->IsString() && playback_state.As<v8::String>()->Length() <= 8) {
      playback = gin::V8ToString(isolate, playback_state);
    }
    return ardiacore::LinuxNowPlayingReport(true, video, playback);
  }

  mojo::AssociatedReceiverSet<linux_page::mojom::PageAgent> receivers_;
  mojo::AssociatedRemote<linux_page::mojom::PageHost> host_;
  v8::Global<v8::Function> receive_;
  v8::Global<v8::Context> context_;
  raw_ptr<content::RenderFrame> registered_frame_;
  base::WeakPtrFactory<LinuxPageAgent> post_weak_factory_{this};
  base::WeakPtrFactory<LinuxPageAgent> weak_factory_{this};
};

}

void CreateLinuxPageAgent(content::RenderFrame* frame) {
  new LinuxPageAgent(frame);
}

void RunLinuxPageAgentAtDocumentStart(content::RenderFrame* frame) {
  if (LinuxPageAgent* agent = LinuxPageAgent::For(frame)) agent->RunAtDocumentStart();
}

}
