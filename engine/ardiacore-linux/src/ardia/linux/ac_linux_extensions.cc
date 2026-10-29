#include "ardia/linux/ac_linux_extensions.h"

#include <algorithm>
#include <array>
#include <cctype>

namespace ardia::linux_extensions {
namespace {

bool Only(const base::DictValue& input, std::initializer_list<std::string_view> keys) {
  if (input.size() != keys.size()) return false;
  for (const auto key : keys) {
    if (!input.contains(key)) return false;
  }
  return true;
}

bool IdField(const base::DictValue& input, std::string_view key) {
  const std::string* id = input.FindString(key);
  return id && ValidExtensionId(*id);
}

bool BoolField(const base::DictValue& input, std::string_view key) {
  const base::Value* value = input.Find(key);
  return value && value->is_bool();
}

bool TabKey(const base::DictValue& input, std::string_view key) {
  const std::string* tab = input.FindString(key);
  return tab && !tab->empty() && tab->size() <= kMaxTabKey && tab->find('\0') == std::string::npos;
}

std::optional<std::string> Text(const base::DictValue& dict, std::string_view key) {
  const std::string* value = dict.FindString(key);
  return value ? std::optional<std::string>(*value) : std::nullopt;
}

std::optional<std::string> NonEmpty(const base::DictValue& dict, std::string_view key) {
  const std::string* value = dict.FindString(key);
  return value && !value->empty() ? std::optional<std::string>(*value) : std::nullopt;
}

std::vector<std::string> Strings(const base::Value* list) {
  std::vector<std::string> out;
  if (!list || !list->is_list()) return out;
  for (const auto& item : list->GetList()) {
    if (item.is_string()) out.push_back(item.GetString());
  }
  return out;
}

bool HostPattern(std::string_view text) {
  return text == "<all_urls>" || text.find("://") != std::string_view::npos;
}

void AddUnique(std::vector<std::string>& list, const std::string& value) {
  if (std::find(list.begin(), list.end(), value) == list.end()) list.push_back(value);
}

int IconSize(std::string_view key) {
  if (key.empty() || key.size() > 5) return 0;
  int size = 0;
  for (const char c : key) {
    if (c < '0' || c > '9') return 0;
    size = size * 10 + (c - '0');
  }
  return size;
}

base::Value Nullable(const std::optional<std::string>& value) {
  return value ? base::Value(*value) : base::Value();
}

base::ListValue List(const std::vector<std::string>& values) {
  base::ListValue list;
  for (const auto& value : values) list.Append(base::Value(value));
  return list;
}

std::string Lower(std::string_view text) {
  std::string out(text);
  for (char& c : out) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  return out;
}

}

bool ValidExtensionId(std::string_view id) {
  return id.size() == 32 && std::all_of(id.begin(), id.end(), [](char c) { return c >= 'a' && c <= 'p'; });
}

bool ValidFolderPath(std::string_view path) {
  if (path.empty() || path.size() > kMaxPathBytes || path.front() != '/' || path.find('\0') != std::string_view::npos)
    return false;
  if (path.size() > 1 && path.back() == '/') return false;
  size_t start = 1;
  while (start <= path.size()) {
    const size_t end = std::min(path.find('/', start), path.size());
    const std::string_view part = path.substr(start, end - start);
    if (path.size() > 1 && (part.empty() || part == "." || part == "..")) return false;
    start = end + 1;
  }
  return true;
}

bool LinuxHandles(std::string_view name) {
  return name.starts_with("extensions.") || name == "search.engines";
}

bool UsesWindowProfile(std::string_view name) {
  return name == "extensions.actionStates" || name == "extensions.sidePanelUrl" ||
         name == "extensions.resolveInstallPrompt";
}

PrivateRoute PrivateWindowRoute(std::string_view name, bool ending) {
  const bool served = ServesPrivateWindow(name) || name == "extensions.watchActions" || name == "extensions.list";
  if (!served) return PrivateRoute::kRefused;
  if (ending) return PrivateRoute::kEnding;
  return ServesPrivateWindow(name) ? PrivateRoute::kWindow : PrivateRoute::kOriginal;
}

bool ServesPrivateWindow(std::string_view name) {
  return name == "extensions.actionStates" || name == "extensions.sidePanelUrl";
}

std::optional<base::DictValue> Configuration(const base::DictValue& input) {
  const auto* id = input.FindString("id");
  const auto* options = input.FindDict("options");
  if (input.size() != 2 || !id || !ValidExtensionId(*id) || !options || options->size() == 0) return std::nullopt;
  base::DictValue result;
  result.Set("id", *id);
  for (auto it = options->begin(); it != options->end(); ++it) {
    const std::string& key = (*it).first;
    const base::Value& value = (*it).second;
    if (key == "pinned" || key == "fileAccess" || key == "incognito" || key == "userScripts") {
      if (!value.is_bool()) return std::nullopt;
    } else if (key == "siteAccess") {
      if (!value.is_string() ||
          (value.GetString() != "allSites" && value.GetString() != "specificSites" && value.GetString() != "onClick"))
        return std::nullopt;
    } else {
      return std::nullopt;
    }
    result.Set(key, value.Clone());
  }
  return result;
}

bool ReloadsExtensionFolder(std::string_view name, const base::DictValue& input) {
  if (name == "extensions.reload") return true;
  if (name != "extensions.configure") return false;
  const auto configured = Configuration(input);
  return configured && (configured->contains("incognito") || configured->contains("fileAccess"));
}

std::string ValidateRequest(std::string_view name, const base::DictValue& input) {
  if (name == "extensions.list" || name == "extensions.watchActions" || name == "extensions.chooseFolder" ||
      name == "extensions.syncState" || name == "search.engines") {
    return input.size() == 0 ? "" : "This call takes no arguments";
  }
  if (name == "extensions.install" || name == "extensions.installCrx" || name == "extensions.inspectUnpacked") {
    const std::string* path = input.FindString("path");
    return Only(input, {"path"}) && path && ValidFolderPath(*path) ? "" : "An absolute, normalized path is required";
  }
  if (name == "extensions.setEnabled") {
    return Only(input, {"id", "enabled"}) && IdField(input, "id") && BoolField(input, "enabled")
               ? ""
               : "An extension id and a boolean are required";
  }
  if (name == "extensions.uninstall" || name == "extensions.reload") {
    return Only(input, {"id"}) && IdField(input, "id") ? "" : "An extension id is required";
  }
  if (name == "extensions.configure") {
    return Configuration(input) ? "" : "Unsupported or invalid extension options";
  }
  if (name == "extensions.resolveInstallPrompt") {
    const std::string* id = input.FindString("requestId");
    return Only(input, {"requestId", "accepted"}) && id && !id->empty() && id->size() <= kMaxRequestId &&
                   BoolField(input, "accepted")
               ? ""
               : "A request id and a boolean answer are required";
  }
  if (name == "extensions.actionStates") {
    const base::Value* ids = input.Find("ids");
    if (!Only(input, {"tabId", "ids"}) || !TabKey(input, "tabId") || !ids || !ids->is_list() ||
        ids->GetList().size() > kMaxActionIds)
      return "A tab and at most 64 extension ids are required";
    for (const auto& id : ids->GetList()) {
      if (!id.is_string() || !ValidExtensionId(id.GetString())) return "Invalid extension id";
    }
    return "";
  }
  if (name == "extensions.sidePanelUrl") {
    return Only(input, {"tabId", "extensionId"}) && TabKey(input, "tabId") && IdField(input, "extensionId")
               ? ""
               : "A tab and an extension id are required";
  }
  if (name == "extensions.syncApply") return "";
  return "This extension call is unavailable on Linux";
}

std::optional<std::string> IconPath(const base::Value* icons, int size) {
  if (!icons) return std::nullopt;
  if (icons->is_string()) return icons->GetString().empty() ? std::nullopt : std::optional<std::string>(icons->GetString());
  if (!icons->is_dict()) return std::nullopt;
  std::optional<std::string> best;
  int best_size = 0;
  for (auto it = icons->GetDict().begin(); it != icons->GetDict().end(); ++it) {
    const std::string& key = (*it).first;
    const base::Value& value = (*it).second;
    const int s = IconSize(key);
    if (!value.is_string() || value.GetString().empty() || s <= 0) continue;
    const bool better = !best || (best_size < size ? s > best_size : (s >= size && s < best_size));
    if (better) {
      best = value.GetString();
      best_size = s;
    }
  }
  return best;
}

ManifestFacts ReadManifest(const base::DictValue& manifest) {
  ManifestFacts facts;
  facts.name = Text(manifest, "name").value_or("");
  facts.short_name = Text(manifest, "short_name");
  facts.version = Text(manifest, "version").value_or("");
  facts.description = Text(manifest, "description").value_or("");
  if (const base::Value* version = manifest.Find("manifest_version"); version && version->is_int())
    facts.manifest_version = version->GetInt();
  facts.icon_path = IconPath(manifest.Find("icons"), 128);
  for (const auto& permission : Strings(manifest.Find("permissions"))) {
    if (HostPattern(permission)) AddUnique(facts.host_permissions, permission);
    else facts.permissions.push_back(permission);
  }
  for (const auto& host : Strings(manifest.Find("host_permissions"))) AddUnique(facts.host_permissions, host);
  if (const base::Value* scripts = manifest.Find("content_scripts"); scripts && scripts->is_list()) {
    for (const auto& script : scripts->GetList()) {
      if (!script.is_dict()) continue;
      for (const auto& match : Strings(script.GetDict().Find("matches"))) AddUnique(facts.host_permissions, match);
    }
  }
  facts.optional_permissions = Strings(manifest.Find("optional_permissions"));
  const base::DictValue* action = nullptr;
  for (const auto key : {"action", "browser_action", "page_action"}) {
    if ((action = manifest.FindDict(key))) break;
  }
  facts.has_action = action != nullptr;
  if (action) {
    facts.popup = NonEmpty(*action, "default_popup");
    facts.action_title = Text(*action, "default_title");
    facts.action_icon_path = IconPath(action->Find("default_icon"), 32);
  }
  if (!facts.action_icon_path) facts.action_icon_path = IconPath(manifest.Find("icons"), 32);
  const base::DictValue* options = manifest.FindDict("options_ui");
  facts.options_page = options ? NonEmpty(*options, "page") : NonEmpty(manifest, "options_page");
  if (const base::DictValue* panel = manifest.FindDict("side_panel")) facts.side_panel = NonEmpty(*panel, "default_path");
  const std::string* incognito = manifest.FindString("incognito");
  facts.incognito_split = incognito && *incognito == "split";
  facts.homepage = NonEmpty(manifest, "homepage_url");
  return facts;
}

std::optional<std::string> ResourcePath(std::string_view relative) {
  while (!relative.empty() && relative.front() == '/') relative.remove_prefix(1);
  if (relative.empty() || relative.size() > 1024 || relative.find('\0') != std::string_view::npos ||
      relative.find('\\') != std::string_view::npos)
    return std::nullopt;
  std::string out;
  size_t start = 0;
  while (start <= relative.size()) {
    const size_t end = std::min(relative.find('/', start), relative.size());
    const std::string_view part = relative.substr(start, end - start);
    if (part == "..") return std::nullopt;
    if (!part.empty() && part != ".") {
      if (!out.empty()) out += '/';
      out += part;
    }
    start = end + 1;
  }
  return out.empty() ? std::nullopt : std::optional<std::string>(out);
}

std::string ImageMimeType(std::string_view path) {
  const size_t dot = path.rfind('.');
  if (dot == std::string_view::npos || path.find('/', dot) != std::string_view::npos) return "";
  const std::string ext = Lower(path.substr(dot + 1));
  static constexpr std::array<std::pair<std::string_view, std::string_view>, 8> kTypes = {{
      {"png", "image/png"}, {"jpg", "image/jpeg"}, {"jpeg", "image/jpeg"}, {"gif", "image/gif"},
      {"svg", "image/svg+xml"}, {"webp", "image/webp"}, {"ico", "image/x-icon"}, {"bmp", "image/bmp"},
  }};
  for (const auto& [suffix, type] : kTypes) {
    if (ext == suffix) return std::string(type);
  }
  return "";
}

std::string Base64(std::string_view bytes) {
  static constexpr char kAlphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string out;
  out.reserve((bytes.size() + 2) / 3 * 4);
  size_t i = 0;
  for (; i + 2 < bytes.size(); i += 3) {
    const uint32_t n = (static_cast<uint8_t>(bytes[i]) << 16) | (static_cast<uint8_t>(bytes[i + 1]) << 8) |
                       static_cast<uint8_t>(bytes[i + 2]);
    out += kAlphabet[(n >> 18) & 63];
    out += kAlphabet[(n >> 12) & 63];
    out += kAlphabet[(n >> 6) & 63];
    out += kAlphabet[n & 63];
  }
  if (i < bytes.size()) {
    uint32_t n = static_cast<uint8_t>(bytes[i]) << 16;
    if (i + 1 < bytes.size()) n |= static_cast<uint8_t>(bytes[i + 1]) << 8;
    out += kAlphabet[(n >> 18) & 63];
    out += kAlphabet[(n >> 12) & 63];
    out += i + 1 < bytes.size() ? kAlphabet[(n >> 6) & 63] : '=';
    out += '=';
  }
  return out;
}

std::string DataUrl(std::string_view path, std::string_view bytes) {
  const std::string type = ImageMimeType(path);
  if (type.empty() || bytes.empty() || bytes.size() > kMaxIconBytes) return "";
  return "data:" + type + ";base64," + Base64(bytes);
}

std::optional<base::ListValue> Entries(const base::Value& reply) {
  if (!reply.is_dict()) return std::nullopt;
  const base::Value* list = reply.GetDict().Find("extensions");
  if (!list || !list->is_list()) return std::nullopt;
  base::ListValue entries;
  for (const auto& entry : list->GetList()) {
    if (!entry.is_dict()) return std::nullopt;
    const std::string* id = entry.GetDict().FindString("id");
    if (!id || !ValidExtensionId(*id)) return std::nullopt;
    entries.Append(entry.Clone());
  }
  return entries;
}

base::DictValue DecorateEntry(const base::DictValue& entry, const ManifestFacts* facts,
                              const std::string& action_icon) {
  base::DictValue out = entry.Clone();
  if (facts) {
    out.Set("hasAction", base::Value(facts->has_action));
    if (facts->popup) out.Set("popup", *facts->popup);
    if (facts->action_title) out.Set("actionTitle", *facts->action_title);
    if (facts->side_panel) out.Set("sidePanel", *facts->side_panel);
    if (!action_icon.empty()) out.Set("actionIcon", action_icon);
  }
  out.Set("incognitoSplit", base::Value(facts && facts->incognito_split));
  for (const auto key : {"siteAccess", "optionsUrl", "path", "homepageUrl"}) {
    if (!out.Find(key)) out.Set(key, base::Value());
  }
  const std::string* location = entry.FindString("location");
  const std::string* id = entry.FindString("id");
  const bool from_store = location && *location == "FROM_STORE" && id;
  out.Set("fromWebStore", base::Value(from_store));
  out.Set("webStoreUrl", from_store ? base::Value("https://chromewebstore.google.com/detail/" + *id) : base::Value());
  return out;
}

base::DictValue Package(const ManifestFacts& facts, std::string_view id, std::string_view path,
                        std::string_view icon) {
  base::DictValue out;
  if (ValidExtensionId(id)) out.Set("id", id);
  out.Set("name", facts.name);
  out.Set("shortName", Nullable(facts.short_name));
  out.Set("version", facts.version);
  out.Set("description", facts.description);
  out.Set("manifestVersion", base::Value(facts.manifest_version));
  out.Set("icon", icon.empty() ? base::Value() : base::Value(icon));
  out.Set("permissions", base::Value(List(facts.permissions)));
  out.Set("optionalPermissions", base::Value(List(facts.optional_permissions)));
  out.Set("hostPermissions", base::Value(List(facts.host_permissions)));
  out.Set("hasAction", base::Value(facts.has_action));
  out.Set("popup", Nullable(facts.popup));
  out.Set("optionsPage", Nullable(facts.options_page));
  out.Set("sidePanel", Nullable(facts.side_panel));
  out.Set("path", path);
  return out;
}

std::optional<base::DictValue> SearchEngines(const base::Value& reply) {
  if (!reply.is_dict()) return std::nullopt;
  const base::Value* engines = reply.GetDict().Find("engines");
  if (!engines || !engines->is_list()) return std::nullopt;
  base::ListValue list;
  for (const auto& engine : engines->GetList()) {
    if (!engine.is_dict()) continue;
    const base::DictValue& source = engine.GetDict();
    base::DictValue out;
    for (const auto key : {"name", "keyword", "url", "suggestionsUrl"}) {
      out.Set(key, source.FindString(key) ? base::Value(*source.FindString(key)) : base::Value(""));
    }
    for (const auto key : {"default", "isOmniboxExtension"}) {
      const base::Value* flag = source.Find(key);
      out.Set(key, base::Value(flag && flag->is_bool() && flag->GetBool()));
    }
    if (const base::DictValue* extension = source.FindDict("extension")) {
      const std::string* id = extension->FindString("id");
      if (id && ValidExtensionId(*id)) {
        const std::string* name = extension->FindString("name");
        out.Set("extension", base::DictValue().Set("id", *id).Set("name", name ? *name : std::string()));
      }
    }
    list.Append(base::Value(std::move(out)));
  }
  return base::DictValue().Set("list", base::DictValue().Set("engines", base::Value(std::move(list))));
}

std::optional<Change> ChangeFor(std::string_view name, const base::DictValue& input, const base::Value& reply) {
  if (name == "extensions.install" || name == "extensions.installCrx") {
    const std::string* id = reply.is_dict() ? reply.GetDict().FindString("id") : nullptr;
    if (!id || !ValidExtensionId(*id)) return std::nullopt;
    return Change{*id, "installed"};
  }
  const std::string* id = input.FindString("id");
  if (!id || !ValidExtensionId(*id)) return std::nullopt;
  if (name == "extensions.setEnabled") {
    const base::Value* enabled = input.Find("enabled");
    if (!enabled || !enabled->is_bool()) return std::nullopt;
    return Change{*id, enabled->GetBool() ? "enabled" : "disabled"};
  }
  if (name == "extensions.uninstall") return Change{*id, "uninstalled"};
  if (name == "extensions.reload") return Change{*id, "reloaded"};
  if (name == "extensions.configure") return Change{*id, "configured"};
  return std::nullopt;
}

base::DictValue ChangeEvent(const Change& change, std::string_view profile) {
  return base::DictValue().Set("profile", profile).Set("id", change.id).Set("event", change.event);
}

std::string PromptTypeName(int type) {
  switch (type) {
    case kPromptInstall: return "install";
    case kPromptReEnable: return "re-enable";
    case kPromptPermissions: return "permissions";
    case kPromptExternal: return "external";
    case kPromptRemote: return "remote";
    case kPromptRepair: return "repair";
    default: return "other";
  }
}

std::optional<std::string> HexColor(uint32_t argb) {
  if (!(argb >> 24)) return std::nullopt;
  static constexpr char kHex[] = "0123456789abcdef";
  std::string out = "#";
  for (const int shift : {20, 16, 12, 8, 4, 0}) out += kHex[(argb >> shift) & 15];
  return out;
}

std::string DisplayBadge(std::string_view text) {
  return text.starts_with("<<") ? std::string() : std::string(text);
}

base::DictValue ActionState(const ActionFacts& facts) {
  return base::DictValue()
      .Set("title", facts.title)
      .Set("badgeText", DisplayBadge(facts.badge))
      .Set("badgeColor", Nullable(HexColor(facts.badge_color)))
      .Set("badgeTextColor", Nullable(HexColor(facts.badge_text_color)))
      .Set("popup", facts.popup)
      .Set("enabled", base::Value(facts.enabled))
      .Set("icon", facts.icon);
}

std::optional<std::string> ExtensionUrlHost(std::string_view url) {
  constexpr std::string_view kScheme = "chrome-extension://";
  if (!url.starts_with(kScheme) || url.size() > kMaxSurfaceUrl || url.find('\0') != std::string_view::npos)
    return std::nullopt;
  const std::string_view rest = url.substr(kScheme.size());
  const std::string_view host = rest.substr(0, rest.find_first_of("/?#"));
  if (!ValidExtensionId(host) || (host.size() < rest.size() && rest[host.size()] != '/')) return std::nullopt;
  return std::string(host);
}

std::string ValidateSurfaceRequest(const base::DictValue& args, SurfaceRequest* request) {
  const std::string* kind = args.FindString("kind");
  const std::string* url = args.FindString("url");
  if (!Only(args, {"kind", "url", "profile"}) || !args.FindString("profile") || !kind || !url)
    return "An extension view needs exactly a kind, a URL and a profile";
  if (*kind != "popup" && *kind != "sidePanel") return "Unknown extension view kind";
  const auto host = ExtensionUrlHost(*url);
  if (!host) return "Extension views only load chrome-extension:// pages";
  request->kind = *kind == "popup" ? SurfaceKind::kPopup : SurfaceKind::kSidePanel;
  request->url = *url;
  request->extension_id = *host;
  return "";
}

std::optional<int> SurfaceBook::Open(SurfaceKind kind, std::string extension_id, uint64_t generation) {
  if (entries_.size() >= kMaxSurfacesPerWindow || !ValidExtensionId(extension_id)) return std::nullopt;
  const int id = ++next_;
  entries_.emplace(id, SurfaceEntry{kind, std::move(extension_id), generation});
  return id;
}

bool SurfaceBook::Close(int id) {
  return entries_.erase(id) != 0;
}

std::vector<int> SurfaceBook::CloseExtension(std::string_view extension_id) {
  std::vector<int> closed;
  for (auto it = entries_.begin(); it != entries_.end();) {
    if (it->second.extension_id == extension_id) {
      closed.push_back(it->first);
      it = entries_.erase(it);
    } else {
      ++it;
    }
  }
  return closed;
}

std::vector<int> SurfaceBook::CloseOlderThan(uint64_t generation) {
  std::vector<int> closed;
  for (auto it = entries_.begin(); it != entries_.end();) {
    if (it->second.generation < generation) {
      closed.push_back(it->first);
      it = entries_.erase(it);
    } else {
      ++it;
    }
  }
  return closed;
}

std::vector<int> SurfaceBook::CloseAll() {
  std::vector<int> closed;
  for (const auto& [id, entry] : entries_) closed.push_back(id);
  entries_.clear();
  return closed;
}

const SurfaceEntry* SurfaceBook::Find(int id) const {
  auto found = entries_.find(id);
  return found == entries_.end() ? nullptr : &found->second;
}

bool SurfaceBook::Owns(int id, uint64_t generation) const {
  const SurfaceEntry* entry = Find(id);
  return entry && entry->generation == generation;
}

}
