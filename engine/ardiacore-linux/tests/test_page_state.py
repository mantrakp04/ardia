import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'src'
FILES = [SOURCE / 'ardia/linux' / f'ac_linux_{name}.cc' for name in ['page_lease', 'security', 'history_zoom', 'theme', 'page_status', 'page_state']]
FIXTURE = ROOT / 'tests/fixtures/page_state.h'


class PageStateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory(prefix='ardia-page-state-')
        directory = Path(cls.directory.name)
        for source in FILES + [p.with_suffix('.h') for p in FILES]:
            for include in re.findall(r'#include "([^"]+)"', source.read_text()):
                if include.startswith('ardia/'):
                    continue
                header = directory / include
                header.parent.mkdir(parents=True, exist_ok=True)
                header.write_text(f'#include "{FIXTURE}"\n')
        cls.binary = directory / 'page-state'
        subprocess.run([os.environ.get('CXX', 'c++'), '-std=c++20', '-Wall', '-Wextra', '-Werror', '-g', '-fsanitize=address,undefined', '-fno-omit-frame-pointer', '-no-pie', '-I', str(directory), '-I', str(SOURCE), *map(str, FILES), str(ROOT / 'tests/page_state_test.cc'), '-o', str(cls.binary)], check=True, text=True, timeout=90)

    @classmethod
    def tearDownClass(cls):
        cls.directory.cleanup()

    def run_case(self, name):
        subprocess.run([str(self.binary), name], check=True, text=True, timeout=10,
                       env={**os.environ, "UBSAN_OPTIONS": "halt_on_error=1"})

    def test_original_claim_browser_profile_window_shell_and_contents(self):
        self.run_case('authority')

    def test_primary_document_bfcache_and_same_frame_replacement(self):
        self.run_case('documents')

    def test_provisional_cancellation_and_request_generation(self):
        self.run_case('provisional')

    def test_snapshot_watermark_sequence_and_resets(self):
        self.run_case('transport')

    def test_security_matrix_certificate_removal_and_observation(self):
        self.run_case('security')

    def test_native_history_integer_boundaries_and_zoom_factors(self):
        self.run_case('history')

    def test_history_bounds_prevent_native_signed_overflow(self):
        self.run_case('history-bounds')

    def test_domain_zoom_payload_conversion(self):
        self.run_case('domain')

    def test_zoom_observer_destruction_and_rebind(self):
        self.run_case('zoom')

    def test_theme_meta_updates_nulls_and_provisional_clear(self):
        self.run_case('theme')

    def test_sampled_header_theme_is_scoped_to_the_current_main_document(self):
        self.run_case('sampled-theme')

    def test_page_message_snapshot_and_sampled_theme_through_page_state(self):
        self.run_case('page-messages')

    def test_reentrant_sink_and_snapshot_self_destruction(self):
        self.run_case('reentrant')

    def test_creation_response_carries_lease_and_ordered_snapshot(self):
        self.run_case('creation')

    def test_document_reset_snapshot_stale_epoch_and_provisional_presentation(self):
        self.run_case('boundaries')

    def test_history_offsets_and_zoom_reports_through_joined_state(self):
        self.run_case('commands')

    def test_terminal_close_uses_original_lease_once(self):
        self.run_case('closing')

    def test_rebind_mints_new_binding_and_reentrant_teardown(self):
        self.run_case('rebinding')

    def test_overlapping_primary_navigations_keep_provisional_until_all_finish(self):
        self.run_case('overlapping')

    def test_security_describes_the_committed_entry_not_a_pending_one(self):
        self.run_case('committed-security')

    def test_snapshots_carry_reason_and_resend_current_favicons(self):
        self.run_case('favicons')

    def test_membership_checks_reuse_the_last_strip_index(self):
        self.run_case('strip-lookups')

    def test_shell_in_the_app_profile_and_tabs_in_the_page_profile(self):
        self.run_case('split-profiles')

    def test_fullscreen_status_and_crash_producers_and_snapshot_inclusion(self):
        self.run_case('page-status')

    def test_hung_renderer_wait_exit_and_stale_hosts(self):
        self.run_case('hung')

    def test_hangs_without_a_current_page_wait_for_the_next_mounted_page(self):
        self.run_case('deferred-hang')

    def test_blocked_popups_review_open_and_stale_documents(self):
        self.run_case('popups')

    def test_a_remounted_page_keeps_the_blocked_popups_of_its_document(self):
        self.run_case('remounted-popups')

    def test_snapshot_producers_append_after_core_state(self):
        self.run_case('producers')

    def test_snapshot_producer_retire_reentrancy_and_bounds(self):
        self.run_case('producer-lifetimes')


if __name__ == '__main__':
    unittest.main()
