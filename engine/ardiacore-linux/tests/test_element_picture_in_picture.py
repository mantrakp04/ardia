import contextlib
import pathlib
import re
import shutil
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
LINUX = ROOT / 'src/ardia/linux'
PATCH = ROOT.parents[0] / 'patches/chromium-linux-media-player-pip.patch'
CHROMIUM = pathlib.Path.home() / 'ardia-linux-build-156/chromium_git/chromium/src'
FILES = [
    'content/browser/media/media_web_contents_observer.cc',
    'content/browser/media/media_web_contents_observer.h',
    'content/browser/media/session/media_session_controllers_manager.cc',
    'content/browser/media/session/media_session_controllers_manager.h',
    'content/browser/media/session/media_session_controller.h',
]


def body(source, signature):
    start = source.index(signature)
    brace = source.index('{', start)
    depth, end = 1, brace + 1
    while depth:
        depth += (source[end] == '{') - (source[end] == '}')
        end += 1
    return source[start:end]


def committed(name):
    result = subprocess.run(['git', '-C', str(CHROMIUM), 'show', f'HEAD:{name}'], capture_output=True, text=True)
    return result.stdout if result.returncode == 0 else None


@contextlib.contextmanager
def patched_tree():
    sources = {name: committed(name) for name in FILES} if CHROMIUM.exists() else {}
    if not sources or any(text is None for text in sources.values()) or shutil.which('patch') is None:
        raise unittest.SkipTest('Chromium 156 source is unavailable')
    with tempfile.TemporaryDirectory(prefix='ardia-media-player-pip-') as directory:
        for name, text in sources.items():
            target = pathlib.Path(directory) / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(text)
        result = subprocess.run(['patch', '-p1', '-F0', '-i', str(PATCH)], cwd=directory, capture_output=True, text=True)
        if result.returncode != 0:
            raise AssertionError(result.stdout + result.stderr)
        yield directory


class ElementPictureInPictureTests(unittest.TestCase):
    def test_nothing_on_linux_grants_a_page_user_activation(self):
        for path in [*LINUX.glob('*.cc'), *LINUX.glob('renderer/*.cc')]:
            self.assertNotIn('NotifyUserActivation', path.read_text(), path.name)
        mojom = (LINUX / 'mojom/page.mojom').read_text()
        self.assertNotIn('EnterPictureInPictureForUser', mojom)
        self.assertNotIn('PictureInPictureDocument', mojom)

    def test_the_patch_requests_pip_for_one_available_player_of_the_primary_page(self):
        series = (ROOT.parents[0] / 'patches/series').read_text()
        self.assertIn('chromium chromium-linux-media-player-pip.patch linux', series)
        text = PATCH.read_text()
        added = '\n'.join(line for line in text.splitlines() if line.startswith('+') and not line.startswith('+++'))
        self.assertNotRegex(added, r'(?m)^\+\s*/\*|^\+\s*//(?! nogncheck)')
        with patched_tree() as directory:
            observer = (pathlib.Path(directory) / FILES[0]).read_text()
            eligible = body(observer, 'bool MediaWebContentsObserver::ArdiaLinuxPictureInPictureEligible(')
            self.assertIn('has_video()', eligible)
            self.assertRegex(eligible, r'ArdiaLinuxPictureInPictureAvailable\(\s*id\)')
            self.assertIn('ArdiaLinuxInPrimaryPage(id)', eligible)
            self.assertIn('media_player_remotes_.contains(id)', eligible)
            candidates = body(observer, 'MediaWebContentsObserver::ArdiaLinuxPictureInPictureCandidates(')
            self.assertIn('ArdiaLinuxPictureInPictureEligible(id)', candidates)
            self.assertIn('info->muted()', candidates)
            self.assertNotIn('frame_routing_id', candidates)
            primary = body(observer, 'bool MediaWebContentsObserver::ArdiaLinuxInPrimaryPage(')
            self.assertIn('RenderFrameHost::FromID(id.frame_routing_id)', primary)
            self.assertIn('frame->GetPage().IsPrimary()', primary)
            self.assertIn('WebContents::FromRenderFrameHost(frame) == web_contents_impl()', primary)
            request = body(observer, 'bool MediaWebContentsObserver::ArdiaLinuxRequestPictureInPicture(')
            self.assertIn('media_player_remotes_.find(id)', request)
            self.assertIn('ArdiaLinuxPictureInPictureEligible(id)', request)
            self.assertIn('RequestEnterPictureInPicture(std::nullopt)', request)
            self.assertNotIn('GetPrimaryMainFrame', body(observer, 'bool ArdiaLinuxRequestPictureInPicture(WebContents* contents,'))
            for name in FILES[1::2]:
                self.assertIn('#if BUILDFLAG(IS_LINUX)', (pathlib.Path(directory) / name).read_text())

    def test_pip_availability_is_read_without_the_session_player_id_check(self):
        with patched_tree() as directory:
            manager = (pathlib.Path(directory) / FILES[2]).read_text()
            available = body(manager, 'bool MediaSessionControllersManager::ArdiaLinuxPictureInPictureAvailable(')
            self.assertIn('ArdiaLinuxPictureInPictureAvailable()', available)
            self.assertNotIn('id.player_id', available)
            controller = (pathlib.Path(directory) / FILES[4]).read_text()
            self.assertIn('bool ArdiaLinuxPictureInPictureAvailable() const {\n    return is_picture_in_picture_available_;', controller)

    def test_the_patch_keeps_no_played_player_list(self):
        text = PATCH.read_text()
        self.assertNotIn('has_played', text)
        self.assertNotIn('ArdiaLinuxPlayedVideoPlayers', text)
        self.assertNotIn('ArdiaLinuxPlayedVideoPlayers', (LINUX / 'ac_linux_content_hooks.h').read_text())

    def test_the_host_chooses_among_available_players_and_waits_for_the_window(self):
        media = (LINUX / 'ac_linux_page_media.cc').read_text()
        request = body(media, 'void LinuxPageMedia::RequestPictureInPicture(')
        self.assertIn('candidate.muted', request)
        self.assertIn('candidate.id.frame_routing_id == contents->GetPrimaryMainFrame()->GetGlobalId()', request)
        self.assertIn('content::ArdiaLinuxPictureInPictureCandidates(', request)
        self.assertIn('ChooseLinuxPictureInPicturePlayer(', request)
        self.assertIn('content::ArdiaLinuxRequestPictureInPicture(', request)
        self.assertIn('picture_in_picture_timer_.Start(', request)
        self.assertIn('video_sizes_[id] = size', body(media, 'void LinuxPageMedia::MediaResized('))


if __name__ == '__main__':
    unittest.main()
