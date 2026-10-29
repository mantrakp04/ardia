from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from document_host_fixture import ROOT, SOURCES, WRITER, values


MAIN = r'''
#include <cassert>
#include <iostream>
#include <memory>
#include <optional>
#include "ardia/linux/ac_linux_document_service.h"
#include "ardia/linux/ac_linux_document_reducer.h"
#include "base/json/json_writer.h"
using namespace ardia;

base::DictValue Subscription() {
  return base::DictValue().Set("document", "live.json");
}
base::DictValue Member(std::string member = "item") {
  return base::DictValue().Set("type", "member").Set("target", "hiddenCalendarIds")
      .Set("member", member).Set("present", base::Value(true));
}
base::DictValue Claim() {
  return base::DictValue().Set("type", "claim").Set("id", "lf-a").Set("incarnation", "folder:lf-a");
}
base::DictValue Rename(std::string expected = "original-name") {
  return base::DictValue().Set("type", "field").Set("target", "folder")
      .Set("id", "lf-a").Set("incarnation", "folder:lf-a").Set("field", "name")
      .Set("expected", expected).Set("value", "accepted-new-name");
}
base::DictValue Create() {
  auto folder = base::DictValue().Set("id", "lf-a").Set("profileId", "logical").Set("kind", "documents")
      .Set("name", "original-name").Set("icon", base::Value()).Set("collapsed", base::Value(false))
      .Set("sources", base::Value(base::ListValue())).Set("createdAt", base::Value(0))
      .Set("filters", base::DictValue().Set("authored", base::Value(true)).Set("reviewRequests", base::Value(true)));
  return base::DictValue().Set("type", "create").Set("id", "lf-a")
      .Set("incarnation", "folder:lf-a").Set("value", std::move(folder));
}
base::DictValue Request(const LinuxDocumentClient& client, int sequence, base::DictValue operation) {
  base::ListValue operations; operations.Append(base::Value(std::move(operation)));
  return base::DictValue().Set("document", "live.json").Set("epoch", "epoch")
      .Set("requestId", client.id + ":" + std::to_string(sequence)).Set("observedRevision", base::Value(0))
      .Set("operations", base::Value(std::move(operations)));
}
base::DictValue Mixed(const LinuxDocumentClient& client, int sequence) {
  auto request = Request(client, sequence, Claim());
  auto operations = request.FindList("operations")->Clone();
  operations.Append(base::Value(Rename()));
  request.Set("operations", base::Value(std::move(operations)));
  return request;
}
struct Harness {
  enum class Fault { kNone, kError, kCorrupt, kAuthority, kMissing } fault = Fault::kNone;
  std::optional<base::DictValue> disk;
  int reads = 0;
  int attempts = 0;
  int writes = 0;
  int events = 0;
  bool fail_write = false;
  std::unique_ptr<LinuxDocumentService> service;
  LinuxDocumentClient observer{"observer", "scope", true, true};
  LinuxDocumentClient a{"a", "scope", true, true};
  LinuxDocumentClient b{"b", "scope", true, true};
  Harness() {
    service = std::make_unique<LinuxDocumentService>("scope", "epoch",
        [&](std::string_view name) {
          ++reads;
          LinuxDocumentRead result;
          if (fault == Fault::kError) { result.state = LinuxDocumentRead::State::kError; return result; }
          if (name == kLinuxLiveEnvelope && disk && fault != Fault::kMissing) {
            result.state = LinuxDocumentRead::State::kFound;
            result.value = disk->Clone();
            if (fault == Fault::kCorrupt) result.value.Set("format", base::Value(2));
            if (fault == Fault::kAuthority) result.value.Set("epoch", "different-authority");
          }
          return result;
        }, [&](const base::DictValue& next) {
          ++attempts;
          if (fail_write) return false;
          assert(ValidLinuxLiveEnvelope(next));
          ++writes; disk = next.Clone(); return true;
        });
    Watch(observer); Watch(a); Watch(b);
  }
  void Watch(const LinuxDocumentClient& client) {
    assert(service->Dispatch("watch", client, Subscription(), [&](auto) { ++events; }).ok());
  }
  base::DictValue Snapshot() {
    auto result = service->Dispatch("watch", observer, Subscription(), [&](auto) { ++events; });
    assert(result.ok()); return std::move(result.value);
  }
  void Sync() {
    assert(ValidLinuxLiveEnvelope(*disk));
    assert(service->Dispatch("flush", observer, base::DictValue().Set("document", "live.json")
        .Set("epoch", "epoch").Set("watermark", base::Value(0)), [](auto) {}).ok());
  }
  LinuxDocumentDispatchResult Commit(const LinuxDocumentClient& client, const base::DictValue& request) {
    return service->DispatchTracked("commit", client, request.Clone(), [](auto) {});
  }
  void Seed() {
    assert(Commit(a, Request(a, 1, Create())).durability == LinuxDocumentDurability::kCommitted);
    assert(Commit(a, Request(a, 2, Claim())).durability == LinuxDocumentDurability::kCommitted);
  }
  LinuxDocumentResult Check(const LinuxDocumentClient& client, const base::DictValue& request,
                            bool admitted, std::string healthy_code = "",
                            LinuxDocumentDurability healthy_proof = LinuxDocumentDurability::kCommitted,
                            Fault failure = Fault::kError) {
    const auto before = Snapshot();
    const auto stored = disk->Clone();
    const int saves = writes, notifications = events, tried = attempts;
    fault = failure;
    for (int repeat = 0; repeat < 3; ++repeat) {
      const auto prior_reads = reads;
      auto dry = Commit(client, request);
      const bool attempted = dry.result.code == "ERR_DOCUMENT_STORAGE" || dry.result.code == "ERR_DOCUMENT_DATA";
      assert(reads == prior_reads + int(attempted));
      assert(dry.durability == (admitted ? LinuxDocumentDurability::kFailed : LinuxDocumentDurability::kUnchanged));
      assert(writes == saves && attempts == tried && events == notifications && *disk == stored);
      assert(Snapshot() == before);
    }
    fault = Fault::kNone;
    auto healthy = Commit(client, request);
    assert(healthy.result.code == healthy_code);
    const auto* status = healthy.result.value.FindString("status");
    assert(admitted == (healthy.result.ok() && status && *status == "committed"));
    assert(healthy.durability == (admitted ? healthy_proof : LinuxDocumentDurability::kUnchanged));
    if (!admitted || healthy_proof == LinuxDocumentDurability::kUnchanged)
      if (!admitted || *healthy.result.value.Find("superseded") == base::Value(false))
        assert(*disk == stored && writes == saves && events == notifications);
    return std::move(healthy.result);
  }
};

int main(int argc, char** argv) {
  assert(argc == 2);
  const std::string mode = argv[1];
  Harness h;
  if (mode == "retired-write" || mode == "retired-read" || mode == "retired-floor") {
    h.Seed();
    const int generation = LinuxDocumentInteger(*h.disk->FindDict("generations"), "lf-a");
    if (mode == "retired-read") h.fault = Harness::Fault::kError;
    else h.fail_write = true;
    h.service->Retire(h.a);
    if (mode == "retired-floor") h.service->Retire(h.a);
    h.fault = Harness::Fault::kNone; h.fail_write = false;
    assert(*h.disk->FindDict("owners")->FindString("lf-a") == h.a.id);
    auto result = h.Check(h.b, Mixed(h.b, 1), true);
    assert(!result.value.Find("superseded")->GetBool());
    assert(*h.disk->FindDict("payload")->FindDict("folders")->FindDict("lf-a")->FindString("name") == "accepted-new-name");
    assert(LinuxDocumentInteger(*h.disk->FindDict("generations"), "lf-a") == generation + (mode == "retired-floor" ? 4 : 3));
  }
  if (mode == "encoded-limit" || mode == "encoded-admitted") {
    auto payload = h.disk->FindDict("payload")->Clone();
    base::ListValue filler;
    for (int i = 0; i < 8100; ++i) filler.Append(base::Value(std::to_string(i) + std::string(1000, 'x')));
    payload.Set("dismissedAlerts", base::Value(std::move(filler))); h.disk->Set("payload", std::move(payload));
    const auto size = base::WriteJsonWithOptions(*h.disk, 2)->size();
    const size_t margin = mode == "encoded-limit" ? 100 : 1000;
    auto remaining = kLinuxLiveMaxBytes - size - margin;
    payload = h.disk->FindDict("payload")->Clone();
    auto more = payload.FindList("dismissedAlerts")->Clone();
    while (remaining > 4) {
      auto length = std::min(size_t(1024), remaining - 3);
      auto prefix = std::to_string(more.size());
      more.Append(base::Value(prefix + std::string(length - prefix.size(), 'z')));
      remaining -= length + 3;
    }
    payload.Set("dismissedAlerts", base::Value(std::move(more))); h.disk->Set("payload", std::move(payload));
    h.Sync();
    const auto bytes = base::WriteJsonWithOptions(*h.disk, 2)->size();
    assert(bytes < kLinuxLiveMaxBytes && bytes >= kLinuxLiveMaxBytes - margin - 4);
    const bool admitted = mode == "encoded-admitted";
    h.Check(h.a, Request(h.a, 1, Member()), admitted, admitted ? "" : "ERR_DOCUMENT_LIMIT");
  }
  if (mode == "mixed") {
    h.Seed();
    auto result = h.Check(h.b, Mixed(h.b, 1), false);
    assert(*result.value.FindString("status") == "conflict" && !result.value.Find("reason"));
    result = h.Check(h.b, Request(h.b, 1, Claim()), false);
    assert(*result.value.FindString("reason") == "notOwner");
    auto malformed = Mixed(h.b, 1);
    auto ops = malformed.FindList("operations")->Clone();
    ops.Append(base::Value(base::DictValue().Set("type", "unknown")));
    malformed.Set("operations", base::Value(std::move(ops)));
    h.Check(h.b, malformed, false, "ERR_DOCUMENT_REQUEST");
    h.service->Retire(h.a);
    h.Check(h.b, Mixed(h.b, 1), true);
  }
  if (mode == "sequence") {
    auto first = Request(h.a, 1, Member());
    assert(h.Commit(h.a, first).result.ok());
    h.Check(h.a, first, true, "", LinuxDocumentDurability::kUnchanged);
    h.Check(h.a, Request(h.a, 1, Member("different")), false, "ERR_DOCUMENT_REQUEST");
    h.Check(h.a, Request(h.a, 99, Member()), false, "ERR_DOCUMENT_REQUEST");
    auto receipt = h.disk->FindDict("clients")->FindDict(h.a.id)->Clone();
    receipt.Set("sequence", base::Value(2147483000)); receipt.Set("requestId", "a:2147483000");
    auto clients = h.disk->FindDict("clients")->Clone(); clients.Set(h.a.id, std::move(receipt));
    h.disk->Set("clients", std::move(clients)); h.Sync();
    h.Check(h.a, Request(h.a, 2147483001, Member()), false, "ERR_DOCUMENT_LIMIT");
    h.Check(h.a, Request(h.a, 2147483000, Member()), true, "", LinuxDocumentDurability::kUnchanged);
  }
  if (mode == "clients-full") {
    base::DictValue clients;
    for (int i = 0; i < 256; ++i) {
      const auto id = "old-" + std::to_string(i);
      const auto request = Request(LinuxDocumentClient{id, "scope", true, true}, 1, Member());
      clients.Set(id, base::DictValue().Set("sequence", base::Value(1))
          .Set("requestId", id + ":1").Set("operations", request.Find("operations")->Clone()));
    }
    h.disk->Set("clients", std::move(clients)); h.Sync();
    h.Check(h.a, Request(h.a, 1, Member()), false, "ERR_DOCUMENT_LIMIT");
    LinuxDocumentClient old{"old-1", "scope", true, true}; h.Watch(old);
    h.Check(old, Request(old, 1, Member()), true, "", LinuxDocumentDurability::kUnchanged);
  }
  if (mode == "epoch-auth-seal") {
    auto wrong_epoch = Request(h.a, 1, Member()); wrong_epoch.Set("epoch", "wrong-epoch");
    h.Check(h.a, wrong_epoch, false, "ERR_DOCUMENT_EPOCH");
    auto forged = h.a; forged.scope = "forged";
    h.Check(forged, Request(forged, 1, Member()), false, "ERR_DOCUMENT_AUTH");
    forged = h.a; forged.privileged = false;
    h.Check(forged, Request(forged, 1, Member()), false, "ERR_DOCUMENT_AUTH");
    h.service->Retire(h.b);
    h.Check(h.b, Request(h.b, 1, Member()), false, "ERR_DOCUMENT_AUTH");
    assert(h.service->Seal(h.a, "close-1", 0, true).ok());
    const auto reads = h.reads;
    h.Check(h.a, Request(h.a, 1, Member()), false, "ERR_DOCUMENT_CLOSING");
    assert(h.reads == reads);
    assert(h.service->CancelSeal(h.a, "close-1").ok());
    h.Check(h.a, Request(h.a, 1, Member()), true);
  }
  if (mode == "superseded") {
    auto refresh = base::DictValue().Set("type", "refresh").Set("id", "missing")
        .Set("incarnation", "gone").Set("owner", h.a.id).Set("generation", base::Value(1))
        .Set("operations", base::Value(base::ListValue()));
    auto request = Request(h.a, 1, std::move(refresh));
    auto result = h.Check(h.a, request, true, "", LinuxDocumentDurability::kUnchanged);
    assert(result.value.Find("superseded")->GetBool());
    result = h.Check(h.a, request, true, "", LinuxDocumentDurability::kUnchanged);
    assert(!result.value.Find("superseded")->GetBool());
  }
  if (mode == "generation-floors" || mode == "generation-exhaustion") {
    h.Seed();
    auto generations = h.disk->FindDict("generations")->Clone();
    generations.Set("lf-a", base::Value(mode == "generation-floors" ? kLinuxLiveMaxGeneration - 1 : kLinuxLiveMaxGeneration));
    h.disk->Set("generations", std::move(generations)); h.Sync();
    h.fail_write = true; h.service->Retire(h.a); h.fail_write = false;
    const auto reads = h.reads;
    h.Check(h.b, Mixed(h.b, 1), false, "ERR_DOCUMENT_LIMIT");
    if (mode == "generation-exhaustion") assert(h.reads == reads);
  }
  if (mode == "revision-full") {
    h.disk->Set("revision", base::Value(2147483647)); h.Sync();
    h.Check(h.a, Request(h.a, 1, Member()), false, "ERR_DOCUMENT_LIMIT");
  }
  if (mode == "read-faults") {
    int sequence = 0;
    for (auto fault : {Harness::Fault::kError, Harness::Fault::kCorrupt, Harness::Fault::kAuthority, Harness::Fault::kMissing}) {
      ++sequence;
      h.Check(h.a, Request(h.a, sequence, Member(std::to_string(sequence))), true, "", LinuxDocumentDurability::kCommitted, fault);
    }
  }
  if (mode == "write-faults") {
    h.Seed(); h.fail_write = true; h.service->Retire(h.a);
    const auto original = h.disk->Clone(); const auto before = h.Snapshot(); const auto notifications = h.events;
    auto request = Mixed(h.b, 1);
    for (int repeat = 0; repeat < 3; ++repeat) {
      auto failed = h.Commit(h.b, request);
      assert(failed.result.code == "ERR_DOCUMENT_STORAGE" && failed.durability == LinuxDocumentDurability::kFailed);
      assert(*h.disk == original && h.Snapshot() == before && h.events == notifications);
    }
    h.fail_write = false;
    assert(h.Commit(h.b, request).durability == LinuxDocumentDurability::kCommitted);
  }
  std::cout << mode << " shared_preparation_parity=1\n";
}
'''


class DocumentPreparationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.scratch = tempfile.TemporaryDirectory(prefix='ardia-document-preparation-')
        root = Path(cls.scratch.name)
        (root / 'base/json').mkdir(parents=True)
        (root / 'base/values.h').write_text(values())
        (root / 'base/json/json_writer.h').write_text(WRITER)
        (root / 'main.cc').write_text(MAIN)
        cls.binary = root / 'preparation'
        compiler = shutil.which('clang++') or shutil.which('c++')
        result = subprocess.run([compiler, '-std=c++23', '-Wall', '-Wextra', '-Werror', '-fsanitize=address,undefined', '-fno-omit-frame-pointer', '-I', str(root), '-I', str(ROOT / 'src'), *[str(ROOT / 'src/ardia/linux' / source) for source in SOURCES], str(root / 'main.cc'), '-o', str(cls.binary)], capture_output=True, text=True, timeout=90)
        if result.returncode:
            raise AssertionError(result.stdout + result.stderr)

    @classmethod
    def tearDownClass(cls):
        cls.scratch.cleanup()

    def run_mode(self, mode):
        result = subprocess.run([str(self.binary), mode], capture_output=True, text=True, timeout=45)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        print(result.stdout, end='')

    def test_retirement_write_failure_uses_actual_retired_owner_state(self):
        self.run_mode('retired-write')

    def test_retirement_read_failure_uses_actual_retired_client_state(self):
        self.run_mode('retired-read')

    def test_repeated_retirement_floor_dry_runs_do_not_advance_native_state(self):
        self.run_mode('retired-floor')

    def test_receipt_size_limit_refusal_is_identical_during_failed_read(self):
        self.run_mode('encoded-limit')

    def test_receipt_just_inside_limit_is_admitted_identically(self):
        self.run_mode('encoded-admitted')

    def test_atomic_mixed_operations_nonowner_conflict_and_malformed_are_unchanged(self):
        self.run_mode('mixed')

    def test_sequence_exhaustion_duplicate_and_reused_identity_parity(self):
        self.run_mode('sequence')

    def test_client_history_full_and_existing_duplicate_parity(self):
        self.run_mode('clients-full')

    def test_epoch_auth_subscription_and_seal_access_before_read_are_unchanged(self):
        self.run_mode('epoch-auth-seal')

    def test_superseded_and_duplicate_do_not_create_actual_write_proof(self):
        self.run_mode('superseded')

    def test_retired_generation_ceiling_remains_a_refusal(self):
        self.run_mode('generation-floors')

    def test_generation_exhaustion_flag_remains_read_free(self):
        self.run_mode('generation-exhaustion')

    def test_revision_exhaustion_is_not_failed_durable_intent(self):
        self.run_mode('revision-full')

    def test_read_error_corrupt_changed_authority_and_missing_data_do_not_advance_state(self):
        self.run_mode('read-faults')

    def test_failed_write_preparation_preserves_floors_until_real_persistence(self):
        self.run_mode('write-faults')
