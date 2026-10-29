import unittest

import test_renderer_contract as renderer


class CommittedRendererTests(unittest.TestCase):
    def run_case(self, mode):
        runner = renderer.RendererContractTests()
        prefix = runner.lifecycle_fixture().split('int main(int argc', 1)[0]
        main = r'''
int main(int argc, char** argv) {
  assert(argc == 2);
  ShellHostView host;
  HostMessageHandler a(&host);
  a.ui_ = {&host.frame_, host.shell()};
  host.frame_.NewDocument(a.web_ui());
  a.RegisterMessages();
  assert(!a.generation_);
  content::Page first_commit{&host.frame_};
  a.PrimaryPageChanged(first_commit);
  const auto generation = a.generation_;
  assert(generation && host.OwnsHandler(&a, generation));
  auto ordinary = std::make_unique<TabBinding>();
  ordinary->claim = "a";
  ordinary->renderer_generation = generation;
  host.bindings_[7] = std::move(ordinary);
  auto temporary = std::make_unique<TabBinding>();
  temporary->claim = "temporary";
  temporary->temporary = true;
  temporary->renderer_generation = generation;
  host.bindings_[8] = std::move(temporary);
  base::DictValue args;
  args.ints["id"] = 7;
  args.strings["claim"] = "a";
  content::RenderFrameHost pending_frame;
  auto b = std::make_unique<HostMessageHandler>(&host);
  b->ui_ = {&pending_frame, host.shell()};
  pending_frame.NewDocument(b->web_ui());
  b->RegisterMessages();
  assert(!b->generation_);
  assert(host.OwnsHandler(&a, generation));
  assert(host.ClaimedBinding(args));
  assert(host.Binding(8)->live);
  if (std::string(argv[1]) == "cancel") {
    a.OnJavascriptDisallowed();
    b.reset();
    assert(host.OwnsHandler(&a, generation));
    assert(host.Trusted(a.web_ui()));
    assert(host.ClaimedBinding(args));
    assert(host.Binding(8)->live);
    return 0;
  }
  host.contents_.primary = &pending_frame;
  assert(!host.OwnsHandler(&a, generation));
  content::Page committed{&pending_frame};
  a.PrimaryPageChanged(committed);
  assert(!b->generation_);
  b->PrimaryPageChanged(committed);
  assert(b->generation_ > generation);
  assert(host.OwnsHandler(b.get(), b->generation_));
  assert(!host.ClaimedBinding(args));
  assert(!host.Binding(8)->live);
  a.RegisterMessages();
  a.ActivateCommittedRenderer();
  assert(!host.OwnsHandler(&a, generation));
  assert(host.OwnsHandler(b.get(), b->generation_));
  if (std::string(argv[1]) == "commit") return 0;
  content::RenderFrameHost child_frame;
  HostMessageHandler child(&host);
  child.ui_ = {&child_frame, host.shell()};
  child_frame.NewDocument(child.web_ui());
  child.RegisterMessages();
  content::Page child_page{&child_frame};
  child.PrimaryPageChanged(child_page);
  assert(!child.generation_);
  content::WebContents foreign_contents{&pending_frame};
  HostMessageHandler foreign(&host);
  foreign.ui_ = {&pending_frame, &foreign_contents};
  foreign.RegisterMessages();
  foreign.PrimaryPageChanged(committed);
  assert(!foreign.generation_);
  const auto b_generation = b->generation_;
  host.Binding(7)->claim = "b";
  host.Binding(7)->renderer_generation = b_generation;
  pending_frame.NewDocument(b->web_ui());
  assert(!host.OwnsHandler(b.get(), b_generation));
  b->PrimaryPageChanged(committed);
  assert(b->generation_ > b_generation);
  assert(!host.OwnsHandler(b.get(), b_generation));
  assert(host.Binding(7)->claim.empty());
  assert(host.OwnsHandler(b.get(), b->generation_));
  pending_frame.live = false;
  b->PrimaryMainFrameRenderProcessGone(base::TERMINATION_STATUS_PROCESS_CRASHED);
  assert(!host.handler_);
}
'''
        runner.compile_and_run(prefix + main, mode)

    def test_canceled_pending_webui_on_a_reused_frame_preserves_authority(self):
        runner = renderer.RendererContractTests()
        prefix = runner.lifecycle_fixture().split('int main(int argc', 1)[0]
        main = r'''
int main(int argc, char**) {
  assert(argc == 2);
  ShellHostView host;
  HostMessageHandler a(&host);
  a.ui_ = {&host.frame_, host.shell()};
  host.frame_.NewDocument(a.web_ui());
  a.RegisterMessages();
  content::Page committed{&host.frame_};
  a.PrimaryPageChanged(committed);
  const auto generation = a.generation_;
  auto ordinary = std::make_unique<TabBinding>();
  ordinary->claim = "a";
  ordinary->renderer_generation = generation;
  host.bindings_[7] = std::move(ordinary);
  auto pending = std::make_unique<HostMessageHandler>(&host);
  pending->ui_ = {&host.frame_, host.shell()};
  host.frame_.ui = pending->web_ui();
  pending->RegisterMessages();
  assert(!pending->generation_);
  assert(host.OwnsHandler(&a, generation));
  a.OnJavascriptDisallowed();
  host.frame_.ui = a.web_ui();
  pending.reset();
  assert(host.OwnsHandler(&a, generation));
  assert(host.Trusted(a.web_ui()));
  base::DictValue args;
  args.ints["id"] = 7;
  args.strings["claim"] = "a";
  assert(host.ClaimedBinding(args));
}
'''
        runner.compile_and_run(prefix + main, 'reused-cancel')

    def test_canceled_speculative_registration_preserves_committed_authority(self):
        self.run_case('cancel')

    def test_real_commit_retires_the_old_document_without_request_reactivation(self):
        self.run_case('commit')

    def test_wrong_host_subframes_reused_documents_and_crashes(self):
        self.run_case('frames')


if __name__ == '__main__':
    unittest.main()
