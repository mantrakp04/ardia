import pathlib
import shutil
import subprocess
import tempfile
import unittest


SOURCE = pathlib.Path(__file__).resolve().parents[1] / 'src'

from support import VALUES, WRITER, cpp_string, cpp_value


CASES = [
    ('stale_url_independent_setting', {'tabs': {'a': {'url': 'old'}}, 'settings': {'dark': False}}, {'tabs': {'a': {'url': 'old'}}, 'settings': {'dark': True}}, {'tabs': {'a': {'url': 'new'}}, 'settings': {'dark': False}}, {'tabs': {'a': {'url': 'new'}}, 'settings': {'dark': True}}),
    ('two_windows', {'windows': {'one': {}}, 'windowOrder': ['one']}, {'windows': {'one': {}, 'two': {}}, 'windowOrder': ['one', 'two']}, {'windows': {'one': {}, 'three': {}}, 'windowOrder': ['one', 'three']}, {'windows': {'one': {}, 'two': {}, 'three': {}}, 'windowOrder': ['one', 'two', 'three']}),
    ('window_deletion', {'windows': {'one': {}, 'two': {}}, 'windowOrder': ['one', 'two']}, {'windows': {'two': {}}, 'windowOrder': ['two']}, {'windows': {'one': {}, 'two': {}, 'three': {}}, 'windowOrder': ['one', 'two', 'three']}, {'windows': {'two': {}, 'three': {}}, 'windowOrder': ['two', 'three']}),
    ('remote_removal_not_resurrected', {'order': ['a', 'b']}, {'order': ['b', 'a', 'c']}, {'order': ['a', 'd']}, {'order': ['a', 'c', 'd']}),
    ('local_reordering', {'order': ['a', 'b', 'c']}, {'order': ['c', 'b', 'a']}, {'order': ['a', 'b', 'c', 'd']}, {'order': ['c', 'b', 'a', 'd']}),
    ('independent_settings', {'settings': {'a': 0, 'b': 0}}, {'settings': {'a': 1, 'b': 0}}, {'settings': {'a': 0, 'b': 2, 'c': 3}}, {'settings': {'a': 1, 'b': 2, 'c': 3}}),
    ('scalar_conflict_local_wins', {'name': 'base'}, {'name': 'local'}, {'name': 'remote'}, {'name': 'local'}),
    ('unchanged_preserves_remote_type', {'v': {'a': 0}}, {'v': {'a': 0}}, {'v': 1}, {'v': 1}),
    ('edited_deleted_dict_complete', {'tabs': {'t': {'id': 't', 'url': 'old'}}}, {'tabs': {'t': {'id': 't', 'url': 'new'}}}, {'tabs': {}}, {'tabs': {'t': {'id': 't', 'url': 'new'}}}),
    ('closed_tab_identity', {'closedTabs': [{'tab': {'id': 't', 'title': 'old', 'url': 'old'}, 'closedAt': 1}]}, {'closedTabs': [{'tab': {'id': 't', 'title': 'local', 'url': 'old'}, 'closedAt': 1}, {'tab': {'id': 'l'}}]}, {'closedTabs': [{'tab': {'id': 't', 'title': 'old', 'url': 'remote'}, 'closedAt': 1}, {'tab': {'id': 'r'}}]}, {'closedTabs': [{'tab': {'id': 't', 'title': 'local', 'url': 'remote'}, 'closedAt': 1}, {'tab': {'id': 'l'}}, {'tab': {'id': 'r'}}]}),
    ('canonical_anonymous_identity', {'items': [{'a': 1, 'b': {'x': 2, 'y': 3}}]}, {'items': [{'b': {'y': 3, 'x': 2}, 'a': 1}, 'local']}, {'items': [{'a': 1, 'b': {'x': 2, 'y': 3}}, 'remote']}, {'items': [{'b': {'y': 3, 'x': 2}, 'a': 1}, 'local', 'remote']}),
    ('duplicate_ids_first_wins', {'items': [{'id': 't', 'x': 0}]}, {'items': [{'id': 't', 'x': 1}, {'id': 't', 'x': 9}]}, {'items': [{'id': 't', 'x': 2}, {'id': 'r'}, {'id': 'r', 'x': 9}]}, {'items': [{'id': 't', 'x': 1}, {'id': 'r'}]}),
    ('duplicate_cannot_resurrect_removed', {'items': [{'id': 't', 'x': 0}]}, {'items': [{'id': 't', 'x': 0}, {'id': 't', 'x': 9}]}, {'items': []}, {'items': []}),
    ('unchanged_array_preserves_current', {'order': ['a', 'b']}, {'order': ['a', 'b']}, {'order': ['b', 'a', 'c']}, {'order': ['b', 'a', 'c']}),
    ('primitive_identity_types', {'order': [1, '1', True, None]}, {'order': [None, 1, '1', True, 2]}, {'order': [1, '1', True, None, False]}, {'order': [None, 1, '1', True, 2, False]}),
    ('prototype_keys_removed', {}, {'safe': {'__proto__': {'bad': True}, 'constructor': 2, 'prototype': 3, 'keep': 1}}, {'__proto__': 4, 'remote': {'constructor': 1, 'keep': 2}}, {'safe': {'keep': 1}, 'remote': {'keep': 2}}),
    ('null_is_not_absence', {'a': 1, 'b': 1}, {'a': None}, {'a': 2, 'b': 2, 'c': 3}, {'a': None, 'c': 3}),
    ('concurrent_missing_dictionary', {}, {'settings': {'a': 1}}, {'settings': {'b': 2}}, {'settings': {'a': 1, 'b': 2}}),
    ('changed_array_remote_scalar', {'items': ['a']}, {'items': ['a', 'b']}, {'items': 0}, {'items': ['b']}),
    ('numeric_structural_equality', {'n': 1}, {'n': 1.0}, {'n': 2}, {'n': 2}),
]


class SessionMergeTests(unittest.TestCase):
    def test_real_session_merger_and_limits(self):
        compiler = shutil.which('clang++') or shutil.which('c++')
        if not compiler:
            self.skipTest('C++ compiler is unavailable')
        checks = '\n'.join('Check(' + cpp_string(name) + ', ' + ', '.join(cpp_value(value) for value in (base, local, current, expected)) + ');' for name, base, local, current, expected in CASES)
        main = r'''
#include <cassert>
#include <iostream>
#include <limits>
#include <type_traits>
#include "ardia/linux/ac_linux_session.h"
#include "base/json/json_writer.h"
static_assert(std::is_same_v<decltype(std::declval<base::DictValue&>().Set("x", base::Value())), base::Value*>);
static_assert(std::is_same_v<decltype(std::declval<base::ListValue&>().Append(base::Value())), void>);
void Check(const std::string& name, base::Value original, base::Value local,
           base::Value current, base::Value expected) {
  auto result = ardia::MergeLinuxSession(original.GetDict(), local.GetDict(), current.GetDict());
  if (!result || *result != expected.GetDict()) {
    std::cerr << name << " expected " << base::Encode(expected) << " got "
              << (result ? base::Encode(base::Value(result->Clone())) : "rejected") << '\n';
    std::abort();
  }
  auto repeated = ardia::MergeLinuxSession(original.GetDict(), local.GetDict(), *result);
  assert(repeated && *repeated == *result);
}
int main() {
''' + checks + r'''
  base::DictValue empty;
  base::Value deep;
  for (size_t i = 0; i < ardia::kLinuxSessionMaxDepth + 2; ++i) {
    base::DictValue next;
    next.Set("nested", std::move(deep));
    deep = base::Value(std::move(next));
  }
  assert(!ardia::ValidLinuxSession(deep.GetDict()));
  assert(!ardia::MergeLinuxSession(empty, deep.GetDict(), empty));
  base::DictValue large;
  large.Set("text", base::Value(std::string(ardia::kLinuxSessionMaxBytes + 1, 'a')));
  assert(!ardia::MergeLinuxSession(empty, large, empty));
  base::DictValue many;
  base::ListValue entries;
  for (size_t i = 0; i < ardia::kLinuxSessionMaxNodes; ++i) entries.Append(base::Value(1));
  many.Set("entries", base::Value(std::move(entries)));
  assert(!ardia::MergeLinuxSession(empty, many, empty));
  base::DictValue binary;
  binary.Set("blob", base::Value(base::BlobStorage{1, 2}));
  assert(!ardia::MergeLinuxSession(empty, binary, empty));
  base::DictValue nan;
  nan.Set("n", base::Value(std::numeric_limits<double>::quiet_NaN()));
  assert(!ardia::MergeLinuxSession(empty, nan, empty));
  base::DictValue encoded;
  encoded.Set("text", base::Value(std::string(ardia::kLinuxSessionMaxBytes / 5, '\0')));
  assert(!ardia::MergeLinuxSession(empty, encoded, empty));
  auto session_with = [](const char* table, base::DictValue entry) {
    base::DictValue session;
    session.Set(table, std::move(entry));
    return session;
  };
  base::DictValue public_window;
  public_window.Set("w", base::DictValue().Set("profileId", "default").Set("incognito", base::Value(false)).Set("title", "incognito: notes"));
  base::DictValue extension_settings;
  extension_settings.Set("extensions", base::DictValue().Set("x", base::DictValue().Set("incognito", base::Value(true))));
  base::DictValue public_session = session_with("windows", std::move(public_window));
  public_session.Set("settings", std::move(extension_settings));
  public_session.Set("lastProfileId", "p-work");
  assert(ardia::ValidLinuxSession(public_session));
  assert(ardia::MergeLinuxSession(empty, public_session, empty));
  base::DictValue private_window;
  private_window.Set("p", base::DictValue().Set("profileId", "incognito:p@").Set("incognito", base::Value(true)));
  assert(!ardia::MergeLinuxSession(empty, session_with("windows", std::move(private_window)), empty));
  base::DictValue flagged_window;
  flagged_window.Set("p", base::DictValue().Set("profileId", "default").Set("incognito", base::Value(true)));
  assert(!ardia::ValidLinuxSession(session_with("windows", std::move(flagged_window))));
  base::DictValue original_window;
  original_window.Set("p", base::DictValue().Set("profileId", "default").Set("originalProfileId", "default"));
  assert(!ardia::ValidLinuxSession(session_with("windows", std::move(original_window))));
  base::DictValue kind_window;
  kind_window.Set("p", base::DictValue().Set("profileId", "default").Set("kind", "private"));
  assert(!ardia::ValidLinuxSession(session_with("windows", std::move(kind_window))));
  base::DictValue main_window;
  main_window.Set("m", base::DictValue().Set("profileId", "default").Set("kind", "main"));
  assert(ardia::ValidLinuxSession(session_with("windows", std::move(main_window))));
  base::DictValue private_tab;
  private_tab.Set("t", base::DictValue().Set("profileId", "incognito:p@p-work").Set("url", "https://private.test"));
  assert(!ardia::MergeLinuxSession(empty, session_with("tabs", std::move(private_tab)), empty));
  base::DictValue private_profile;
  private_profile.Set("incognito:p@", base::DictValue());
  assert(!ardia::ValidLinuxSession(session_with("profiles", std::move(private_profile))));
  base::DictValue private_pins;
  private_pins.Set("incognito:p@", base::DictValue());
  assert(!ardia::ValidLinuxSession(session_with("parkedPins", std::move(private_pins))));
  base::DictValue order_session;
  order_session.Set("profileOrder", base::Value(base::ListValue().Append(base::Value("default")).Append(base::Value("incognito:p@"))));
  assert(!ardia::ValidLinuxSession(order_session));
  base::DictValue focus_session;
  focus_session.Set("lastProfileId", "incognito:p@");
  assert(!ardia::ValidLinuxSession(focus_session));
  base::DictValue closed_tab;
  closed_tab.Set("tab", base::DictValue().Set("profileId", "incognito:p@").Set("url", "https://private.test"));
  base::DictValue closed_session;
  closed_session.Set("closedTabs", base::Value(base::ListValue().Append(base::Value(std::move(closed_tab)))));
  assert(!ardia::MergeLinuxSession(empty, closed_session, empty));
  base::DictValue private_disk;
  private_disk.Set("t", base::DictValue().Set("profileId", "incognito:p@"));
  assert(!ardia::MergeLinuxSession(empty, empty, session_with("tabs", std::move(private_disk))));
  std::cout << "private_sessions=rejected\n";
}
'''
        with tempfile.TemporaryDirectory(prefix='ardia-session-merge-') as scratch:
            root = pathlib.Path(scratch)
            (root / 'base/json').mkdir(parents=True)
            (root / 'base/values.h').write_text(VALUES)
            (root / 'base/json/json_writer.h').write_text(WRITER)
            (root / 'main.cc').write_text(main)
            binary = root / 'session-merge'
            result = subprocess.run([compiler, '-std=c++20', '-Wall', '-Wextra', '-Werror', '-I', str(root), '-I', str(SOURCE), str(SOURCE / 'ardia/linux/ac_linux_session.cc'), str(root / 'main.cc'), '-o', str(binary)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            result = subprocess.run([str(binary)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn('private_sessions=rejected', result.stdout)

    def test_real_file_worker_and_source_independent_delivery(self):
        compiler = shutil.which('clang++') or shutil.which('c++')
        if not compiler:
            self.skipTest('C++ compiler is unavailable')
        host = (SOURCE / 'ardia/linux/ac_linux_host.cc').read_text()

        def extract(token):
            start = host.index(token)
            brace = host.index('{', start)
            end = brace + 1
            depth = 1
            while depth:
                depth += (host[end] == '{') - (host[end] == '}')
                end += 1
            return host[start:end]

        worker = '\n'.join(extract(token) for token in [
            'std::optional<base::DictValue> ReadSession(',
            'struct SessionWriteResult {',
            'SessionWriteResult MergeAndWriteSession(',
        ]).replace('base::DictValue session;\n}', 'base::DictValue session;\n};')
        callback = extract('[](base::FilePath profile_path, std::string source_window,')
        writer = WRITER.replace('inline std::optional<std::string> WriteJsonWithOptions',
                                'inline std::map<std::string, Value> fixture_json;\ninline std::optional<std::string> WriteJsonWithOptions')
        writer = writer.replace('return Encode(value.Clone());',
                                'auto copy = value.Clone(); auto text = Encode(copy); fixture_json.insert_or_assign(text, std::move(copy)); return text;')
        reader = r'''
#pragma once
#include <functional>
#include "base/json/json_writer.h"
namespace base {
using FilePath = std::string;
inline constexpr int JSON_PARSE_RFC = 0;
struct JSONReader {
  static std::optional<Value> Read(std::string_view text, int, size_t) {
    auto found = fixture_json.find(std::string(text));
    return found == fixture_json.end() ? std::nullopt : std::make_optional(found->second.Clone());
  }
};
template<typename T> class OnceCallback;
template<> class OnceCallback<void(bool, Value)> {
 public:
  explicit OnceCallback(std::function<void(bool, Value)> fn) : fn_(std::move(fn)) {}
  OnceCallback(OnceCallback&&) = default;
  OnceCallback(const OnceCallback&) = delete;
  void Run(bool ok, Value value) { std::exchange(fn_, {})(ok, std::move(value)); }
 private:
  std::function<void(bool, Value)> fn_;
};
}
'''
        prelude = r'''
#include <cassert>
#include <iostream>
#include "ardia/linux/ac_linux_session.h"
#include "base/json/json_reader.h"
namespace ardia {
constexpr char kSessionName[] = "linux-session.json";
std::optional<std::string> document;
bool write_failed = false;
std::optional<std::string> ReadDocument(const base::FilePath&, const std::string& name) {
  assert(name == kSessionName);
  return document && document->size() <= kLinuxSessionMaxBytes ? document : std::nullopt;
}
bool WriteDocument(const base::FilePath&, const std::string& name, const std::optional<std::string>& text) {
  assert(name == kSessionName);
  if (write_failed) return false;
  document = text;
  return true;
}
'''
        support = r'''
struct Profile {
  base::FilePath path;
  bool private_profile = false;
  bool IsOffTheRecord() const { return private_profile; }
  const base::FilePath& GetPath() const { return path; }
};
std::vector<std::string> order;
struct ShellHostView {
  Profile* value;
  std::vector<base::Value> events;
  std::string identifier = "peer";
  Profile* profile() { return value; }
  const std::string& window_id() const { return identifier; }
  void Event(std::string_view module, std::string_view event, base::Value payload) {
    assert(module == "ArdiaHost" && event == "session");
    order.push_back("event");
    events.push_back(std::move(payload));
  }
};
std::map<int, ShellHostView*> hosts;
auto& Hosts() { return hosts; }
}
'''
        first = {'tabs': {'a': {'url': 'old'}}, 'settings': {'theme': 'old'}}
        nav = {'tabs': {'a': {'url': 'new'}}, 'settings': {'theme': 'old'}}
        theme = {'tabs': {'a': {'url': 'old'}}, 'settings': {'theme': 'new'}}
        expected = {'tabs': {'a': {'url': 'new'}}, 'settings': {'theme': 'new'}}
        main = prelude + worker + support + '\nint main() {\nusing namespace ardia;\n'
        main += '\n'.join(f'auto {name} = {cpp_value(value)};' for name, value in [('original', first), ('nav', nav), ('theme', theme), ('expected', expected)])
        main += r'''
  document = base::WriteJsonWithOptions(original, 2);
  auto first = MergeAndWriteSession("/Profile/Ardia", original.GetDict().Clone(), nav.GetDict().Clone());
  assert(first.ok && first.previous == original.GetDict() && first.session == nav.GetDict());
  auto second = MergeAndWriteSession("/Profile/Ardia", original.GetDict().Clone(), theme.GetDict().Clone());
  assert(second.ok && second.previous == nav.GetDict() && second.session == expected.GetDict());
  auto final = MergeAndWriteSession("/Profile/Ardia", original.GetDict().Clone(), theme.GetDict().Clone());
  assert(final.ok && final.previous == expected.GetDict() && final.session == expected.GetDict());
  document = "malformed";
  assert(!ReadSession("/Profile/Ardia"));
  auto recovered = MergeAndWriteSession("/Profile/Ardia", base::DictValue(), nav.GetDict().Clone());
  assert(recovered.ok && recovered.previous.size() == 0 && recovered.session == nav.GetDict());
  document = base::WriteJsonWithOptions(base::Value(base::ListValue()), 2);
  assert(!ReadSession("/Profile/Ardia"));
  document = std::string(kLinuxSessionMaxBytes + 1, 'x');
  assert(!ReadSession("/Profile/Ardia"));
  document = base::WriteJsonWithOptions(original, 2);
  write_failed = true;
  auto failed = MergeAndWriteSession("/Profile/Ardia", original.GetDict().Clone(), nav.GetDict().Clone());
  assert(!failed.ok);
  write_failed = false;
  Profile regular{"/Profile"};
  Profile other{"/Other"};
  Profile private_profile{"/Profile", true};
  ShellHostView peer{&regular, {}};
  ShellHostView outsider{&other, {}};
  ShellHostView incognito{&private_profile, {}};
  ShellHostView closed{nullptr, {}};
  hosts = {{1, &peer}, {2, &outsider}, {3, &incognito}, {4, &closed}};
  auto deliver =
''' + callback + r''';
  bool replied = false;
  deliver("/Profile", "closed-source-window", theme.GetDict().Clone(),
          base::OnceCallback<void(bool, base::Value)>([&](bool ok, base::Value value) {
            assert(ok && value.GetDict() == expected.GetDict());
            replied = true;
            order.push_back("reply");
          }), std::move(second));
  assert(replied && order == std::vector<std::string>({"reply", "event"}));
  assert(peer.events.size() == 1 && outsider.events.empty() && incognito.events.empty() && closed.events.empty());
  const auto& event = peer.events.front().GetDict();
  assert(event.Find("base")->GetDict() == nav.GetDict());
  assert(event.Find("session")->GetDict() == expected.GetDict());
  assert(*event.FindString("sourceWindowId") == "closed-source-window");
  order.clear();
  SessionWriteResult orphaned;
  orphaned.ok = true;
  orphaned.previous = original.GetDict().Clone();
  orphaned.session = expected.GetDict().Clone();
  deliver("/Profile", "destroyed-source", expected.GetDict().Clone(),
          base::OnceCallback<void(bool, base::Value)>([](bool, base::Value) {}), std::move(orphaned));
  assert(order == std::vector<std::string>({"event"}));
  assert(peer.events.size() == 2);
  order.clear();
  deliver("/Profile", "closed-source-window", theme.GetDict().Clone(),
          base::OnceCallback<void(bool, base::Value)>([](bool ok, base::Value) { assert(ok); order.push_back("reply"); }), std::move(final));
  assert(order == std::vector<std::string>({"reply"}) && peer.events.size() == 2);
  ShellHostView source{&regular, {}, "writer"};
  hosts[5] = &source;
  SessionWriteResult changed;
  changed.ok = true;
  changed.previous = original.GetDict().Clone();
  changed.session = expected.GetDict().Clone();
  deliver("/Profile", "writer", nav.GetDict().Clone(),
          base::OnceCallback<void(bool, base::Value)>([](bool ok, base::Value) { assert(ok); }), std::move(changed));
  assert(source.events.size() == 1 && peer.events.size() == 3);
  assert(source.events.back().GetDict().Find("base")->GetDict() == nav.GetDict());
  assert(peer.events.back().GetDict().Find("base")->GetDict() == original.GetDict());
  assert(source.events.back().GetDict().Find("session")->GetDict() == expected.GetDict());
}
'''
        with tempfile.TemporaryDirectory(prefix='ardia-session-worker-') as scratch:
            root = pathlib.Path(scratch)
            (root / 'base/json').mkdir(parents=True)
            (root / 'base/values.h').write_text(VALUES)
            (root / 'base/json/json_writer.h').write_text(writer)
            (root / 'base/json/json_reader.h').write_text(reader)
            (root / 'worker.cc').write_text(main)
            binary = root / 'session-worker'
            result = subprocess.run([compiler, '-std=c++20', '-Wall', '-Wextra', '-Werror', '-I', str(root), '-I', str(SOURCE), str(SOURCE / 'ardia/linux/ac_linux_session.cc'), str(root / 'worker.cc'), '-o', str(binary)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            result = subprocess.run([str(binary)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
