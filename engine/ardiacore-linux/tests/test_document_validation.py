import pathlib
import secrets
import shutil
import subprocess
import tempfile
import unittest

from test_session_merge import VALUES, WRITER, cpp_value

FIXTURE_TOKEN = secrets.token_hex(16)

SOURCE = pathlib.Path(__file__).resolve().parents[1] / 'src'


class DocumentValidationTests(unittest.TestCase):
    def test_rejected_operations_and_generation_limits_preserve_authority(self):
        folder = {'id': 'f', 'profileId': 'p', 'kind': 'documents', 'name': 'A', 'icon': None, 'collapsed': False, 'sources': [], 'filters': {'authored': True, 'reviewRequests': True}, 'createdAt': 0}
        identity = {'id': 'f', 'incarnation': 'folder:f'}
        stale = {'type': 'refresh', 'id': 'absent', 'incarnation': 'gone', 'generation': 0, 'owner': 'a', 'operations': []}
        operations = {
            'create': [{'type': 'create', **identity, 'value': folder}],
            'claim': [{'type': 'claim', **identity}],
            'rename': [{'type': 'field', 'target': 'folder', **identity, 'field': 'name', 'expected': 'A', 'value': 'B'}],
            'erase': [{'type': 'delete', **identity}],
            'calendar': [{'type': 'field', 'target': 'calendar', 'field': 'showPreview', 'expected': True, 'value': False}],
            'stale': [stale],
        }
        malformed = [
            [{'type': 'refresh', 'id': 'absent', 'token': FIXTURE_TOKEN}],
            [{**stale, 'operations': [{'type': 'unknown'}]}],
            [{**stale, 'owner': False}],
            [{**stale, 'orders': {'items': [7]}}],
            [{**stale, 'orders': {'unknown': []}}],
            [{**stale, 'operations': [{'type': 'member', 'target': 'known', 'id': 'absent', 'incarnation': 'gone', 'member': 'i', 'present': 'wrong'}]}],
            [{'type': 'create', **identity, 'value': {**folder, 'token': FIXTURE_TOKEN}}],
            [{'type': 'claim', 'id': 'absent', 'incarnation': 'gone', 'extra': True}],
            [{'type': 'delete', 'id': 'absent', 'incarnation': False}],
            [{'type': 'field', 'target': 'folder', 'id': 'absent', 'incarnation': 'gone', 'field': 'unknown', 'expected': None, 'value': 4}],
            [{'type': 'entry', 'target': 'items', 'id': 'absent', 'incarnation': 'gone', 'key': 'i', 'expected': None, 'value': {'id': 'i', 'source': 'github', 'token': FIXTURE_TOKEN}}],
            [{'type': 'place', 'id': 'absent', 'incarnation': 'gone', 'after': True, 'expected': None}],
            [stale, {'type': 'refresh', 'id': 'absent', 'token': FIXTURE_TOKEN}],
        ]
        main = r'''
#include <cassert>
#include <optional>
#include "ardia/linux/ac_linux_documents.h"
#include "ardia/linux/ac_linux_document_reducer.h"
using namespace ardia;
int main() {
'''
        main += '\n'.join(f'auto {name} = {cpp_value(value)};' for name, value in operations.items())
        main += '\nauto malformed = ' + cpp_value(malformed) + ';\n'
        main += r'''
for (int scenario = 0; scenario < 10; ++scenario) {
  std::optional<base::DictValue> disk;
  int writes = 0, events = 0;
  bool failed = false;
  auto read = [&](std::string_view name) { LinuxDocumentRead result; if (name == kLinuxLiveEnvelope && disk) { result.state = LinuxDocumentRead::State::kFound; result.value = disk->Clone(); } return result; };
  auto write = [&](const auto& envelope) { if (failed) return false; assert(ValidLinuxLiveEnvelope(envelope)); disk = envelope.Clone(); ++writes; return true; };
  LinuxDocuments service("scope", "epoch", read, write);
  LinuxDocumentClient a{"a", "scope", true, true}, b{"b", "scope", true, true};
  assert(service.Watch(a, [&](auto) { ++events; }).ok());
  assert(service.Watch(b, [](auto) {}).ok());
  auto commit = [&](const LinuxDocumentClient& client, int sequence, const base::Value& ops) {
    base::DictValue request;
    request.Set("document", "live.json"); request.Set("epoch", "epoch");
    request.Set("requestId", client.id + ":" + std::to_string(sequence));
    request.Set("observedRevision", base::Value(0)); request.Set("operations", ops.Clone());
    return service.Commit(client, request);
  };
  assert(commit(a, 1, create).ok());
  if (scenario == 0) {
    const auto original = disk->Clone();
    int saves = writes, notifications = events;
    for (const auto& ops : malformed.GetList()) {
      auto result = commit(a, 2, ops);
      assert(result.code == "ERR_DOCUMENT_REQUEST");
      assert(result.message.find("@FIXTURE_TOKEN@") == std::string::npos);
      assert(*disk == original && writes == saves && events == notifications);
    }
    assert(commit(a, 2, stale).value.Find("superseded")->GetBool());
    assert(commit(a, 3, calendar).ok());
    assert(ValidLinuxLiveEnvelope(*disk));
    continue;
  }
  if (scenario == 1) {
    assert(commit(a, 2, claim).ok());
    auto refusal = commit(b, 1, claim);
    assert(*refusal.value.FindString("reason") == "notOwner");
    assert(commit(b, 1, calendar).ok());
    base::ListValue mixed;
    mixed.Append(claim.GetList()[0].Clone()); mixed.Append(calendar.GetList()[0].Clone());
    auto before = disk->Clone();
    auto mixed_result = commit(b, 2, base::Value(std::move(mixed)));
    assert(*mixed_result.value.FindString("status") == "conflict" && !mixed_result.value.Find("reason"));
    assert(*disk == before);
    continue;
  }
  if (scenario == 8) {
    auto generations = disk->FindDict("generations")->Clone();
    generations.Set("f", base::Value(kLinuxLiveMaxGeneration - 1)); disk->Set("generations", std::move(generations));
    const auto before = disk->Clone(); int saves = writes, notifications = events;
    failed = true;
    assert(commit(a, 2, rename).code == "ERR_DOCUMENT_STORAGE");
    assert(*disk == before && writes == saves && events == notifications);
    failed = false;
    assert(commit(a, 2, rename).ok()); assert(ValidLinuxLiveEnvelope(*disk));
    assert(commit(a, 3, calendar).ok());
    continue;
  }
  if (scenario == 9) {
    auto clients = disk->FindDict("clients")->Clone(); auto receipt = clients.FindDict("a")->Clone();
    receipt.Set("sequence", base::Value(kLinuxLiveMaxGeneration));
    receipt.Set("requestId", "a:" + std::to_string(kLinuxLiveMaxGeneration));
    clients.Set("a", std::move(receipt)); disk->Set("clients", std::move(clients));
    assert(ValidLinuxLiveEnvelope(*disk)); const auto before = disk->Clone(); int saves = writes, notifications = events;
    assert(commit(a, kLinuxLiveMaxGeneration, create).ok());
    assert(*disk == before && writes == saves && events == notifications);
    continue;
  }
  bool owned = scenario >= 5;
  if (owned) assert(commit(a, 2, claim).ok());
  auto generations = disk->FindDict("generations")->Clone();
  generations.Set("f", base::Value(scenario == 7 ? kLinuxLiveMaxGeneration - 1 : kLinuxLiveMaxGeneration));
  disk->Set("generations", std::move(generations));
  assert(ValidLinuxLiveEnvelope(*disk));
  auto before = disk->Clone(); int saves = writes, notifications = events;
  if (scenario == 5) {
    LinuxDocuments recovered("scope", "new-epoch", read, write);
    assert(recovered.Watch(a, [](auto) {}).code == "ERR_DOCUMENT_LIMIT");
  } else if (scenario == 6) {
    service.Unwatch(a);
    assert(service.Watch(a, [](auto) {}).ok());
    assert(commit(a, 3, calendar).code == "ERR_DOCUMENT_LIMIT");
  } else if (scenario == 7) {
    failed = true; service.Unwatch(a); failed = false;
    assert(service.Watch(a, [](auto) {}).ok());
    assert(commit(a, 3, claim).code == "ERR_DOCUMENT_LIMIT");
  } else {
    const auto& operation = scenario == 2 ? rename : scenario == 3 ? erase : claim;
    assert(commit(a, 2, operation).code == "ERR_DOCUMENT_LIMIT");
  }
  assert(*disk == before && writes == saves && events == notifications);
  assert(ValidLinuxLiveEnvelope(*disk));
  if (scenario < 5) assert(commit(a, 2, calendar).ok());
}
}
'''
        with tempfile.TemporaryDirectory(prefix='ardia-document-validation-') as scratch:
            root = pathlib.Path(scratch)
            (root / 'base/json').mkdir(parents=True)
            (root / 'base/values.h').write_text(VALUES)
            (root / 'base/json/json_writer.h').write_text(WRITER)
            (root / 'main.cc').write_text(main.replace('@FIXTURE_TOKEN@', FIXTURE_TOKEN))
            compiler = shutil.which('clang++') or shutil.which('c++')
            binary = root / 'validation'
            result = subprocess.run([compiler, '-std=c++20', '-Wall', '-Wextra', '-Werror', '-I', str(root), '-I', str(SOURCE), *[str(SOURCE / 'ardia/linux' / name) for name in ['ac_linux_documents.cc', 'ac_linux_document_schema.cc', 'ac_linux_document_reducer.cc']], str(root / 'main.cc'), '-o', str(binary)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            result = subprocess.run([str(binary)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
