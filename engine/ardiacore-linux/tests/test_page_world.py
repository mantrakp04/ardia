from pathlib import Path
import unittest

AGENT = Path(__file__).resolve().parents[1] / 'src/ardia/linux/renderer/ac_linux_page_agent.cc'


def body(source, signature):
    start = source.index(signature)
    brace = source.index('{', start)
    depth, end = 1, brace + 1
    while depth:
        depth += (source[end] == '{') - (source[end] == '}')
        end += 1
    return source[start:end]


class PageWorldTests(unittest.TestCase):
    source = AGENT.read_text()

    def test_the_ardia_world_gets_its_own_policy_and_an_opaque_origin_before_any_script(self):
        configure = body(self.source, 'void ConfigureArdiaPageWorld(')
        self.assertIn('blink::SetIsolatedWorldInfo(ISOLATED_WORLD_ID_ARDIA_PAGE, info)', configure)
        self.assertIn('blink::WebSecurityOrigin(url::Origin())', configure)
        self.assertIn('kArdiaPageWorldPolicy', configure)
        self.assertIn('static bool configured', configure)
        install = body(self.source, 'void Install()')
        self.assertLess(install.index('ConfigureArdiaPageWorld()'), install.index('ExecuteScriptInIsolatedWorldAndReturnValue'))

    def test_the_world_policy_blocks_scripts_and_plugins_it_could_inject(self):
        self.assertIn('constexpr char kArdiaPageWorldPolicy[] = "script-src \'none\'; object-src \'none\'";', self.source)
        self.assertNotIn('require-trusted-types-for', self.source)


if __name__ == '__main__':
    unittest.main()
