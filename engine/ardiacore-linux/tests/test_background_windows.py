import pathlib
import unittest

from chromium_series import applied
from test_renderer_contract import method as extract

ROOT = pathlib.Path(__file__).resolve().parents[1]
PATCHES = ROOT.parents[0] / 'patches'
PATCH = PATCHES / 'chromium-linux-background-windows.patch'
FILES = ['chrome/app/chrome_main_delegate.cc', 'chrome/browser/ui/views/frame/browser_view.cc']
LAUNCH = (ROOT / 'src/ardia/core/ac_launch_switches_linux.cc').read_text()


def added(text):
    return '\n'.join(line[1:] for line in text.splitlines() if line.startswith('+') and not line.startswith('+++'))


class BackgroundWindowTests(unittest.TestCase):
    def test_patch_is_linux_only_and_follows_the_layer_that_adds_the_startup_hook(self):
        series = (PATCHES / 'series').read_text()
        self.assertIn('chromium chromium-linux-background-windows.patch linux', series)
        self.assertLess(series.index('chromium-ardia-linux-layer.patch'), series.index('chromium-linux-background-windows.patch'))
        self.assertNotRegex(added(PATCH.read_text()), r'(?m)^\s*(//(?! nogncheck)|/\*)')

    def test_the_switch_the_patch_reads_is_the_one_the_launch_config_sets(self):
        self.assertIn('kBackgroundSwitch', extract(LAUNCH, 'void InitializeLinuxLaunchConfig()'))
        switches = (ROOT.parents[0] / 'ardiacore/src/ardia/core/ac_launch_switches.h').read_text()
        self.assertIn('kBackgroundSwitch[] = "ardia-background"', switches)
        self.assertIn('HasSwitch("ardia-background")', added(PATCH.read_text()))

    def test_background_startup_windows_map_inactive_and_never_activate(self):
        with applied(PATCH.name, *FILES) as directory:
            view = (directory / FILES[1]).read_text()
            show = extract(view, 'void BrowserView::Show()')
            self.assertLess(show.index('if (browser_widget_->IsVisible()) {\n    if (ArdiaLinuxBackgroundInstance()) {\n      return;'),
                            show.index('browser_widget_->Activate();'))
            self.assertIn('    browser_widget_->ShowInactive();\n  } else {\n    browser_widget_->Show();', show)
            activate = extract(view, 'void BrowserView::Activate()')
            self.assertLess(activate.index('DidBecomeActive();'), activate.index('if (!ArdiaLinuxBackgroundInstance()) {\n    browser_widget_->Activate();'))
            self.assertEqual(activate.count('return;'), 2)
            self.assertLess(show.index('GetSavedWindowPlacement(browser_widget_.get(), &ardia_saved_bounds, &ardia_saved_state);'),
                            show.index('browser_widget_->ShowInactive();'))
            self.assertLess(show.index('if (!weak_ptr) {'), show.index('if (ardia_saved_state == ui::mojom::WindowShowState::kMaximized) {\n    browser_widget_->Maximize();'))
            self.assertLess(view.index('bool ArdiaLinuxBackgroundInstance()'), view.index('void BrowserView::Show()'))
            main = (directory / FILES[0]).read_text()
            startup = extract(main, 'std::optional<int> ChromeMainDelegate::BasicStartupComplete()')
            self.assertIn('ardiacore::InitializeLinuxLaunchConfig();', startup)
            self.assertIn('#include "ardia/linux/ac_linux_launch_config.h"  // nogncheck', main)


if __name__ == '__main__':
    unittest.main()
