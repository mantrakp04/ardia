#include "ardia/core/renderer/ac_content_renderer_client.h"

#include <algorithm>
#include <map>
#include <optional>
#include <string>
#include <tuple>
#include <utility>

#include "base/containers/span.h"
#include "base/functional/bind.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "base/no_destructor.h"
#include "base/values.h"
#include "chrome/common/chrome_isolated_world_ids.h"
#include "content/public/common/isolated_world_ids.h"
#include "content/public/renderer/render_frame.h"
#include "content/public/renderer/render_frame_observer.h"
#include "content/public/renderer/render_thread.h"
#include "content/public/renderer/render_thread_observer.h"
#include "gin/arguments.h"
#include "gin/converter.h"
#include "gin/function_template.h"
#include "mojo/public/cpp/bindings/associated_receiver.h"
#include "mojo/public/cpp/bindings/associated_receiver_set.h"
#include "mojo/public/cpp/bindings/associated_remote.h"
#include "ardia/core/ac_page_limits.h"
#include "ardia/core/mojom/ardiacore.mojom.h"
#include "third_party/blink/public/common/associated_interfaces/associated_interface_provider.h"
#include "third_party/blink/public/common/associated_interfaces/associated_interface_registry.h"
#include "third_party/blink/public/platform/scheduler/web_agent_group_scheduler.h"
#include "third_party/blink/public/platform/web_string.h"
#include "third_party/blink/public/platform/web_url.h"
#include "third_party/blink/public/web/web_document.h"
#include "third_party/blink/public/web/web_document_loader.h"
#include "third_party/blink/public/web/web_local_frame.h"
#include "third_party/blink/public/mojom/frame/user_activation_notification_type.mojom.h"
#include "third_party/blink/public/mojom/script/script_evaluation_params.mojom.h"
#include "third_party/blink/public/web/web_script_execution_callback.h"
#include "third_party/blink/public/web/web_script_source.h"
#include "url/gurl.h"
#include "v8/include/v8-context.h"
#include "v8/include/v8-function.h"
#include "v8/include/v8-isolate.h"
#include "v8/include/v8-local-handle.h"
#include "v8/include/v8-persistent-handle.h"
#include "v8/include/v8-primitive.h"

namespace ardiacore {

namespace {

std::string& PageScript() {
  static base::NoDestructor<std::string> script;
  return *script;
}

constexpr char kPictureInPictureCandidates[] =
    "const videos = [...document.querySelectorAll('video')].filter((v) => "
    "v.readyState > 0 && !v.disablePictureInPicture && v.clientWidth * "
    "v.clientHeight > 0);";

constexpr char kHasPictureInPictureCandidateScript[] =
    "return videos.length > 0;";

constexpr char kPictureInPictureForUserScript[] =
    "videos.sort((a, b) => (b.paused ? 0 : 1) - (a.paused ? 0 : 1) || "
    "b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight);"
    "if (!videos.length) return false;"
    "if (document.pictureInPictureElement === videos[0]) return true;"
    "return videos[0].requestPictureInPicture().then(() => true, () => false);";

std::string PictureInPictureScript(const char* body) {
  return std::string("(() => {") + kPictureInPictureCandidates + body + "})()";
}

bool FitsUtf8(v8::Isolate* isolate, v8::Local<v8::String> text, size_t limit) {
  return static_cast<size_t>(text->Length()) <= limit &&
         text->Utf8Length(isolate) <= limit;
}

blink::WebScriptSource Source(const std::string& code, const char* url) {
  return blink::WebScriptSource(blink::WebString::FromUtf8(code),
                                blink::WebURL(GURL(url)));
}

class ACPageObserver : public content::RenderFrameObserver,
                       public mojom::ACPage {
 public:
  explicit ACPageObserver(content::RenderFrame* frame)
      : content::RenderFrameObserver(frame), registered_frame_(frame) {
    Observers()[frame] = this;
    frame->GetAssociatedInterfaceRegistry()->AddInterface<mojom::ACPage>(
        base::BindRepeating(&ACPageObserver::BindPage,
                            weak_factory_.GetWeakPtr()));
  }

  ~ACPageObserver() override {
    Observers().erase(registered_frame_);
    AnswerAll();
  }

  void OnDestruct() override { delete this; }

  void DidCreateScriptContext(v8::Local<v8::Context> context,
                              int32_t world_id) override {
    if (world_id != content::ISOLATED_WORLD_ID_GLOBAL) {
      return;
    }
    if (!page_color_.empty() && IsMainErrorDocument()) {
      render_frame()->GetWebFrame()->ExecuteScript(
          Source(PageColorScript(), "ardia://page-color"));
    }
    InstallPageScript(context);
  }

  static ACPageObserver* For(content::RenderFrame* frame) {
    auto it = Observers().find(frame);
    return it == Observers().end() ? nullptr : it->second;
  }

  void RunAtDocumentStart() {
    if (installed_for_web_ || !IsWebDocument()) {
      return;
    }
    blink::WebLocalFrame* frame = render_frame()->GetWebFrame();
    v8::Isolate* isolate = frame->GetAgentGroupScheduler()->Isolate();
    v8::HandleScope handle_scope(isolate);
    base::WeakPtr<ACPageObserver> alive = weak_factory_.GetWeakPtr();
    v8::Local<v8::Context> context = frame->MainWorldScriptContext();
    if (!alive || installed_for_web_ || context.IsEmpty()) {
      return;
    }
    InstallPageScript(context);
  }

  bool IsWebDocument() {
    const GURL url = render_frame()->GetWebFrame()->GetDocument().Url();
    return url.SchemeIsHTTPOrHTTPS() || url.SchemeIsFile();
  }

  void InstallPageScript(v8::Local<v8::Context> context) {
    if (PageScript().empty() || installing_ || installed_for_web_) {
      return;
    }
    installing_ = true;
    base::WeakPtr<ACPageObserver> alive = weak_factory_.GetWeakPtr();
    RunPageScript(context);
    if (alive) {
      installing_ = false;
    }
  }

  void RunPageScript(v8::Local<v8::Context> context) {
    blink::WebLocalFrame* frame = render_frame()->GetWebFrame();
    v8::Isolate* isolate = frame->GetAgentGroupScheduler()->Isolate();
    v8::HandleScope handle_scope(isolate);
    v8::Context::Scope context_scope(context);
    receive_.Reset();
    installed_for_web_ = IsWebDocument();
    base::WeakPtr<ACPageObserver> alive = weak_factory_.GetWeakPtr();
    v8::Local<v8::Value> install = frame->ExecuteScriptAndReturnValue(
        Source(PageScript(), "ardia://page-script"));
    if (!alive || install.IsEmpty() || !install->IsFunction()) {
      return;
    }
    v8::Local<v8::Value> post = PostFunction(isolate, context, std::nullopt);
    v8::Local<v8::Value> receive;
    const bool ran = frame
                         ->CallFunctionEvenIfScriptDisabled(
                             install.As<v8::Function>(), v8::Undefined(isolate),
                             1, &post)
                         .ToLocal(&receive);
    if (!alive || !ran || !receive->IsFunction() ||
        frame->MainWorldScriptContext() != context) {
      return;
    }
    receive_.Reset(isolate, receive.As<v8::Function>());
    receive_context_.Reset(isolate, context);
  }

  void WillReleaseScriptContext(v8::Local<v8::Context> context,
                                int32_t world_id) override {
    if (world_id != content::ISOLATED_WORLD_ID_GLOBAL) {
      return;
    }
    receive_.Reset();
    receive_context_.Reset();
    installed_for_web_ = false;
    AnswerAll();
  }

  void CallPage(const std::string& kind, const std::string& json) override {
    if (receive_.IsEmpty()) {
      return;
    }
    blink::WebLocalFrame* frame = render_frame()->GetWebFrame();
    v8::Isolate* isolate = frame->GetAgentGroupScheduler()->Isolate();
    v8::HandleScope handle_scope(isolate);
    v8::Local<v8::Context> context = receive_context_.Get(isolate);
    v8::Context::Scope context_scope(context);
    v8::Local<v8::Value> args[] = {gin::StringToV8(isolate, kind),
                                   gin::StringToV8(isolate, json)};
    std::ignore = frame->CallFunctionEvenIfScriptDisabled(
        receive_.Get(isolate), v8::Undefined(isolate), 2, args);
  }

  void Execute(const std::string& code) override {
    render_frame()->GetWebFrame()->ExecuteScript(
        Source(code, "ardia://execute"));
  }

  bool HasPictureInPictureCandidate(blink::WebLocalFrame* frame) {
    v8::HandleScope handle_scope(frame->GetAgentGroupScheduler()->Isolate());
    v8::Local<v8::Value> found = frame->ExecuteScriptInIsolatedWorldAndReturnValue(
        ISOLATED_WORLD_ID_CHROME_INTERNAL,
        Source(PictureInPictureScript(kHasPictureInPictureCandidateScript),
               "ardia://picture-in-picture-candidate"),
        blink::BackForwardCacheAware::kAllow);
    return !found.IsEmpty() && found->IsTrue();
  }

  void PictureInPictureDocument(
      PictureInPictureDocumentCallback callback) override {
    blink::WebLocalFrame* frame = render_frame()->GetWebFrame();
    base::WeakPtr<ACPageObserver> alive = weak_factory_.GetWeakPtr();
    const std::string document = frame->GetDocument().Token().ToString();
    if (!frame->IsOutermostMainFrame() || !HasPictureInPictureCandidate(frame) ||
        !alive || frame->GetDocument().Token().ToString() != document) {
      std::move(callback).Run(std::nullopt);
      return;
    }
    std::move(callback).Run(document);
  }

  void EnterPictureInPictureForUser(
      const std::string& document,
      EnterPictureInPictureForUserCallback callback) override {
    blink::WebLocalFrame* frame = render_frame()->GetWebFrame();
    base::WeakPtr<ACPageObserver> alive = weak_factory_.GetWeakPtr();
    if (!frame->IsOutermostMainFrame() ||
        frame->GetDocument().Token().ToString() != document ||
        !HasPictureInPictureCandidate(frame) || !alive ||
        frame->GetDocument().Token().ToString() != document) {
      std::move(callback).Run(false);
      return;
    }
    v8::HandleScope handle_scope(frame->GetAgentGroupScheduler()->Isolate());
    const std::string script =
        PictureInPictureScript(kPictureInPictureForUserScript);
    const blink::WebScriptSource source =
        Source(script, "ardia://picture-in-picture-for-user");
    frame->NotifyUserActivation(
        blink::mojom::UserActivationNotificationType::kInteraction);
    frame->RequestExecuteScript(
        ISOLATED_WORLD_ID_CHROME_INTERNAL, base::span_from_ref(source),
        blink::mojom::UserActivationOption::kDoNotActivate,
        blink::mojom::EvaluationTiming::kSynchronous,
        blink::mojom::LoadEventBlockingOption::kDoNotBlock,
        base::BindOnce(
            [](EnterPictureInPictureForUserCallback callback,
               std::optional<base::Value> result, base::TimeTicks) {
              std::move(callback).Run(result && result->is_bool() &&
                                      result->GetBool());
            },
            std::move(callback)),
        blink::BackForwardCacheAware::kAllow,
        blink::mojom::WantResultOption::kWantResult,
        blink::mojom::PromiseResultOption::kAwait, blink::WebString());
    if (alive) {
      frame->ConsumeTransientUserActivation();
    }
  }

  void Evaluate(const std::string& code, EvaluateCallback callback) override {
    blink::WebLocalFrame* frame = render_frame()->GetWebFrame();
    v8::Isolate* isolate = frame->GetAgentGroupScheduler()->Isolate();
    v8::HandleScope handle_scope(isolate);
    v8::Local<v8::Context> context = frame->MainWorldScriptContext();
    if (context.IsEmpty()) {
      std::move(callback).Run(std::nullopt);
      return;
    }
    v8::Context::Scope context_scope(context);
    v8::Local<v8::Value> fn = frame->ExecuteScriptAndReturnValue(
        Source("(function(post){'use strict';\n" + code + "\n})",
               "ardia://evaluate"));
    if (fn.IsEmpty() || !fn->IsFunction()) {
      std::move(callback).Run(std::nullopt);
      return;
    }
    const int id = ++last_evaluation_;
    evaluations_[id] = std::move(callback);
    v8::Local<v8::Value> post = PostFunction(isolate, context, id);
    v8::Local<v8::Value> result;
    base::WeakPtr<ACPageObserver> alive = weak_factory_.GetWeakPtr();
    const bool ran = frame
                         ->CallFunctionEvenIfScriptDisabled(
                             fn.As<v8::Function>(), v8::Undefined(isolate), 1,
                             &post)
                         .ToLocal(&result);
    if (alive && !ran) {
      Answer(id, std::nullopt);
    }
  }

  void SetPageColor(const std::string& color) override {
    const bool valid = color.size() <= 16 &&
                       std::all_of(color.begin(), color.end(), [](char c) {
                         return c >= 'a' && c <= 'z';
                       });
    const std::string next = valid ? color : std::string();
    if (next == page_color_) {
      return;
    }
    page_color_ = next;
    if (IsMainErrorDocument()) {
      render_frame()->GetWebFrame()->ExecuteScript(
          Source(PageColorScript(), "ardia://page-color"));
    }
  }

 private:
  static std::map<content::RenderFrame*, ACPageObserver*>& Observers() {
    static base::NoDestructor<std::map<content::RenderFrame*, ACPageObserver*>>
        observers;
    return *observers;
  }

  bool IsMainErrorDocument() {
    if (!render_frame()->IsMainFrame()) {
      return false;
    }
    blink::WebDocumentLoader* loader =
        render_frame()->GetWebFrame()->GetDocumentLoader();
    return loader && loader->HasUnreachableURL();
  }

  std::string PageColorScript() const {
    const std::string set =
        page_color_.empty()
            ? std::string("delete window.ardiaPageColor;")
            : "window.ardiaPageColor = \"" + page_color_ + "\";";
    return set + " window.dispatchEvent(new Event(\"ardiapagecolor\"));";
  }

  void BindPage(mojo::PendingAssociatedReceiver<mojom::ACPage> receiver) {
    page_receivers_.Add(this, std::move(receiver));
  }

  v8::Local<v8::Value> PostFunction(v8::Isolate* isolate,
                                    v8::Local<v8::Context> context,
                                    std::optional<int> evaluation) {
    return gin::CreateFunctionTemplate(
               isolate, base::BindRepeating(&ACPageObserver::Post,
                                            weak_factory_.GetWeakPtr(),
                                            evaluation))
        ->GetFunction(context)
        .ToLocalChecked();
  }

  void Post(std::optional<int> evaluation, gin::Arguments* args) {
    v8::Isolate* isolate = args->isolate();
    v8::Local<v8::Value> kind_value;
    if (!args->GetNext(&kind_value) || !kind_value->IsString() ||
        !FitsUtf8(isolate, kind_value.As<v8::String>(), kMaxPageMessageKind)) {
      return;
    }
    const std::string kind = gin::V8ToString(isolate, kind_value);
    const bool result = evaluation && kind == "result";
    const size_t limit =
        result ? kMaxEvaluationResultBytes : MaxPageMessageBytes(kind);
    std::string json = "null";
    v8::Local<v8::Value> value;
    if (args->GetNext(&value) && value->IsString()) {
      if (!FitsUtf8(isolate, value.As<v8::String>(), limit)) {
        if (result) {
          Answer(*evaluation, std::nullopt);
        }
        return;
      }
      json = gin::V8ToString(isolate, value);
    }
    if (result) {
      Answer(*evaluation, std::move(json));
      return;
    }
    if (!host_.is_bound()) {
      render_frame()->GetRemoteAssociatedInterfaces()->GetInterface(&host_);
    }
    host_->Post(kind, json);
  }

  void Answer(int id, std::optional<std::string> json) {
    auto it = evaluations_.find(id);
    if (it == evaluations_.end()) {
      return;
    }
    EvaluateCallback callback = std::move(it->second);
    evaluations_.erase(it);
    std::move(callback).Run(std::move(json));
  }

  void AnswerAll() {
    std::map<int, EvaluateCallback> pending = std::move(evaluations_);
    evaluations_.clear();
    for (auto& [id, callback] : pending) {
      std::move(callback).Run(std::nullopt);
    }
  }

  mojo::AssociatedReceiverSet<mojom::ACPage> page_receivers_;
  mojo::AssociatedRemote<mojom::ACPageHost> host_;
  v8::Global<v8::Function> receive_;
  v8::Global<v8::Context> receive_context_;
  std::map<int, EvaluateCallback> evaluations_;
  int last_evaluation_ = 0;
  std::string page_color_;
  bool installed_for_web_ = false;
  bool installing_ = false;
  raw_ptr<content::RenderFrame> registered_frame_;
  base::WeakPtrFactory<ACPageObserver> weak_factory_{this};
};

}

class ACRenderThreadObserver : public content::RenderThreadObserver,
                               public mojom::ACRendererConfig {
 public:
  void RegisterMojoInterfaces(
      blink::AssociatedInterfaceRegistry* associated_interfaces) override {
    associated_interfaces->AddInterface<mojom::ACRendererConfig>(
        base::BindRepeating(&ACRenderThreadObserver::Bind,
                            base::Unretained(this)));
  }
  void UnregisterMojoInterfaces(
      blink::AssociatedInterfaceRegistry* associated_interfaces) override {
    associated_interfaces->RemoveInterface(mojom::ACRendererConfig::Name_);
  }

  void SetPageScript(const std::string& script) override {
    PageScript() = script;
  }

 private:
  void Bind(mojo::PendingAssociatedReceiver<mojom::ACRendererConfig> receiver) {
    receivers_.Add(this, std::move(receiver));
  }

  mojo::AssociatedReceiverSet<mojom::ACRendererConfig> receivers_;
};

ACContentRendererClient::ACContentRendererClient() = default;
ACContentRendererClient::~ACContentRendererClient() = default;

void ACContentRendererClient::RenderThreadStarted() {
  ChromeContentRendererClient::RenderThreadStarted();
  observer_ = std::make_unique<ACRenderThreadObserver>();
  content::RenderThread::Get()->AddObserver(observer_.get());
}

void ACContentRendererClient::RenderFrameCreated(
    content::RenderFrame* render_frame) {
  ChromeContentRendererClient::RenderFrameCreated(render_frame);
  new ACPageObserver(render_frame);
}

void ACContentRendererClient::RunScriptsAtDocumentStart(
    content::RenderFrame* render_frame) {
  if (ACPageObserver* observer = ACPageObserver::For(render_frame)) {
    observer->RunAtDocumentStart();
  }
  ChromeContentRendererClient::RunScriptsAtDocumentStart(render_frame);
}

}
