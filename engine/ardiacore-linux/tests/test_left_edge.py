import os
from pathlib import Path
import subprocess
import tempfile
import unittest

from test_renderer_contract import method

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'src'
LINUX = SOURCE / 'ardia/linux'


class LeftEdgeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory(prefix='ardia-left-edge-')
        cls.binary = Path(cls.directory.name) / 'left-edge'
        subprocess.run([os.environ.get('CXX', 'c++'), '-std=c++20', '-Wall', '-Wextra', '-Werror', '-g',
                        '-fsanitize=address,undefined', '-fno-omit-frame-pointer', '-I', str(SOURCE),
                        str(ROOT / 'tests/left_edge_test.cc'), '-o', str(cls.binary)],
                       check=True, text=True, timeout=120)
        cls.host = (LINUX / 'ac_linux_host.cc').read_text()

    @classmethod
    def tearDownClass(cls):
        cls.directory.cleanup()

    def run_case(self, name):
        subprocess.run([str(self.binary), name], check=True, text=True, timeout=10,
                       env={**os.environ, 'UBSAN_OPTIONS': 'halt_on_error=1'})

    def test_the_strip_covers_the_frame_border_and_the_page_edge_like_the_mac_strip(self):
        self.run_case('strip')

    def test_a_peek_stays_over_anywhere_in_its_hold_column_including_over_the_page(self):
        self.run_case('hold')

    def test_a_new_watch_reports_where_the_pointer_already_is(self):
        self.run_case('fresh')

    def test_leaving_past_the_left_edge_into_a_gap_settles_into_a_peek(self):
        self.run_case('settle')

    def test_a_wayland_leave_reported_at_its_last_sample_inside_still_counts_when_the_left_edge_is_nearest(self):
        self.run_case('fast-leave')

    def test_focus_moving_to_the_window_on_the_left_cancels_the_settle(self):
        self.run_case('focus-left')
        self.run_case('settle-inactive')

    def test_leaving_through_any_other_edge_is_not_over(self):
        self.run_case('other-exits')

    def test_a_peek_stays_out_while_the_pointer_is_just_past_the_left_edge(self):
        self.run_case('peek-beside')

    def test_an_inactive_window_gets_no_reach_beyond_its_edge(self):
        self.run_case('inactive')

    def test_nothing_is_reported_while_unwatched_and_a_watch_waits_for_a_settle(self):
        self.run_case('unwatched')
        self.run_case('watch-settling')

    def test_the_host_advertises_the_watcher_and_answers_it_per_window(self):
        self.assertIn('.Append("ArdiaShell.watchLeftEdge")', self.host)
        start = self.host.index('  if (method == "ArdiaShell.watchLeftEdge") {')
        body = self.host[start:self.host.index('\n  }\n', start)]
        self.assertIn('left_edge_.Stop();', body)
        self.assertIn('left_edge_.Watch(', body)
        self.assertIn('GetWidget()->IsActive()', body)
        self.assertIn('if (is_utility())', body)

    def test_native_enters_and_leaves_reach_the_watcher_but_aura_child_crossings_do_not(self):
        dispatcher = (Path.home() / 'ardia-linux-build-156/chromium_git/chromium/src/ui/aura/window_event_dispatcher.cc')
        if dispatcher.exists():
            self.assertIn('event.flags() | ui::EF_IS_SYNTHESIZED', dispatcher.read_text())

    def test_every_pointer_event_in_the_window_reaches_the_watcher_before_the_page_or_the_frame(self):
        self.assertIn('input_window->AddPreTargetHandler(left_edge_handler_.get(), ui::EventTarget::Priority::kSystem);', self.host)
        self.assertIn('RemovePreTargetHandler(left_edge_handler_.get())', self.host)
        mouse = method(self.host, 'void ShellHostView::OnLeftEdgeMouse(const ui::MouseEvent& event) {')
        self.assertIn('if (event.flags() & ui::EF_IS_SYNTHESIZED) return;', mouse)
        self.assertLess(mouse.index('ui::EF_IS_SYNTHESIZED'), mouse.index('const bool exited'))
        self.assertIn('ui::EventType::kMouseEntered', mouse)
        self.assertNotIn('event.target()', mouse)
        self.assertIn('left_edge_.Exited(', mouse)
        self.assertIn('LeftEdgeWatch::kSettleMs', mouse)
        self.assertIn('GetWeakPtr()', mouse)

    def test_losing_activation_ends_a_peek_held_past_the_left_edge(self):
        activation = method(self.host, 'void ShellHostView::OnWidgetActivationChanged(views::Widget*, bool active) {')
        self.assertIn('ReportLeftEdge(left_edge_.ActivationChanged(active));', activation)

    def test_reports_use_the_shared_left_edge_event(self):
        report = method(self.host, 'void ShellHostView::ReportLeftEdge(std::optional<ardia::linux_window::LeftEdgeReport> report) {')
        for part in ('"ArdiaShell", "onWindowEvent"', '.Set("type", "leftEdge")', '.Set("id", left_edge_id_)', '.Set("over", report->over)', '.Set("point"'):
            self.assertIn(part, report)

    def test_the_header_is_part_of_the_build(self):
        self.assertIn('"ac_linux_left_edge.h",', (LINUX / 'BUILD.gn').read_text())


if __name__ == '__main__':
    unittest.main()
