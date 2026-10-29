import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
LINUX = ROOT / 'src/ardia/linux'


def body(source, signature):
    start = source.index(signature)
    brace = source.index('{', start)
    depth, end = 1, brace + 1
    while depth:
        depth += (source[end] == '{') - (source[end] == '}')
        end += 1
    return source[start:end]


class PageVideoTests(unittest.TestCase):
    def setUp(self):
        self.channel = (LINUX / 'ac_linux_page_channel.cc').read_text()
        self.channel_header = (LINUX / 'ac_linux_page_channel.h').read_text()
        self.media = (LINUX / 'ac_linux_page_media.cc').read_text()
        self.media_header = (LINUX / 'ac_linux_page_media.h').read_text()

    def test_the_page_script_reports_each_documents_video_even_before_a_tab_attaches(self):
        self.assertIn('class LinuxPageDocumentVideo : public content::DocumentUserData<LinuxPageDocumentVideo>', self.channel_header)
        post = body(self.channel, 'void LinuxPageChannel::Post(')
        self.assertIn('(!hooks_ && *type != LinuxPageMessageKind::kNowPlaying)', post)
        self.assertIn('LinuxPageSenderAccepted(*type, sender)', post)
        self.assertIn('.Admit(Now(), kind.size() + json.size())', post)
        accept = body(self.channel, 'void LinuxPageChannel::Accept(')
        self.assertIn('case LinuxPageMessageKind::kNowPlaying:\n      return NoteVideo(frame, message.data);', accept)
        note = body(self.channel, 'void LinuxPageChannel::NoteVideo(')
        self.assertIn('LinuxPageDocumentVideo::GetOrCreateForCurrentDocument(&frame)', note)
        self.assertIn('page_video_listeners_.Notify()', note)
        self.assertNotIn('hooks_', note)

    def test_the_agent_reduces_now_playing_before_its_size_check(self):
        agent = (LINUX / 'renderer/ac_linux_page_agent.cc').read_text()
        post = body(agent, '  void Post(gin::Arguments* args) {')
        reduce = post.index('kLinuxNowPlayingBytesMax')
        self.assertLess(reduce, post.index('ardiacore::kLinuxPageMessageBytesMax'))
        self.assertIn('json = NowPlayingReport(isolate, value.As<v8::String>());', post)
        report = body(agent, '  static std::string NowPlayingReport(')
        self.assertIn('v8::TryCatch try_catch(isolate);', report)
        self.assertIn('v8::JSON::Parse(', report)
        self.assertIn('ardiacore::LinuxNowPlayingReport(', report)

    def test_now_playing_has_its_own_budget(self):
        post = body(self.channel, 'void LinuxPageChannel::Post(')
        self.assertIn('LinuxPageDocumentBudget::GetOrCreateForCurrentDocument(&frame)', post)
        self.assertIn('*type == LinuxPageMessageKind::kNowPlaying ? budget->now_playing : budget->budget', post)

    def test_the_tab_entry_follows_the_live_documents_of_the_primary_page(self):
        summary = body(self.media, 'LinuxPageVideo LinuxPageMedia::PageVideo() const')
        self.assertIn('GetPrimaryMainFrame()->ForEachRenderFrameHost(', summary)
        self.assertIn('frame->GetPage().IsPrimary()', summary)
        self.assertIn('frame->IsRenderFrameLive()', summary)
        self.assertIn('LinuxPageDocumentVideo::GetForCurrentDocument(frame)', summary)
        self.assertNotIn('IsInPrimaryMainFrame', summary)
        created = body(self.media, 'LinuxPageMedia::LinuxPageMedia(')
        self.assertIn('AddPageVideoListener(', created)
        self.assertIn('if (PageVideo().present) UpdateNowPlaying();', created)
        self.assertIn('const LinuxPageVideo video = PageVideo();', body(self.media, 'void LinuxPageMedia::UpdateNowPlaying()'))
        self.assertIn('UpdateNowPlaying()', body(self.media, 'void LinuxPageMedia::PrimaryPageChanged('))
        self.assertIn('UpdateNowPlaying()', body(self.media, 'void LinuxPageMedia::RenderFrameDeleted('))
        navigation = body(self.media, 'void LinuxPageMedia::DidFinishNavigation(')
        self.assertIn('!navigation->IsSameDocument()', navigation)

    def test_browser_player_starts_no_longer_decide_the_page_video(self):
        for override in ['MediaStartedPlaying', 'MediaStoppedPlaying', 'MediaMetadataChanged']:
            self.assertNotIn(override, self.media_header)
            self.assertNotIn(override, self.media)
        self.assertNotIn('LinuxPageVideos', (LINUX / 'ac_linux_media.h').read_text())


if __name__ == '__main__':
    unittest.main()
