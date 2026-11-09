// Copyright 2026 Ardia. Apache-2.0.

#include <algorithm>
#include <cmath>
#include <iterator>
#include <memory>
#include <optional>
#include <set>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "base/files/file_path.h"
#include "base/memory/weak_ptr.h"
#include "base/scoped_observation.h"
#include "base/strings/strcat.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/utf_string_conversions.h"
#include "base/task/single_thread_task_runner.h"
#include "base/time/time.h"
#include "base/uuid.h"
#include "chrome/browser/bookmarks/bookmark_html_writer.h"
#include "chrome/browser/bookmarks/bookmark_model_factory.h"
#include "chrome/browser/ardia/ac_engine.h"
#include "chrome/browser/profiles/profile.h"
#include "components/bookmarks/browser/bookmark_model.h"
#include "components/bookmarks/browser/bookmark_model_observer.h"
#include "components/bookmarks/browser/bookmark_node.h"
#include "components/bookmarks/browser/scoped_group_bookmark_actions.h"
#include "components/bookmarks/common/bookmark_metrics.h"
#include "url/gurl.h"

namespace ardia {

namespace {

constexpr char kSyncKey[] = "ac_sync_key";
constexpr int kMaxDepth = 512;

using bookmarks::BookmarkModel;
using bookmarks::BookmarkNode;

BookmarkModel* ModelFor(Profile* profile) {
  return profile && !profile->IsOffTheRecord()
             ? BookmarkModelFactory::GetForBrowserContext(profile)
             : nullptr;
}

double Ms(base::Time time) {
  return std::floor(time.InMillisecondsFSinceUnixEpoch());
}

std::optional<base::DictValue> NodeValue(const BookmarkNode* node, int depth) {
  if (depth > kMaxDepth) {
    return std::nullopt;
  }
  base::DictValue value;
  value.Set("id", node->uuid().AsLowercaseString());
  value.Set("t", base::UTF16ToUTF8(node->GetTitle()));
  value.Set("a", Ms(node->date_added()));
  std::string key;
  if (node->GetMetaInfo(kSyncKey, &key) && !key.empty()) {
    value.Set("key", key);
  }
  if (node->is_url()) {
    value.Set("k", "u");
    value.Set("u", node->url().spec());
    return value;
  }
  value.Set("k", "f");
  base::ListValue children;
  for (const auto& child : node->children()) {
    std::optional<base::DictValue> child_value =
        NodeValue(child.get(), depth + 1);
    if (!child_value) {
      return std::nullopt;
    }
    children.Append(std::move(*child_value));
  }
  value.Set("c", std::move(children));
  return value;
}

const BookmarkNode* Find(BookmarkModel* model, const std::string& id) {
  if (id == "bar") {
    return model->bookmark_bar_node();
  }
  if (id == "other") {
    return model->other_node();
  }
  base::Uuid uuid = base::Uuid::ParseLowercase(id);
  if (!uuid.is_valid()) {
    return nullptr;
  }
  return model->GetNodeByUuid(
      uuid, BookmarkModel::NodeTypeForUuidLookup::kLocalOrSyncableNodes);
}

bool IsAncestor(const BookmarkNode* node, const BookmarkNode* of) {
  for (const BookmarkNode* at = of; at; at = at->parent()) {
    if (at == node) {
      return true;
    }
  }
  return false;
}

class Watcher : public ProfileState, public bookmarks::BookmarkModelObserver {
 public:
  explicit Watcher(Profile* profile) : ProfileState(profile) {}

  void Start(BookmarkModel* model) {
    if (!observation_.IsObserving()) {
      observation_.Observe(model);
    }
  }

  void set_applying(bool applying) { applying_ = applying; }

  void BookmarkModelLoaded(bool) override { Changed(); }
  void BookmarkModelBeingDeleted() override { observation_.Reset(); }
  void BookmarkNodeMoved(const BookmarkNode*,
                         size_t,
                         const BookmarkNode*,
                         size_t) override {
    Changed();
  }
  void BookmarkNodeAdded(const BookmarkNode*, size_t, bool) override {
    Changed();
  }
  void BookmarkNodeRemoved(const BookmarkNode*,
                           size_t,
                           const BookmarkNode*,
                           const std::set<GURL>&,
                           const base::Location&) override {
    Changed();
  }
  void BookmarkNodeChanged(const BookmarkNode*) override { Changed(); }
  void BookmarkNodeFaviconChanged(const BookmarkNode*) override {}
  void BookmarkNodeChildrenReordered(const BookmarkNode*) override {
    Changed();
  }
  void BookmarkAllUserNodesRemoved(const std::set<GURL>&,
                                   const base::Location&) override {
    Changed();
  }

 private:
  void Changed() {
    if (applying_ || pending_) {
      return;
    }
    pending_ = true;
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(&Watcher::Send, weak_factory_.GetWeakPtr()));
  }

  void Release() override { observation_.Reset(); }

  void Send() {
    pending_ = false;
    Emit("bookmarks.changed", profile(), base::DictValue());
  }

  bool applying_ = false;
  bool pending_ = false;
  base::ScopedObservation<BookmarkModel, bookmarks::BookmarkModelObserver>
      observation_{this};
  base::WeakPtrFactory<Watcher> weak_factory_{this};
};

class WhenLoaded : public bookmarks::BookmarkModelObserver {
 public:
  static void Run(BookmarkModel* model, base::OnceClosure then) {
    if (model->loaded()) {
      return std::move(then).Run();
    }
    new WhenLoaded(model, std::move(then));
  }

  void BookmarkModelLoaded(bool) override {
    observation_.Reset();
    base::OnceClosure then = std::move(then_);
    delete this;
    std::move(then).Run();
  }
  void BookmarkModelBeingDeleted() override {
    observation_.Reset();
    delete this;
  }
  void BookmarkNodeMoved(const BookmarkNode*,
                         size_t,
                         const BookmarkNode*,
                         size_t) override {}
  void BookmarkNodeAdded(const BookmarkNode*, size_t, bool) override {}
  void BookmarkNodeRemoved(const BookmarkNode*,
                           size_t,
                           const BookmarkNode*,
                           const std::set<GURL>&,
                           const base::Location&) override {}
  void BookmarkNodeChanged(const BookmarkNode*) override {}
  void BookmarkNodeFaviconChanged(const BookmarkNode*) override {}
  void BookmarkNodeChildrenReordered(const BookmarkNode*) override {}
  void BookmarkAllUserNodesRemoved(const std::set<GURL>&,
                                   const base::Location&) override {}

 private:
  WhenLoaded(BookmarkModel* model, base::OnceClosure then)
      : then_(std::move(then)) {
    observation_.Observe(model);
  }

  base::OnceClosure then_;
  base::ScopedObservation<BookmarkModel, bookmarks::BookmarkModelObserver>
      observation_{this};
};

size_t Clamp(double index, const BookmarkNode* parent) {
  if (index < 0) {
    return 0;
  }
  return std::min(static_cast<size_t>(index), parent->children().size());
}

void MoveTo(BookmarkModel* model,
            const BookmarkNode* node,
            const BookmarkNode* parent,
            double index) {
  size_t at = Clamp(index, parent);
  if (node->parent() == parent) {
    const size_t current = static_cast<size_t>(*parent->GetIndexOf(node));
    if (current == at) {
      return;
    }
    if (at > current) {
      at++;
    }
  }
  model->Move(node, parent, std::min(at, parent->children().size()));
}

enum class Result { kApplied, kFailed, kInvalid };

struct BookmarkOp {
  enum class Kind { kAdd, kUpdate, kMove, kRemove };

  Kind kind;
  std::string id;
  std::optional<std::string> title;
  std::optional<std::string> url;
  std::optional<std::string> parent;
  std::optional<double> index;
  bool folder = false;
  bool if_absent = false;
  double added = 0;
  std::string key;
};

std::optional<BookmarkOp> ParseOp(const base::Value& value) {
  using KindName = std::pair<std::string_view, BookmarkOp::Kind>;
  static constexpr KindName kKinds[] = {
      {"add", BookmarkOp::Kind::kAdd},
      {"update", BookmarkOp::Kind::kUpdate},
      {"move", BookmarkOp::Kind::kMove},
      {"remove", BookmarkOp::Kind::kRemove},
  };
  const base::DictValue* dict = value.GetIfDict();
  const std::string* kind = dict ? dict->FindString("op") : nullptr;
  const std::string* id = dict ? dict->FindString("id") : nullptr;
  if (!kind || !id) {
    return std::nullopt;
  }
  const auto* known = std::ranges::find(kKinds, *kind, &KindName::first);
  if (known == std::end(kKinds)) {
    return std::nullopt;
  }
  auto string_at = [&](std::string_view key) -> std::optional<std::string> {
    const std::string* found = dict->FindString(key);
    return found ? std::optional<std::string>(*found) : std::nullopt;
  };
  BookmarkOp op{.kind = known->second, .id = *id};
  op.title = string_at("t");
  op.url = string_at("u");
  op.parent = string_at("parent");
  op.index = dict->FindDouble("index");
  op.folder = string_at("k") == "f";
  op.if_absent = dict->FindBool("ifAbsent").value_or(false);
  op.added = dict->FindDouble("a").value_or(0);
  op.key = string_at("key").value_or("");
  return op;
}

void Update(BookmarkModel* model,
            const BookmarkNode* node,
            const std::optional<std::string>& title,
            const std::optional<std::string>& url) {
  if (title) {
    model->SetTitle(node, base::UTF8ToUTF16(*title),
                    bookmarks::metrics::BookmarkEditSource::kOther);
  }
  if (url && node->is_url() && GURL(*url).is_valid()) {
    model->SetURL(node, GURL(*url),
                  bookmarks::metrics::BookmarkEditSource::kOther);
  }
}

Result Apply(BookmarkModel* model, const BookmarkOp& op) {
  using Kind = BookmarkOp::Kind;
  const BookmarkNode* node = Find(model, op.id);
  if (op.kind == Kind::kRemove) {
    if (!node || model->is_permanent_node(node)) {
      return Result::kFailed;
    }
    model->Remove(node, bookmarks::metrics::BookmarkEditSource::kOther,
                  FROM_HERE);
    return Result::kApplied;
  }
  if (op.kind == Kind::kUpdate) {
    if (!node || model->is_permanent_node(node)) {
      return Result::kFailed;
    }
    Update(model, node, op.title, op.url);
    return Result::kApplied;
  }
  const BookmarkNode* parent = op.parent ? Find(model, *op.parent) : nullptr;
  if (!parent || !parent->is_folder()) {
    return Result::kFailed;
  }
  const double index =
      op.index.value_or(static_cast<double>(parent->children().size()));
  if (op.kind == Kind::kMove) {
    if (!node || model->is_permanent_node(node) || IsAncestor(node, parent)) {
      return Result::kFailed;
    }
    MoveTo(model, node, parent, index);
    return Result::kApplied;
  }
  if (node && op.if_absent) {
    return Result::kApplied;
  }
  if (node) {
    if (model->is_permanent_node(node) || IsAncestor(node, parent)) {
      return Result::kFailed;
    }
    MoveTo(model, node, parent, index);
    Update(model, node, op.title.value_or(""), op.url.value_or(""));
    return Result::kApplied;
  }
  base::Uuid uuid = base::Uuid::ParseLowercase(op.id);
  if (!uuid.is_valid()) {
    return Result::kFailed;
  }
  std::optional<base::Time> created;
  if (op.added > 0) {
    created = base::Time::FromMillisecondsSinceUnixEpoch(op.added);
  }
  const size_t at = Clamp(index, parent);
  BookmarkNode::MetaInfoMap meta;
  if (!op.key.empty()) {
    meta[kSyncKey] = op.key;
  }
  const std::u16string title16 = base::UTF8ToUTF16(op.title.value_or(""));
  if (op.folder) {
    model->AddFolder(parent, at, title16, meta.empty() ? nullptr : &meta,
                     created, uuid);
    return Result::kApplied;
  }
  GURL gurl(op.url.value_or(""));
  if (!gurl.is_valid()) {
    return Result::kInvalid;
  }
  model->AddURL(parent, at, title16, gurl, meta.empty() ? nullptr : &meta,
                created, uuid);
  return Result::kApplied;
}

}

}

using ardia::Call;
using ardia::Reply;

AC_PROFILE_CALL(ac_bookmarks_tree) {
  bookmarks::BookmarkModel* model = ardia::ModelFor(call.profile());
  if (!model) {
    return call.TakeReply().Error("no bookmarks");
  }
  ardia::WhenLoaded::Run(
      model,
      base::BindOnce(
          [](base::WeakPtr<Profile> profile, Reply reply) {
            auto* model = profile ? ardia::ModelFor(profile.get()) : nullptr;
            if (!model) {
              return reply.Error("profile went away");
            }
            auto bar = ardia::NodeValue(model->bookmark_bar_node(), 0);
            auto other = ardia::NodeValue(model->other_node(), 0);
            if (!bar || !other) {
              return reply.Error("bookmarks nested too deep");
            }
            reply.Send(base::DictValue()
                           .Set("bar", std::move(*bar))
                           .Set("other", std::move(*other)));
          },
          call.profile()->GetWeakPtr(), call.TakeReply()));
}

AC_PROFILE_CALL(ac_bookmarks_apply) {
  bookmarks::BookmarkModel* model = ardia::ModelFor(call.profile());
  if (!model) {
    return call.TakeReply().Error("no bookmarks");
  }
  std::vector<ardia::BookmarkOp> ops;
  if (const base::ListValue* list = call.args().FindList("ops")) {
    for (const base::Value& value : *list) {
      std::optional<ardia::BookmarkOp> op = ardia::ParseOp(value);
      if (!op) {
        return call.TakeReply().Error(
            base::StrCat({"bad op at ", base::NumberToString(ops.size())}));
      }
      ops.push_back(std::move(*op));
    }
  }
  ardia::WhenLoaded::Run(
      model,
      base::BindOnce(
          [](base::WeakPtr<Profile> profile,
             std::vector<ardia::BookmarkOp> ops, Reply reply) {
            auto* model = profile ? ardia::ModelFor(profile.get()) : nullptr;
            if (!model) {
              return reply.Error("profile went away");
            }
            ardia::Watcher& watcher =
                ardia::StateFor<ardia::Watcher>(profile.get());
            watcher.set_applying(true);
            int applied = 0, skipped = 0;
            base::ListValue invalid;
            {
              bookmarks::ScopedGroupBookmarkActions group(model);
              for (const ardia::BookmarkOp& op : ops) {
                const ardia::Result result = ardia::Apply(model, op);
                if (result == ardia::Result::kApplied) {
                  applied++;
                } else if (result == ardia::Result::kInvalid) {
                  invalid.Append(op.id);
                } else {
                  break;
                }
              }
              skipped = static_cast<int>(ops.size()) - applied -
                        static_cast<int>(invalid.size());
            }
            watcher.set_applying(false);
            reply.Send(base::DictValue()
                           .Set("applied", applied)
                           .Set("skipped", skipped)
                           .Set("invalid", std::move(invalid)));
          },
          call.profile()->GetWeakPtr(), std::move(ops), call.TakeReply()));
}

AC_PROFILE_CALL(ac_bookmarks_watch) {
  bookmarks::BookmarkModel* model = ardia::ModelFor(call.profile());
  if (!model) {
    return call.TakeReply().Error("no bookmarks");
  }
  ardia::StateFor<ardia::Watcher>(call.profile()).Start(model);
  call.TakeReply().Ok();
}

AC_PROFILE_CALL(ac_bookmarks_export_html) {
  bookmarks::BookmarkModel* model = ardia::ModelFor(call.profile());
  if (!model) {
    return call.TakeReply().Error("no bookmarks");
  }
  const std::string path = call.String("path");
  if (path.empty() || path[0] != '/') {
    return call.TakeReply().Error("an absolute path required");
  }
  ardia::WhenLoaded::Run(
      model,
      base::BindOnce(
          [](base::WeakPtr<Profile> profile, base::FilePath path, Reply reply) {
            if (!profile || !ardia::ModelFor(profile.get())) {
              return reply.Error("profile went away");
            }
            bookmark_html_writer::WriteBookmarks(
                profile.get(), path,
                base::BindOnce(
                    [](Reply reply, bookmark_html_writer::Result result) {
                      if (result != bookmark_html_writer::Result::kSuccess) {
                        return reply.Error("couldn't write the file");
                      }
                      reply.Ok();
                    },
                    std::move(reply)));
          },
          call.profile()->GetWeakPtr(), base::FilePath(path),
          call.TakeReply()));
}
