from pathlib import Path
import re
import unittest

SOURCE = Path(__file__).resolve().parents[1] / 'src/ardia/linux/ac_linux_page_channel.cc'


def body(source, signature):
    start = source.index(signature)
    brace = source.index('{', start)
    depth, end = 1, brace + 1
    while depth:
        depth += (source[end] == '{') - (source[end] == '}')
        end += 1
    return source[start:end]


class PageChannelContractTests(unittest.TestCase):
    source = SOURCE.read_text()

    def test_activation_greets_every_frame_of_the_new_primary_page(self):
        changed = body(self.source, 'void LinuxPageChannel::PrimaryPageChanged(')
        self.assertIn('ForEachRenderFrameHost', changed)
        self.assertIn('Greet(', changed)

    def test_flood_budget_belongs_to_the_sending_document(self):
        post = body(self.source, 'void LinuxPageChannel::Post(')
        self.assertIn('GetOrCreateForCurrentDocument(&frame)', post)
        self.assertNotIn('budget_', self.source)
        self.assertIn('DOCUMENT_USER_DATA_KEY_IMPL(LinuxPageDocumentBudget)', self.source)

    def test_scripts_never_run_in_the_main_world(self):
        self.assertNotIn('ISOLATED_WORLD_ID_GLOBAL', self.source)
        self.assertIsNone(re.search(r'->ExecuteJavaScript\(', self.source))
        self.assertIn('ISOLATED_WORLD_ID_ARDIA_PAGE', body(self.source, 'void RunLinuxPageEvaluation('))

    def test_link_drops_open_only_through_the_drag_gate(self):
        drop = body(self.source, 'void LinuxPageChannel::LinkDrop(')
        self.assertIn('Gate().AcceptLinkDrop(surface_', drop)
        self.assertIn('"foreground"', drop)
        ended = body(self.source, 'void NoteLinuxDragEnded(')
        self.assertIn('Gate().DragSource()', ended)
        self.assertIn('in_window(&channel->GetWebContents())', ended)
        self.assertNotIn('GetCursorScreenPoint', self.source)
        self.assertLess(ended.index('Gate().NoteDrop(channel->DropOver() ? source : 0)'), ended.index('Gate().NoteDragEnded(source, Now())'))
        self.assertNotIn('OnDragCompleted', self.source)
        track = body(self.source, 'class LinuxPageDropTrack')
        for forwarded in ['inner_->OnDragEntered(event)', 'inner_->OnDragUpdated(event)', 'inner_->OnDragExited()', 'inner_->GetDropCallback(event)']:
            self.assertIn(forwarded, track)
        self.assertIn('base::BindOnce(&LinuxPageDropTrack::Settle, weak_factory_.GetWeakPtr(), over_.Exited())', track)
        self.assertIn('aura::client::SetDragDropDelegate(window_, inner_)', track)
        self.assertIn('drop_track_->Remove()', body(self.source, 'void LinuxPageChannel::WebContentsDestroyed('))
        pressed = body(self.source, 'void LinuxPageChannel::OnInputEvent(')
        self.assertLess(pressed.index('TrackDrops()'), pressed.index('Gate().NotePress(surface_)'))
        patch = (Path(__file__).resolve().parents[2] / 'patches/chromium-linux-page-status.patch').read_text()
        self.assertIn('+  if (g_ardia_linux_drag_ended) {', patch)

    def test_input_activity_is_folded_and_posted(self):
        observed = body(self.source, 'void LinuxPageChannel::OnInputEvent(')
        self.assertLess(observed.index('Activity().Note(Now())'), observed.index('kMouseDown && type'))
        self.assertIn('PostTask(FROM_HERE, ActivityListener())', observed)


if __name__ == '__main__':
    unittest.main()
