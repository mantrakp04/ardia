#include <cassert>
#include <string>

#include "ardia/linux/ac_linux_web_store_queue.h"

using namespace ardiacore;

namespace {

const std::string kA(32, 'a');
const std::string kB(32, 'b');

void Ids() {
  assert(LinuxWebStoreExtensionId(kA) && LinuxWebStoreExtensionId("abcdefghijklmnopabcdefghijklmnop"));
  assert(!LinuxWebStoreExtensionId(std::string(31, 'a')) && !LinuxWebStoreExtensionId(std::string(33, 'a')));
  assert(!LinuxWebStoreExtensionId(std::string(32, 'q')) && !LinuxWebStoreExtensionId(std::string(32, 'A')));
  assert(!LinuxWebStoreExtensionId(""));
}

void Queue() {
  LinuxWebStoreQueue queue;
  assert(queue.empty() && !queue.Claim(0) && !queue.NextExpiry());
  assert(!queue.Add("not-an-id"));
  auto first = queue.Add(kA);
  auto second = queue.Add(kB);
  assert(first && second && *first != *second && !queue.empty());
  assert(!queue.NextExpiry());
  assert(queue.Claim(10) == kA);
  assert(queue.NextExpiry() == 10 + kLinuxWebStoreClaimSeconds);
  assert(queue.Claim(11) == kB);
  assert(!queue.Claim(12));
  assert(queue.Expired(39).empty());
  auto expired = queue.Expired(40);
  assert(expired.size() == 1 && expired[0] == *first);
  assert(queue.NextExpiry() == 11 + kLinuxWebStoreClaimSeconds);
  auto removed = queue.Uninstalled(kB);
  assert(removed.size() == 1 && removed[0] == *second && queue.empty());
  assert(queue.Uninstalled(kB).empty());

  auto unclaimed = queue.Add(kA);
  auto again = queue.Add(kA);
  auto both = queue.Uninstalled(kA);
  assert(both.size() == 2 && both[0] == *unclaimed && both[1] == *again && queue.empty());

  auto forgotten = queue.Add(kA);
  queue.Forget(*forgotten);
  assert(queue.empty() && !queue.Claim(61));

  for (size_t i = 0; i < kLinuxWebStoreRequestsMax; ++i) assert(queue.Add(kA));
  assert(!queue.Add(kB));
  auto cleared = queue.Clear();
  assert(cleared.size() == kLinuxWebStoreRequestsMax && queue.empty());
}

}

int main(int argc, char** argv) {
  assert(argc == 2);
  const std::string mode = argv[1];
  if (mode == "ids") Ids();
  else if (mode == "queue") Queue();
  else return 2;
}
