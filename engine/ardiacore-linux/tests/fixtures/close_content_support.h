#pragma once
namespace content {
inline WebContents::WebContents() : environment(std::make_unique<AckEnvironment>()) {
  auto& env = *environment;
  env.manager.delegate_ = &env.delegate;
  env.manager.render_frame_host_ = &frame;
  env.manager.frame_tree_node_ = &env.node;
  env.node.manager = &env.manager;
  env.owner.manager = &env.manager;
  env.delegate.contents = this;
  frame.contents = this;
  frame.owner_ = &env.owner;
  frame.frame_tree_node_ = &env.node;
  frame.frame_tree_ = &env.tree;
  frame.delegate_ = &env.delegate;
}
inline WebContents::~WebContents() = default;
inline BeforeUnloadReply WebContents::TakeAck(size_t index) {
  auto& replies = frame.local_frame.replies;
  assert(index < replies.size());
  auto reply = std::move(replies.at(index));
  replies.erase(replies.begin() + index);
  return reply;
}
inline bool WebContents::Ack(bool proceed, size_t index) {
  environment->delegate.last_fire = false;
  auto reply = TakeAck(index);
  std::move(reply).Run(proceed, {}, {}, {}, {});
  return environment->delegate.last_fire;
}
inline void WebContents::ReplaceDocument() {
  frame.document.InvalidateWeakPtrs();
  frame.is_waiting_for_beforeunload_completion_ = false;
  frame.beforeunload_pending_replies_.clear();
}
inline void AckDelegate::BeforeUnloadFiredFromRenderManager(bool proceed, bool* fire) {
  *fire = false;
  for (auto* browser : browsers) {
    if (browser->tabs.GetIndexOfWebContents(contents) != TabStripModel::kNoTab) {
      *fire = browser->controller->BeforeUnloadFired(contents, proceed);
      break;
    }
  }
  last_fire = *fire;
}
inline void RenderFrameHostImpl::ClosePage(ClosePageSource) { contents->ClosePage(); }
inline bool RenderFrameHostImpl::ShouldDispatchBeforeUnload(bool) { return contents->needs_unload; }
inline bool RenderFrameHostImpl::CheckOrDispatchBeforeUnloadForSubtree(bool, bool, bool is_reload) {
  beforeunload_pending_replies_.insert(GetGlobalId());
  SendBeforeUnload(is_reload, false, GetWeakPtr());
  return true;
}
}
