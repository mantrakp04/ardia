import pathlib
import shutil
import subprocess
import tempfile
import unittest


SOURCE = pathlib.Path(__file__).resolve().parents[1] / 'src'


class SuggestPolicyTests(unittest.TestCase):
    def test_only_built_in_endpoint_queries_and_bounded_json_replies_pass(self):
        compiler = shutil.which('clang++') or shutil.which('c++')
        if compiler is None:
            self.skipTest('C++ compiler is unavailable')
        code = r'''#include <cassert>
#include <optional>
#include <string>
#include <vector>
#include "ardia/linux/ac_linux_suggest_policy.h"
int main() {
  using namespace ardia::linux_suggest_policy;
  assert(RequestAllowed("https://suggestqueries.google.com/complete/search?client=firefox&q=linux%20parity"));
  assert(RequestAllowed("https://duckduckgo.com/ac/?q=a&type=list"));
  assert(RequestAllowed("https://suggest.yandex.com/suggest-ff.cgi?part=%C3%A4"));
  assert(!RequestAllowed("https://suggestqueries.google.com/complete/search"));
  assert(!RequestAllowed("https://suggestqueries.google.com/complete/search?"));
  assert(!RequestAllowed("https://suggestqueries.google.com/complete/searchx?q=a"));
  assert(!RequestAllowed("https://suggestqueries.google.com/complete/search/x?q=a"));
  assert(!RequestAllowed("https://suggestqueries.google.com.evil.example/complete/search?q=a"));
  assert(!RequestAllowed("https://suggestqueries.google.com:444/complete/search?q=a"));
  assert(!RequestAllowed("http://suggestqueries.google.com/complete/search?q=a"));
  assert(!RequestAllowed("https://user@suggestqueries.google.com/complete/search?q=a"));
  assert(!RequestAllowed("https://duckduckgo.com/ac/../collect?q=a"));
  assert(!RequestAllowed("https://duckduckgo.com/ac/x?q=a"));
  assert(!RequestAllowed("https://www.google.com/search?q=a"));
  assert(!RequestAllowed("https://duckduckgo.com/ac/?q=a#fragment"));
  assert(!RequestAllowed("https://duckduckgo.com/ac/?q=a b"));
  assert(!RequestAllowed("https://duckduckgo.com/ac/?q=a\\b"));
  assert(!RequestAllowed(std::string("https://duckduckgo.com/ac/?q=a\0b", 31)));
  assert(!RequestAllowed("https://duckduckgo.com/ac/?q=\xc3\xa4"));
  assert(!RequestAllowed("https://duckduckgo.com/ac/?q=" + std::string(kMaxRequestLength, 'a')));
  assert(!RequestAllowed(""));
  assert(ReplyAcceptable(200, "[\"linux\",[\"linux parity\"]]"));
  assert(ReplyAcceptable(200, " \n[\"\xc3\xa4\",[]]"));
  assert(!ReplyAcceptable(404, "[\"linux\",[]]"));
  assert(!ReplyAcceptable(200, ""));
  assert(!ReplyAcceptable(200, "{\"q\":1}"));
  assert(!ReplyAcceptable(200, "<html>"));
  assert(!ReplyAcceptable(200, "[\"\xff\"]"));
  assert(!ReplyAcceptable(200, "[\"\xc3\"]"));
  assert(!ReplyAcceptable(200, "[\"\xc3"));
  assert(!ReplyAcceptable(200, "[\"\xed\xa0\x80\"]"));
  assert(!ReplyAcceptable(200, "[\"\xc0\xaf\"]"));
  assert(!ReplyAcceptable(200, "[" + std::string(kMaxReplyBytes, ' ')));
  assert(ValidRequestId("suggest-1"));
  assert(ValidRequestId("A_z-09"));
  assert(!ValidRequestId(""));
  assert(!ValidRequestId("a b"));
  assert(!ValidRequestId("a/b"));
  assert(!ValidRequestId(std::string(65, 'a')));
  SuggestionSlots window;
  for (int i = 0; i < kMaxInFlightPerWindow; ++i) assert(window.Admit("r" + std::to_string(i)).empty());
  assert(window.size() == static_cast<size_t>(kMaxInFlightPerWindow));
  assert((window.Admit("newest") == std::vector<std::string>{"r0"}));
  assert(window.Contains("newest"));
  assert(!window.Contains("r0"));
  assert((window.Admit("r2") == std::vector<std::string>{"r2"}));
  assert(window.Contains("r2"));
  assert(window.size() == static_cast<size_t>(kMaxInFlightPerWindow));
  assert(window.Remove("r1"));
  assert(!window.Remove("r1"));
  SuggestionSlots other;
  assert(other.Admit("r0").empty());
  assert(window.size() == static_cast<size_t>(kMaxInFlightPerWindow) - 1);
  assert(!Allowed(SuggestionsSetting::kUnknown));
  assert(Allowed(SettingFrom(std::nullopt)));
  assert(Allowed(SettingFrom(true)));
  assert(!Allowed(SettingFrom(false)));
  assert(ValidUtf8("\xf0\x9f\x98\x80"));
  assert(!ValidUtf8("\xf0\x9f\x98"));
  assert(!ValidUtf8("\xf4\x90\x80\x80"));
}
'''
        run_policy_program(compiler, code)

    def test_extension_engine_endpoints_admit_only_their_own_queries(self):
        compiler = shutil.which('clang++') or shutil.which('c++')
        if compiler is None:
            self.skipTest('C++ compiler is unavailable')
        code = r'''#include <cassert>
#include <optional>
#include <string>
#include <vector>
#include "ardia/linux/ac_linux_suggest_policy.h"
int main() {
  using namespace ardia::linux_suggest_policy;
  assert(SuggestionTemplateCandidate("https://ext.example/suggest?q=%s&client={google:clientName}") == "https://ext.example/suggest?q=q&client=");
  assert(SuggestionTemplateCandidate("https://ext.example/s?q=%s&lang={language}{inputEncoding}") == "https://ext.example/s?q=q&lang=");
  assert(SuggestionTemplateCandidate("https://ext.example/s/{a%b}?q=%s") == "https://ext.example/s/{a%b}?q=q");
  assert(SuggestionTemplateCandidate("https://ext.example/s?a=%s&b=%s") == "https://ext.example/s?a=q&b=q");
  assert(SuggestionTemplateCandidate("https://ext.example/s?q={x") == std::nullopt);
  assert(SuggestionTemplateCandidate("https://ext.example/s?q={searchTerms}") == std::nullopt);
  assert(SuggestionTemplateCandidate("https://ext.example/s?q=%S") == std::nullopt);
  assert(SuggestionTemplateCandidate("") == std::nullopt);
  assert(SuggestionTemplateCandidate("{google:baseURL}complete/search?q=%s") == std::nullopt);
  assert(SuggestionTemplateCandidate("{google:baseURL}https://ext.example/s?q=%s") == std::nullopt);
  assert(SuggestionTemplateCandidate("https://{google:host}/s?q=%s") == std::nullopt);
  assert(SuggestionTemplateCandidate("https://ext.{tld}/s?q=%s") == std::nullopt);
  assert(SuggestionTemplateCandidate("https://{x}ext.example?q=%s") == std::nullopt);
  assert(SuggestionTemplateCandidate("https://user{x}@ext.example/s?q=%s") == std::nullopt);
  assert(SuggestionTemplateCandidate("https://ext.example/s?q=%s" + std::string(kMaxRequestLength, 'a')) == std::nullopt);
  assert(EndpointAcceptable("https://ext.example/suggest"));
  assert(EndpointAcceptable("https://ext.example:8443/a%20b/"));
  assert(EndpointAcceptable("https://ext.example/"));
  assert(!EndpointAcceptable("http://ext.example/suggest"));
  assert(!EndpointAcceptable("https://ext.example"));
  assert(!EndpointAcceptable("https:///suggest"));
  assert(!EndpointAcceptable("https://user@ext.example/suggest"));
  assert(!EndpointAcceptable("https://ext%2eexample/suggest"));
  assert(!EndpointAcceptable("https://{host}/suggest"));
  assert(!EndpointAcceptable("https://ext.example/s{x}"));
  assert(!EndpointAcceptable("https://ext.example/s?q"));
  assert(!EndpointAcceptable("https://ext.example/s#q"));
  assert(!EndpointAcceptable("https://ext.example/s\\q"));
  assert(!EndpointAcceptable("https://ext.example/s q"));
  assert(!EndpointAcceptable(""));
  const std::vector<std::string> extension = {"https://ext.example/suggest"};
  assert(!RequestAllowed("https://ext.example/suggest?q=linux"));
  assert(RequestAllowed("https://ext.example/suggest?q=linux", extension));
  assert(RequestAllowed("https://duckduckgo.com/ac/?q=a", extension));
  assert(!RequestAllowed("https://ext.example/suggest", extension));
  assert(!RequestAllowed("https://ext.example/suggest?", extension));
  assert(!RequestAllowed("http://ext.example/suggest?q=a", extension));
  assert(!RequestAllowed("https://ext.example:444/suggest?q=a", extension));
  assert(!RequestAllowed("https://ext.example/suggestions?q=a", extension));
  assert(!RequestAllowed("https://ext.example/suggest/x?q=a", extension));
  assert(!RequestAllowed("https://ext.example/suggest/../collect?q=a", extension));
  assert(!RequestAllowed("https://ext.example/suggest%3F?q=a", extension));
  assert(!RequestAllowed("https://ext.example/suggest%2F..%2Fcollect?q=a", extension));
  assert(!RequestAllowed("https://ext.example.evil.example/suggest?q=a", extension));
  assert(!RequestAllowed("https://ext.example%2eevil.example/suggest?q=a", extension));
  assert(!RequestAllowed("https://user@ext.example/suggest?q=a", extension));
  assert(!RequestAllowed("https://ext.example@evil.example/suggest?q=a", extension));
  assert(!RequestAllowed("https://ext.example/suggest?q=a#x", extension));
  assert(!RequestAllowed("https://ext.example/suggest?q=a b", extension));
  assert(!RequestAllowed("https://ext.example/suggest?q=a\\b", extension));
  assert(!RequestAllowed("https://ext.example/suggest?q=" + std::string(kMaxRequestLength, 'a'), extension));
  const std::vector<std::string> lookalikes = {"http://ext.example/suggest", "https://ext.example", "https://user@ext.example/suggest", "https://ext.example/s?x", "https://{h}/s"};
  assert(!RequestAllowed("http://ext.example/suggest?q=a", lookalikes));
  assert(!RequestAllowed("https://ext.example?q=a", lookalikes));
  assert(!RequestAllowed("https://ext.example/?q=a", lookalikes));
  assert(!RequestAllowed("https://user@ext.example/suggest?q=a", lookalikes));
  assert(!RequestAllowed("https://ext.example/s?x?q=a", lookalikes));
  assert(!RequestAllowed("https://{h}/s?q=a", lookalikes));
}
'''
        run_policy_program(compiler, code)


def run_policy_program(compiler, code):
    with tempfile.TemporaryDirectory(prefix='ardia-suggest-policy-test-') as scratch:
        scratch = pathlib.Path(scratch)
        cpp = scratch / 'suggest.cc'
        cpp.write_text(code, encoding='latin-1')
        binary = scratch / 'suggest'
        compiled = subprocess.run([compiler, '-std=c++20', '-Wall', '-Werror', '-I', str(SOURCE), str(cpp), '-o', str(binary)], capture_output=True, text=True)
        if compiled.returncode != 0:
            raise AssertionError(compiled.stderr)
        subprocess.run([str(binary)], check=True)


if __name__ == '__main__':
    unittest.main()
