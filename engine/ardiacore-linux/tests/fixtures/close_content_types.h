#pragma once
#define TRACE_EVENT(...)
#define CHECK_NE(a, b) assert((a) != (b))
namespace base {
struct TimeDelta {
  int value = 0;
  bool is_zero() const { return value == 0; }
  TimeDelta operator-(TimeDelta other) const { return {value - other.value}; }
};
struct TimeTicks {
  int value = 0;
  static TimeTicks Now() { return {1}; }
  static bool IsConsistentAcrossProcesses() { return true; }
  bool is_null() const { return !value; }
  TimeDelta operator-(TimeTicks other) const { return {value - other.value}; }
  TimeTicks operator-(TimeDelta other) const { return {value - other.value}; }
};
inline void UmaHistogramTimes(const char*, TimeDelta) {}
}
#define DCHECK_NE(a, b) assert((a) != (b))
namespace blink {
namespace mojom {
enum class SuddenTerminationDisablerType { kBeforeUnloadHandler, kPageHideHandler, kUnloadHandler, kVisibilityChangeHandler };
}

struct RemoteTimeTicks {
  base::TimeTicks time;
  static RemoteTimeTicks FromTimeTicks(base::TimeTicks value) { return {value}; }
};
struct LocalTimeTicks {
  base::TimeTicks time;
  static LocalTimeTicks FromTimeTicks(base::TimeTicks value) { return {value}; }
  base::TimeTicks ToTimeTicks() const { return time; }
};
struct InterProcessTimeTicksConverter {
  InterProcessTimeTicksConverter(LocalTimeTicks, LocalTimeTicks, RemoteTimeTicks, RemoteTimeTicks) {}
  LocalTimeTicks ToLocalTimeTicks(RemoteTimeTicks value) { return {value.time}; }
};
}
namespace content {
namespace bad_message {
inline constexpr int RFH_BEFOREUNLOAD_HANDLER_NOT_ALLOWED_IN_FENCED_FRAME = 1;
inline constexpr int RFH_UNLOAD_HANDLER_NOT_ALLOWED_IN_FENCED_FRAME = 2;
inline void ReceivedBadMessage(int, int) { assert(false); }
}
class WebContents;
class RenderFrameHostImpl;
using RenderFrameHost = RenderFrameHostImpl;
class RenderFrameHostManager;
using GlobalRenderFrameHostId = int;
enum class BeforeUnloadExecutionMode { kSync, kAsync, kForLegacy, kNotBlocked };
enum class NavigationDiscardReason { kWillRemoveFrame };
struct WeakDocumentPtr {
  base::WeakPtr<RenderFrameHost> frame;
  RenderFrameHost* AsRenderFrameHostIfValid() const { return frame.get(); }
};
struct RenderViewHost {};
enum class BrowserTaskType { kBeforeUnloadBrowserResponse };
inline auto GetUIThreadTaskRunner(std::initializer_list<BrowserTaskType>) { return base::SingleThreadTaskRunner::GetCurrentDefault(); }
namespace features {
enum class AvoidUnnecessaryBeforeUnloadCheckSyncMode { kWithSendBeforeUnload };
}
inline bool IsAvoidUnnecessaryBeforeUnloadCheckSyncEnabledFor(features::AvoidUnnecessaryBeforeUnloadCheckSyncMode) { return false; }
struct FakeContentBrowserClient { bool SupportsAvoidUnnecessaryBeforeUnloadCheckSync() { return false; } };
struct FakeContentClient { FakeContentBrowserClient* browser() { static FakeContentBrowserClient client; return &client; } };
inline FakeContentClient* GetContentClient() { static FakeContentClient client; return &client; }
struct NavigationHandle {
  bool HasCommitted() { return true; }
  bool IsInPrimaryMainFrame() { return true; }
  bool IsSameDocument() { return false; }
};
struct NavigationRequest {
  base::WeakPtrFactory<NavigationRequest> weak{this};
  base::WeakPtr<NavigationRequest> GetWeakPtr() { return weak.GetWeakPtr(); }
  void MaybeResumeAsyncBeforeUnloadCommit(int) {}
  void set_beforeunload_phase2_dialog_opened_time(base::TimeTicks) {}
  void set_beforeunload_phase2_dialog_closed_time(base::TimeTicks) {}
  void set_before_unload_execution_mode(BeforeUnloadExecutionMode) {}
};
struct FrameTreeNode;
struct FakeNavigator {
  void BeforeUnloadCompleted(FrameTreeNode*, bool, base::TimeTicks, bool, bool) {}
  void LogBeforeUnloadTime(base::TimeTicks, base::TimeTicks, base::TimeTicks, bool) {}
};
struct FrameTreeNode {
  RenderFrameHostManager* manager = nullptr;
  FakeNavigator nav;
  NavigationRequest* navigation_request() { return nullptr; }
  FakeNavigator& navigator() { return nav; }
  RenderFrameHostManager* render_manager() { return manager; }
  bool parent() { return false; }
};
struct FakeFrameTree { void DidCancelLoading() {} };
struct FakeFrameOwner {
  RenderFrameHostManager* manager = nullptr;
  void CancelNavigation(NavigationDiscardReason) {}
  RenderFrameHostManager& GetRenderFrameHostManager() { return *manager; }
};
struct AckDelegate {
  WebContents* contents = nullptr;
  bool last_fire = false;
  bool IsJavaScriptDialogShowing() { return false; }
  void BeforeUnloadFiredFromRenderManager(bool, bool*);
};
using BeforeUnloadReply = base::OnceCallback<void(bool, base::TimeTicks, base::TimeTicks, base::TimeTicks, base::TimeTicks)>;
struct FakeLocalFrame {
  std::vector<BeforeUnloadReply> replies;
  void BeforeUnload(bool, bool, BeforeUnloadReply callback) { replies.push_back(std::move(callback)); }
};
struct FakeUnloadTimer {
  void Stop() {}
  void Start(int) {}
};
struct UrgentScope { ~UrgentScope() {} };
class RenderFrameHostImpl {
 public:
  enum class BeforeUnloadType { BROWSER_INITIATED_NAVIGATION, RENDERER_INITIATED_NAVIGATION, TAB_CLOSE, DISCARD, INNER_DELEGATE_ATTACH };
  enum class ClosePageSource { kBrowser };
  base::WeakPtrFactory<RenderFrameHost> document{this};
  base::WeakPtrFactory<RenderFrameHostImpl> weak_ptr_factory_{this};
  WeakDocumentPtr GetWeakDocumentPtr() { return {document.GetWeakPtr()}; }
  base::WeakPtr<RenderFrameHostImpl> GetWeakPtr() { return weak_ptr_factory_.GetWeakPtr(); }
  bool live = true;
  RenderViewHost view;
  RenderViewHost* GetRenderViewHost() { return live ? &view : nullptr; }
  uint64_t linux_before_unload_revision_ = 0;
  bool has_before_unload_handler_ = false;
  bool has_pagehide_handler_ = false;
  bool has_unload_handler_ = false;
  bool has_visibilitychange_handler_ = false;
  bool IsNestedWithinFencedFrame() { return false; }
  int GetProcess() { return 0; }
  void SuddenTerminationDisablerChanged(bool, blink::mojom::SuddenTerminationDisablerType);
  RenderFrameHostImpl* parent = nullptr;
  int id = 1;
  std::vector<RenderFrameHostImpl*> children;
  template <class F> void ForEachRenderFrameHostImpl(F callback) {
    callback(this);
    for (auto* child : children) child->ForEachRenderFrameHostImpl(callback);
  }
  void StartLinuxBeforeUnloadDispatch();
  void CompleteLinuxBeforeUnloadDispatch(std::shared_ptr<ardia::LinuxCloseDispatch>, bool);
  void ProcessLinuxBeforeUnloadCompleted(std::shared_ptr<ardia::LinuxCloseDispatch>, bool, bool, base::TimeTicks, base::TimeTicks, BeforeUnloadExecutionMode);
  void DispatchBeforeUnload(BeforeUnloadType, bool);
  void ProcessBeforeUnloadCompleted(bool, bool, const base::TimeTicks&, const base::TimeTicks&, BeforeUnloadExecutionMode, std::shared_ptr<ardia::LinuxCloseDispatch>);
  void ProcessBeforeUnloadCompletedFromFrame(bool, bool, RenderFrameHostImpl*, bool, const base::TimeTicks&, const base::TimeTicks&, BeforeUnloadExecutionMode, std::shared_ptr<ardia::LinuxCloseDispatch>);
  void SimulateBeforeUnloadCompleted(bool);
  void SendBeforeUnload(bool, bool, base::WeakPtr<RenderFrameHostImpl>);
  void ContinueNavigationAfterBeforeUnloadCheck(BeforeUnloadExecutionMode);
  bool ShouldDispatchBeforeUnload(bool);
  bool CheckOrDispatchBeforeUnloadForSubtree(bool, bool, bool);
  RenderFrameHostImpl* GetBeforeUnloadInitiator() { return is_waiting_for_beforeunload_completion_ ? this : (parent ? parent->GetBeforeUnloadInitiator() : nullptr); }
  FrameTreeNode* frame_tree_node() { return frame_tree_node_; }
  bool IsOutermostMainFrame() { return true; }
  int GetGlobalId() { return id; }
  UrgentScope MakeUrgentMessageScopeIfNeeded() { return {}; }
  FakeLocalFrame* GetAssociatedLocalFrame() { return &local_frame; }
  void ClosePage(ClosePageSource);
  WebContents* contents = nullptr;
  FakeFrameOwner* owner_ = nullptr;
  FrameTreeNode* frame_tree_node_ = nullptr;
  FakeFrameTree* frame_tree_ = nullptr;
  AckDelegate* delegate_ = nullptr;
  FakeLocalFrame local_frame;
  std::shared_ptr<ardia::LinuxCloseDispatch> linux_before_unload_request_;
  bool is_waiting_for_beforeunload_completion_ = false;
  bool beforeunload_dialog_request_cancels_unload_ = false;
  bool unload_ack_is_for_navigation_ = false;
  bool has_shown_beforeunload_dialog_ = false;
  base::TimeTicks send_before_unload_start_time_;
  std::unique_ptr<FakeUnloadTimer> beforeunload_timeout_;
  int beforeunload_timeout_delay_ = 0;
  std::set<int> beforeunload_pending_replies_;
  base::OnceClosure on_process_before_unload_completed_for_testing_;
};
struct AckEnvironment;
class WebContents {
 public:
  WebContents();
  ~WebContents();
  base::WeakPtr<WebContents> GetWeakPtr() { return weak.GetWeakPtr(); }
  bool Ack(bool proceed, size_t index = 0);
  BeforeUnloadReply TakeAck(size_t index = 0);
  void ReplaceDocument();
  bool needs_unload = false;
  int dispatches = 0;
  int close_pages = 0;
  RenderFrameHost frame;
  std::unique_ptr<AckEnvironment> environment;
  base::WeakPtrFactory<WebContents> weak{this};
  void DispatchBeforeUnload(bool) { ++dispatches; frame.DispatchBeforeUnload(RenderFrameHostImpl::BeforeUnloadType::TAB_CLOSE, false); }
  void ClosePage() { close_events.push_back("close-page"); needs_unload = false; ++close_pages; }
  RenderFrameHost* GetPrimaryMainFrame() { return &frame; }
  bool NeedToFireBeforeUnloadOrUnloadEvents() { return needs_unload; }
  void SetClosedByUserGesture(bool) {}
};
class RenderFrameHostManager {
 public:
  void BeforeUnloadCompleted(bool, std::shared_ptr<ardia::LinuxCloseDispatch> = nullptr);
  bool is_attaching_inner_delegate() { return false; }
  void CreateNewFrameForInnerDelegateAttachIfNecessary() {}
  void NotifyPrepareForInnerDelegateAttachComplete(bool) {}
  void DiscardSpeculativeRFH(NavigationDiscardReason) {}
  base::WeakPtr<RenderFrameHostManager> GetWeakPtr() { return weak.GetWeakPtr(); }
  AckDelegate* delegate_ = nullptr;
  RenderFrameHostImpl* render_frame_host_ = nullptr;
  bool speculative_render_frame_host_ = false;
  FrameTreeNode* frame_tree_node_ = nullptr;
  base::WeakPtrFactory<RenderFrameHostManager> weak{this};
};
struct AckEnvironment {
  RenderFrameHostManager manager;
  FrameTreeNode node;
  FakeFrameTree tree;
  FakeFrameOwner owner;
  AckDelegate delegate;
};
}
