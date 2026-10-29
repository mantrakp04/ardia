from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from document_host_fixture import ROOT, SOURCES, WRITER, values
from document_renderer_fixture import fixture


MAIN = r'''
int main() {
  (void)Ignore;
  ShellHostView host;
  ShellHostView peer;
  peer.documents_ = host.documents_;
  peer.document_window_ = "peer";
  auto authority = host.documents_;
  HostMessageHandler a(&host);
  HostMessageHandler other(&peer);
  a.ui_ = {&host.frame_, host.shell()};
  a.RegisterMessages();
  assert(!a.generation_ && !host.handler_ && host.DocumentClient().id.empty());
  QueryIdentity(a); assert(a.replies.empty());
  Send(a, "watch", WatchRequest());
  assert(files.tasks.empty() && host.DocumentClient().id.empty());
  assert(host.RequestWindowClose().empty());
  Activate(host, a, host.frame_);
  Activate(peer, other, peer.frame_);
  assert(host.DocumentClient().id.empty());
  QueryIdentity(a);
  assert(a.replies.size() == 1 && a.replies.back().first);
  assert(*a.replies.back().second.GetDict().FindString("rendererGeneration") == std::to_string(a.generation_));
  assert(host.DocumentClient().id.empty());
  Send(a, "watch", WatchRequest()); Send(other, "watch", WatchRequest());
  Drain();
  const auto first_client = host.DocumentClient();
  assert(!first_client.id.empty() && host.document_client_generation_ == a.generation_);
  const auto first_generation = a.generation_;
  const auto request = host.RequestWindowClose();
  assert(!request.empty());
  content::RenderFrameHost pending_frame;
  auto b = std::make_unique<HostMessageHandler>(&host);
  b->ui_ = {&pending_frame, host.shell()};
  pending_frame.NewDocument(b->web_ui());
  b->RegisterMessages();
  QueryIdentity(*b); assert(b->replies.empty());
  Send(*b, "watch", WatchRequest());
  SendAck(*b, request, 0);
  assert(files.tasks.empty());
  assert(host.DocumentClient().id == first_client.id);
  assert(host.close_.phase() == LinuxClose::Phase::kRequested);
  host.frame_.ui = b->web_ui();
  Send(a, "commit", CommitRequest(first_client, 1));
  assert(files.tasks.empty());
  assert(host.RequestWindowClose().empty());
  host.frame_.ui = a.web_ui();
  b.reset();
  a.OnJavascriptDisallowed();
  assert(host.DocumentClient().id == first_client.id && host.OwnsHandler(&a, first_generation));
  host.CancelWindowClose(host.close_.identity(), Ignore); Drain();
  host.events.clear(); peer.events.clear(); a.replies.clear();
  Send(a, "commit", CommitRequest(first_client, 1));
  b = std::make_unique<HostMessageHandler>(&host);
  b->RegisterMessages();
  Activate(host, *b, pending_frame);
  const auto replacement_generation = b->generation_;
  assert(replacement_generation > first_generation);
  assert(host.DocumentClient().id.empty());
  Drain();
  assert(authority->disk->FindDict("clients")->FindDict(first_client.id));
  assert(host.events.empty() && a.replies.empty());
  assert(peer.events.size() == 1);
  QueryIdentity(a); assert(a.replies.empty());
  Send(a, "watch", WatchRequest());
  SendAck(a, request, 1);
  assert(files.tasks.empty() && host.DocumentClient().id.empty());
  a.ActivateCommittedRenderer();
  assert(host.OwnsHandler(b.get(), replacement_generation));
  Send(*b, "watch", WatchRequest()); Drain();
  const auto replacement_client = host.DocumentClient();
  assert(!replacement_client.id.empty() && replacement_client.id != first_client.id);
  assert(host.document_client_generation_ == replacement_generation);
  const auto replacement_close = host.RequestWindowClose();
  auto retired = host.close_.identity();
  SendAck(*b, replacement_close, 0);
  files.Drain();
  pending_frame.NewDocument(b->web_ui());
  assert(!host.OwnsHandler(b.get(), replacement_generation));
  content::Page reused_page{&pending_frame};
  b->PrimaryPageChanged(reused_page);
  assert(b->generation_ > replacement_generation);
  Drain();
  assert(!host.native.widget.IsClosed());
  assert(host.DocumentClient().id.empty());
  host.CancelWindowClose(retired, [](bool success, auto) { assert(!success); });
  Send(*b, "watch", WatchRequest()); Drain();
  const auto reused_client = host.DocumentClient();
  assert(!reused_client.id.empty() && reused_client.id != replacement_client.id);
  const auto b_generation = b->generation_;
  pending_frame.live = false;
  b->PrimaryMainFrameRenderProcessGone(0);
  assert(!host.handler_ && host.DocumentClient().id.empty());
  assert(host.renderer_generation_ > b_generation);
  Send(*b, "watch", WatchRequest());
  Drain();
  assert(host.DocumentClient().id.empty() && !host.native.widget.IsClosed());
  b.reset();
  pending_frame.live = true;
  const auto peer_events = peer.events.size();
  LinuxDocumentClient lost_client;
  {
    HostMessageHandler source(&host);
    Activate(host, source, pending_frame);
    Send(source, "watch", WatchRequest()); Drain();
    lost_client = host.DocumentClient();
    Send(source, "commit", CommitRequest(lost_client, 1));
  }
  assert(!host.handler_ && host.DocumentClient().id.empty());
  Drain();
  assert(authority->disk->FindDict("clients")->FindDict(lost_client.id));
  assert(peer.events.size() == peer_events + 1);
  host.RetireDocuments(); peer.RetireDocuments(); Drain();
  auto detached = std::make_unique<ShellHostView>();
  detached->close_replies_.emplace_back([&](bool success, auto) { assert(!success); detached.reset(); });
  detached->DetachBrowser();
  assert(!detached);
  Drain();
}
'''


class DocumentRendererTests(unittest.TestCase):
    def test_document_and_close_authority_follow_committed_activation(self):
        compiler = shutil.which('clang++') or shutil.which('c++')
        self.assertIsNotNone(compiler)
        with tempfile.TemporaryDirectory(prefix='ardia-document-renderer-') as scratch:
            root = Path(scratch)
            (root / 'base/json').mkdir(parents=True)
            (root / 'base/values.h').write_text(values())
            (root / 'base/json/json_writer.h').write_text(WRITER)
            (root / 'main.cc').write_text(fixture() + MAIN)
            binary = root / 'renderer'
            result = subprocess.run([compiler, '-std=c++23', '-Wall', '-Wextra', '-Werror', '-fsanitize=address,undefined', '-fno-omit-frame-pointer', '-I', str(root), '-I', str(ROOT / 'src'), *[str(ROOT / 'src/ardia/linux' / name) for name in SOURCES], str(root / 'main.cc'), '-o', str(binary)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            result = subprocess.run([str(binary)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
