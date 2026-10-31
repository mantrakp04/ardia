#include "ardia/linux/ac_linux_live.h"

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <utility>

#include "ardia/linux/ac_linux_sync_crypto.h"

namespace ardia::linux_live {
namespace {

using linux_sync::Bytes;
using linux_sync::KeyStore;
using linux_sync::Wipe;

constexpr char kCredentialHeader[] = "ardia-live-1";
constexpr char kGithubGraphql[] = "https://api.github.com/graphql";
constexpr char kGithubWeb[] = "https://github.com";
constexpr char kBitbucket[] = "https://api.bitbucket.org/2.0";
constexpr char kNotion[] = "https://api.notion.com/v1";
constexpr char kGoogleToken[] = "https://oauth2.googleapis.com/token";
constexpr char kDrive[] = "https://www.googleapis.com/drive/v3";
constexpr char kGithubScope[] = "repo read:org";
constexpr char kViewerQuery[] = "query { viewer { login name avatarUrl(size: 64) } }";
constexpr char kNotionSearchBody[] =
    "{\"sort\":{\"direction\":\"descending\",\"timestamp\":\"last_edited_time\"},\"page_size\":30}";
constexpr char kConfluenceCql[] =
    "type=page AND (contributor=currentUser() OR creator=currentUser() OR watcher=currentUser()) "
    "ORDER BY lastmodified DESC";
constexpr std::pair<const char*, const char*> kDriveQuery[] = {
    {"q",
     "trashed = false and mimeType != 'application/vnd.google-apps.folder' and (viewedByMeTime > "
     "'1970-01-01T00:00:00Z' or 'me' in owners)"},
    {"orderBy", "modifiedTime desc"},
    {"pageSize", "30"},
    {"fields", "files(id,name,mimeType,webViewLink,iconLink,modifiedTime,lastModifyingUser(displayName))"},
};

struct Operation {
  Source source;
  const char* name;
  bool renderer;
  bool credential;
};

constexpr Operation kOperations[] = {
    {Source::kGithub, "graphql", true, true},       {Source::kGithub, "deviceCode", true, false},
    {Source::kBitbucket, "pullRequests", true, true}, {Source::kBitbucket, "statuses", true, true},
    {Source::kBitbucket, "pullRequest", true, true},  {Source::kBitbucket, "user", false, true},
    {Source::kNotion, "search", true, true},          {Source::kNotion, "users", true, true},
    {Source::kNotion, "me", false, true},             {Source::kConfluence, "search", true, true},
    {Source::kConfluence, "current", false, true},    {Source::kGdrive, "files", true, true},
    {Source::kGdrive, "about", false, true},
};

const Operation* FindOperation(Source source, std::string_view name) {
  for (const auto& operation : kOperations) {
    if (operation.source == source && name == operation.name) return &operation;
  }
  return nullptr;
}

bool Printable(std::string_view text, size_t max) {
  if (text.empty() || text.size() > max) return false;
  for (const char c : text) {
    const unsigned char byte = static_cast<unsigned char>(c);
    if (byte <= 0x20 || byte >= 0x7f) return false;
  }
  return true;
}

bool Identity(std::string_view text, size_t max) {
  return Printable(text, max) && text.find(':') == std::string_view::npos;
}

bool Charset(std::string_view text, size_t max, std::string_view extra) {
  if (text.empty() || text.size() > max) return false;
  for (const char c : text) {
    if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) continue;
    if (extra.find(c) == std::string_view::npos) return false;
  }
  return true;
}

bool RepoName(std::string_view repo) {
  const size_t slash = repo.find('/');
  if (slash == std::string_view::npos || repo.find('/', slash + 1) != std::string_view::npos) return false;
  const auto workspace = repo.substr(0, slash);
  const auto slug = repo.substr(slash + 1);
  return Charset(workspace, 128, "._-{}") && Charset(slug, 128, "._-{}") && workspace != "." && workspace != ".." &&
         slug != "." && slug != "..";
}

const std::string* Text(const JsonValue& object, std::string_view key) {
  const JsonValue* value = object.Find(key);
  return value && value->is_string() ? &value->text : nullptr;
}

std::optional<double> Number(const JsonValue& object, std::string_view key) {
  const JsonValue* value = object.Find(key);
  if (!value || value->type != JsonValue::Type::kNumber) return std::nullopt;
  char* end = nullptr;
  const double number = std::strtod(value->text.c_str(), &end);
  if (!end || *end || !std::isfinite(number)) return std::nullopt;
  return number;
}

std::optional<int64_t> PositiveInteger(const JsonValue& object, std::string_view key) {
  const auto number = Number(object, key);
  if (!number || *number < 1 || *number > 9007199254740991.0 || std::floor(*number) != *number) return std::nullopt;
  return static_cast<int64_t>(*number);
}

std::string Form(std::initializer_list<std::pair<std::string_view, std::string_view>> fields) {
  std::string out;
  for (const auto& [key, value] : fields) {
    if (!out.empty()) out.push_back('&');
    out += PercentEncode(key);
    out.push_back('=');
    out += PercentEncode(value);
  }
  return out;
}

HttpRequest Get(std::string url) {
  HttpRequest request;
  request.method = "GET";
  request.url = std::move(url);
  request.headers.emplace_back("Accept", "application/json");
  return request;
}

HttpRequest Post(std::string url, std::string content_type, std::string body) {
  HttpRequest request;
  request.method = "POST";
  request.url = std::move(url);
  request.headers.emplace_back("Accept", "application/json");
  request.content_type = std::move(content_type);
  request.body = std::move(body);
  return request;
}

void Authorize(HttpRequest& request, std::string value) {
  request.headers.emplace_back("Authorization", std::move(value));
  Wipe(value);
}

std::string Bearer(const std::string& token) {
  return "Bearer " + token;
}

std::string Basic(const std::string& user, const std::string& secret) {
  std::string joined = user + ":" + secret;
  std::string out = "Basic " + Base64(joined);
  Wipe(joined);
  return out;
}

using Field = std::string Credential::*;

std::vector<std::pair<const char*, Field>> Fields(Source source) {
  switch (source) {
    case Source::kGithub:
    case Source::kNotion:
      return {{"token", &Credential::token}};
    case Source::kBitbucket:
      return {{"user", &Credential::user}, {"token", &Credential::token}};
    case Source::kConfluence:
      return {{"site", &Credential::site}, {"user", &Credential::user}, {"token", &Credential::token}};
    case Source::kGdrive:
      return {{"clientId", &Credential::client_id},
              {"clientSecret", &Credential::client_secret},
              {"refreshToken", &Credential::refresh_token},
              {"token", &Credential::token}};
  }
  return {};
}

std::string Hex(std::string_view text) {
  static constexpr char kHex[] = "0123456789abcdef";
  std::string out;
  out.reserve(text.size() * 2);
  for (const char c : text) {
    const auto byte = static_cast<unsigned char>(c);
    out.push_back(kHex[byte >> 4]);
    out.push_back(kHex[byte & 15]);
  }
  return out;
}

std::optional<std::string> Unhex(std::string_view text) {
  Bytes bytes;
  if (!linux_sync::HexDecode(text, &bytes)) return std::nullopt;
  std::string out(bytes.begin(), bytes.end());
  Wipe(bytes);
  return out;
}

Outcome KeyringFailure(KeyStatus status) {
  if (status == KeyStatus::kLocked)
    return Outcome::Error(kErrKeyringLocked, "Unlock your keyring so Ardia can use this service");
  return Outcome::Error(kErrKeyringUnavailable, "No keyring is available to keep this service's token");
}

Outcome NotConnected() {
  return Outcome::Error(kErrNotConnected, "Not signed in");
}

Outcome Cancelled() {
  return Outcome::Error(kErrCancelled, "Cancelled");
}

std::optional<JsonValue> JsonBody(const HttpResponse& response) {
  auto parsed = linux_sync::ParseJson(response.body);
  if (!parsed || (!parsed->is_object() && !parsed->is_array())) return std::nullopt;
  return parsed;
}

Outcome Unreadable() {
  return Outcome::Error(kErrService, "The service sent an unreadable reply");
}

bool InvalidGrant(const HttpResponse& response) {
  if (response.status != 400 && response.status != 401) return false;
  const auto body = JsonBody(response);
  const std::string* error = body && body->is_object() ? Text(*body, "error") : nullptr;
  return error && *error == "invalid_grant";
}

Credential Placeholder(Source source) {
  Credential credential;
  credential.source = source;
  credential.token = "placeholder";
  credential.user = "placeholder";
  credential.site = "https://placeholder.invalid";
  credential.client_id = "placeholder";
  credential.client_secret = "placeholder";
  credential.refresh_token = "placeholder";
  return credential;
}

std::string DeviceError(const std::string& error) {
  if (error == "access_denied") return "Access was denied";
  if (error == "expired_token") return "The code expired";
  if (Charset(error, 64, "_")) return error;
  return "GitHub sign-in failed";
}

}

Credential::~Credential() {
  Wipe(token);
  Wipe(user);
  Wipe(site);
  Wipe(client_id);
  Wipe(client_secret);
  Wipe(refresh_token);
}

std::optional<Source> SourceFrom(std::string_view name) {
  for (const Source source : kSources) {
    if (SourceName(source) == name) return source;
  }
  return std::nullopt;
}

std::string_view SourceName(Source source) {
  switch (source) {
    case Source::kGithub: return "github";
    case Source::kBitbucket: return "bitbucket";
    case Source::kNotion: return "notion";
    case Source::kConfluence: return "confluence";
    case Source::kGdrive: return "gdrive";
  }
  return "github";
}

bool IsLiveMethod(std::string_view method) {
  for (const char* name : kMethods) {
    if (method == name) return true;
  }
  return false;
}

bool ValidRequestId(std::string_view id) {
  return Charset(id, kMaxRequestIdBytes, "_-#:/");
}

bool ValidLiveAccount(std::string_view account) {
  return SourceFrom(account).has_value();
}

const linux_sync::KeySchema& LiveKeySchema() {
  static const linux_sync::KeySchema schema{kSecretSchema, kSecretLabel, "live-token-", &ValidLiveAccount,
                                            kMaxCredentialBytes};
  return schema;
}

bool ValidCredential(const Credential& credential) {
  if (!Printable(credential.token, kMaxFieldBytes)) return false;
  switch (credential.source) {
    case Source::kGithub:
    case Source::kNotion:
      return true;
    case Source::kBitbucket:
      return Identity(credential.user, 256);
    case Source::kConfluence:
      return Identity(credential.user, 320) && NormalizeSite(credential.site) == credential.site;
    case Source::kGdrive:
      return Printable(credential.client_id, kMaxFieldBytes) && Printable(credential.client_secret, kMaxFieldBytes) &&
             Printable(credential.refresh_token, kMaxFieldBytes) && credential.expires_at_ms >= 0;
  }
  return false;
}

std::string SerializeCredential(const Credential& credential) {
  std::string out = kCredentialHeader;
  out.push_back('\n');
  for (const auto& [name, field] : Fields(credential.source)) {
    std::string hex = Hex(credential.*field);
    out += name;
    out.push_back('=');
    out += hex;
    out.push_back('\n');
    Wipe(hex);
  }
  if (credential.source == Source::kGdrive) out += "expiresAt=" + std::to_string(credential.expires_at_ms) + "\n";
  return out;
}

std::optional<Credential> ParseCredential(Source source, std::string_view text) {
  if (text.size() > kMaxCredentialBytes) return std::nullopt;
  std::vector<std::string_view> lines;
  size_t at = 0;
  while (at < text.size()) {
    const size_t end = text.find('\n', at);
    if (end == std::string_view::npos) return std::nullopt;
    lines.push_back(text.substr(at, end - at));
    at = end + 1;
  }
  const auto fields = Fields(source);
  const size_t expected = 1 + fields.size() + (source == Source::kGdrive ? 1 : 0);
  if (lines.size() != expected || lines[0] != kCredentialHeader) return std::nullopt;
  Credential credential;
  credential.source = source;
  for (size_t i = 0; i < fields.size(); ++i) {
    const std::string_view line = lines[i + 1];
    const std::string prefix = std::string(fields[i].first) + "=";
    if (!line.starts_with(prefix)) return std::nullopt;
    auto value = Unhex(line.substr(prefix.size()));
    if (!value) return std::nullopt;
    credential.*fields[i].second = std::move(*value);
    Wipe(*value);
  }
  if (source == Source::kGdrive) {
    const std::string_view line = lines.back();
    if (!line.starts_with("expiresAt=")) return std::nullopt;
    const std::string digits(line.substr(10));
    if (digits.empty() || digits.size() > 18 || !Charset(digits, 18, "")) return std::nullopt;
    for (const char c : digits) {
      if (c < '0' || c > '9') return std::nullopt;
    }
    credential.expires_at_ms = std::strtoll(digits.c_str(), nullptr, 10);
  }
  if (!ValidCredential(credential)) return std::nullopt;
  return credential;
}

KeyStatus LoadCredential(KeyStore& store, Source source, std::optional<Credential>* credential) {
  Bytes bytes;
  const KeyStatus status = store.Load(SourceName(source), &bytes);
  if (status != KeyStatus::kOk) return status;
  std::string text(bytes.begin(), bytes.end());
  Wipe(bytes);
  *credential = ParseCredential(source, text);
  Wipe(text);
  return *credential ? KeyStatus::kOk : KeyStatus::kNotFound;
}

KeyStatus SaveCredential(KeyStore& store, const Credential& credential) {
  if (!ValidCredential(credential)) return KeyStatus::kUnavailable;
  std::string text = SerializeCredential(credential);
  Bytes bytes(text.begin(), text.end());
  Wipe(text);
  const KeyStatus status = store.Save(SourceName(credential.source), bytes);
  Wipe(bytes);
  return status;
}

KeyStatus DeleteCredential(KeyStore& store, Source source) {
  return store.Delete(SourceName(source));
}

Outcome Outcome::Value(JsonValue value) {
  Outcome outcome;
  outcome.value = std::move(value);
  return outcome;
}

Outcome Outcome::Error(std::string code, std::string message) {
  Outcome outcome;
  outcome.ok = false;
  outcome.code = std::move(code);
  outcome.message = std::move(message);
  return outcome;
}

ProviderContract Contract() {
  ProviderContract contract;
  contract.viewer_query = kViewerQuery;
  contract.github_scope = kGithubScope;
  contract.notion_search_body = kNotionSearchBody;
  contract.notion_version = kNotionVersion;
  contract.confluence_cql = kConfluenceCql;
  for (const auto& [key, value] : kDriveQuery) contract.drive_query.emplace_back(key, value);
  contract.google_redirect = kGoogleRedirect;
  return contract;
}

std::optional<std::string> NormalizeSite(std::string_view site) {
  constexpr std::string_view kScheme = "https://";
  if (site.size() > 256 || !site.starts_with(kScheme)) return std::nullopt;
  std::string_view authority = site.substr(kScheme.size());
  std::string_view port;
  if (const size_t colon = authority.find(':'); colon != std::string_view::npos) {
    port = authority.substr(colon + 1);
    authority = authority.substr(0, colon);
    if (port.empty() || port.size() > 5 || !Charset(port, 5, "")) return std::nullopt;
    for (const char c : port) {
      if (c < '0' || c > '9') return std::nullopt;
    }
    const long number = std::strtol(std::string(port).c_str(), nullptr, 10);
    if (number < 1 || number > 65535) return std::nullopt;
  }
  if (!Charset(authority, 253, ".-") || authority.front() == '.' || authority.back() == '.' ||
      authority.front() == '-' || authority.find("..") != std::string_view::npos ||
      authority.find('.') == std::string_view::npos) {
    return std::nullopt;
  }
  std::string out(kScheme);
  for (const char c : authority) out.push_back(c >= 'A' && c <= 'Z' ? static_cast<char>(c - 'A' + 'a') : c);
  if (!port.empty()) {
    out.push_back(':');
    out += port;
  }
  return out;
}

bool ReadOnlyGraphql(std::string_view query) {
  if (query.empty() || query.size() > kMaxQueryBytes) return false;
  size_t at = 0;
  while (at < query.size()) {
    const char c = query[at];
    if (c == '#') {
      while (at < query.size() && query[at] != '\n' && query[at] != '\r') ++at;
    } else if (c == '"') {
      if (query.substr(at, 3) == "\"\"\"") {
        const size_t end = query.find("\"\"\"", at + 3);
        if (end == std::string_view::npos) return false;
        at = end + 3;
        continue;
      }
      ++at;
      while (at < query.size() && query[at] != '"') {
        if (query[at] == '\\') ++at;
        if (at < query.size() && (query[at] == '\n' || query[at] == '\r')) return false;
        ++at;
      }
      if (at >= query.size()) return false;
      ++at;
    } else if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '_') {
      const size_t start = at;
      while (at < query.size() && ((query[at] >= 'a' && query[at] <= 'z') || (query[at] >= 'A' && query[at] <= 'Z') ||
                                   (query[at] >= '0' && query[at] <= '9') || query[at] == '_')) {
        ++at;
      }
      const std::string_view word = query.substr(start, at - start);
      if (word == "mutation" || word == "subscription") return false;
    } else {
      if (static_cast<unsigned char>(c) < 0x20 && c != '\n' && c != '\r' && c != '\t') return false;
      ++at;
    }
  }
  return true;
}

std::string PercentEncode(std::string_view text) {
  static constexpr char kHex[] = "0123456789ABCDEF";
  std::string out;
  for (const char c : text) {
    if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '_' ||
        c == '.' || c == '!' || c == '~' || c == '*' || c == '\'' || c == '(' || c == ')') {
      out.push_back(c);
    } else {
      const auto byte = static_cast<unsigned char>(c);
      out.push_back('%');
      out.push_back(kHex[byte >> 4]);
      out.push_back(kHex[byte & 15]);
    }
  }
  return out;
}

std::string Base64(std::string_view text) {
  static constexpr char kAlphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string out;
  for (size_t i = 0; i < text.size(); i += 3) {
    const uint32_t a = static_cast<unsigned char>(text[i]);
    const uint32_t b = i + 1 < text.size() ? static_cast<unsigned char>(text[i + 1]) : 0;
    const uint32_t c = i + 2 < text.size() ? static_cast<unsigned char>(text[i + 2]) : 0;
    const uint32_t n = (a << 16) | (b << 8) | c;
    out.push_back(kAlphabet[(n >> 18) & 63]);
    out.push_back(kAlphabet[(n >> 12) & 63]);
    out.push_back(i + 1 < text.size() ? kAlphabet[(n >> 6) & 63] : '=');
    out.push_back(i + 2 < text.size() ? kAlphabet[n & 63] : '=');
  }
  return out;
}

std::string ErrorText(int status, std::string_view body) {
  size_t end = std::min(body.size(), kMaxErrorTextBytes);
  while (end > 0 && end < body.size() && (static_cast<unsigned char>(body[end]) & 0xc0) == 0x80) --end;
  std::string text(body.substr(0, end));
  for (char& c : text) {
    const auto byte = static_cast<unsigned char>(c);
    if (byte < 0x20 || byte == 0x7f) c = ' ';
  }
  std::string out = std::to_string(status);
  if (!text.empty()) out += " " + text;
  while (!out.empty() && out.back() == ' ') out.pop_back();
  return out;
}

namespace {

bool UsageLimitBody(const std::string& body) {
  const auto parsed = linux_sync::ParseJson(body);
  if (!parsed || !parsed->is_object()) return false;
  if (const std::string* message = Text(*parsed, "message")) {
    if (message->find("secondary rate limit") != std::string::npos) return true;
  }
  const JsonValue* error = parsed->Find("error");
  const JsonValue* errors = error && error->is_object() ? error->Find("errors") : nullptr;
  if (!errors || !errors->is_array()) return false;
  for (const JsonValue& item : errors->items) {
    const std::string* reason = item.is_object() ? Text(item, "reason") : nullptr;
    if (reason && (*reason == "userRateLimitExceeded" || *reason == "rateLimitExceeded" || *reason == "dailyLimitExceeded"))
      return true;
  }
  return false;
}

}

std::optional<Outcome> Failure(const HttpResponse& response) {
  if (!response.reached) return Outcome::Error(kErrNetwork, "Couldn't connect");
  if (response.too_large) return Outcome::Error(kErrService, "The service sent too much data");
  const auto header = [&](const char* name) -> const std::string* {
    const auto found = response.headers.find(name);
    return found == response.headers.end() ? nullptr : &found->second;
  };
  if (response.status == 401) return Outcome::Error(kErrSignedOut, "Signed out");
  if (response.status == 403 && header("x-github-sso")) return Outcome::Error(kErrSso, "Needs Single Sign-On");
  const std::string* remaining = header("x-ratelimit-remaining");
  if (response.status == 429 ||
      (response.status == 403 && ((remaining && *remaining == "0") || header("retry-after") || UsageLimitBody(response.body))))
    return Outcome::Error(kErrRateLimited, "Rate Limit Exceeded");
  if (response.status < 200 || response.status >= 300)
    return Outcome::Error(response.status == 403 ? kErrSignedOut : kErrService, ErrorText(response.status, response.body));
  return std::nullopt;
}

bool NeedsCredential(Source source, std::string_view operation) {
  const Operation* found = FindOperation(source, operation);
  return !found || found->credential;
}

std::optional<HttpRequest> BuildRequest(Source source, std::string_view operation, const JsonValue& params,
                                        const Credential* credential, std::string* error) {
  const Operation* known = FindOperation(source, operation);
  const auto refuse = [&](const char* message) -> std::optional<HttpRequest> {
    *error = message;
    return std::nullopt;
  };
  if (!known) return refuse("Unknown service operation");
  if (!params.is_object()) return refuse("Service parameters must be an object");
  if (known->credential && (!credential || credential->source != source || !ValidCredential(*credential)))
    return refuse("Not signed in");
  switch (source) {
    case Source::kGithub: {
      if (operation == "deviceCode") {
        const std::string* client = Text(params, "clientId");
        if (!client || !Printable(*client, 256)) return refuse("A GitHub client ID is required");
        return Post(std::string(kGithubWeb) + "/login/device/code", "application/x-www-form-urlencoded",
                    Form({{"client_id", *client}, {"scope", kGithubScope}}));
      }
      const std::string* query = Text(params, "query");
      if (!query || !ReadOnlyGraphql(*query)) return refuse("Only read-only GitHub queries are allowed");
      const JsonValue* variables = params.Find("variables");
      if (variables && !variables->is_object()) return refuse("GitHub query variables must be an object");
      JsonValue body = JsonValue::Object();
      body.Set("query", JsonValue::String(*query));
      body.Set("variables", variables ? *variables : JsonValue::Object());
      std::string text = linux_sync::WriteJson(body);
      if (text.size() > 2 * kMaxQueryBytes) return refuse("The GitHub query is too large");
      HttpRequest request = Post(kGithubGraphql, "application/json", std::move(text));
      Authorize(request, Bearer(credential->token));
      return request;
    }
    case Source::kBitbucket: {
      std::string url;
      if (operation == "user") {
        url = std::string(kBitbucket) + "/user";
      } else if (operation == "pullRequests") {
        const std::string* user = Text(params, "user");
        if (!user || !Charset(*user, 128, ":{}_-")) return refuse("A Bitbucket account is required");
        url = std::string(kBitbucket) + "/pullrequests/" + PercentEncode(*user) + "?state=OPEN&pagelen=50";
      } else {
        const std::string* repo = Text(params, "repo");
        const auto id = PositiveInteger(params, "id");
        if (!repo || !RepoName(*repo) || !id) return refuse("A Bitbucket repository and pull request are required");
        url = std::string(kBitbucket) + "/repositories/" + *repo + "/pullrequests/" + std::to_string(*id);
        if (operation == "statuses") url += "/statuses?pagelen=50";
      }
      HttpRequest request = Get(std::move(url));
      Authorize(request, Basic(credential->user, credential->token));
      return request;
    }
    case Source::kNotion: {
      HttpRequest request = operation == "search"
                                ? Post(std::string(kNotion) + "/search", "application/json", kNotionSearchBody)
                                : Get(std::string(kNotion) + (operation == "users" ? "/users?page_size=100" : "/users/me"));
      Authorize(request, Bearer(credential->token));
      request.headers.emplace_back("Notion-Version", kNotionVersion);
      return request;
    }
    case Source::kConfluence: {
      const std::string base = credential->site + "/wiki/rest/api";
      HttpRequest request = Get(operation == "current"
                                    ? base + "/user/current"
                                    : base + "/content/search?limit=30&expand=space,history.lastUpdated&cql=" +
                                          PercentEncode(kConfluenceCql));
      Authorize(request, Basic(credential->user, credential->token));
      return request;
    }
    case Source::kGdrive: {
      std::string url = std::string(kDrive);
      if (operation == "about") {
        url += "/about?fields=user";
      } else {
        url += "/files?";
        bool first = true;
        for (const auto& [key, value] : kDriveQuery) {
          if (!first) url.push_back('&');
          first = false;
          url += std::string(key) + "=" + PercentEncode(value);
        }
      }
      HttpRequest request = Get(std::move(url));
      Authorize(request, Bearer(credential->token));
      return request;
    }
  }
  return refuse("Unknown service operation");
}

LiveCore::LiveCore(Transport& transport, CredentialStore& store, Clock now_ms)
    : transport_(transport), store_(store), now_ms_(std::move(now_ms)) {}

LiveCore::~LiveCore() = default;

void LiveCore::Invoke(std::string_view method, const std::vector<JsonValue>& args, Reply reply) {
  const auto source_at = [&](size_t index) -> std::optional<Source> {
    return index < args.size() && args[index].is_string() ? SourceFrom(args[index].text) : std::nullopt;
  };
  const auto id_at = [&](size_t index) -> std::optional<std::string> {
    if (index >= args.size() || !args[index].is_string() || !ValidRequestId(args[index].text)) return std::nullopt;
    return args[index].text;
  };
  if (method == "ArdiaLive.request") {
    const auto source = source_at(0);
    const auto id = id_at(3);
    if (args.size() != 4 || !source || !args[1].is_string() || !args[2].is_object() || !id)
      return reply(Outcome::Error(kErrArgument, "Invalid service request"));
    const Operation* operation = FindOperation(*source, args[1].text);
    if (!operation || !operation->renderer) return reply(Outcome::Error(kErrArgument, "Unknown service operation"));
    return Request(*source, args[1].text, args[2], *id, std::move(reply));
  }
  if (method == "ArdiaLive.connect") {
    const auto source = source_at(0);
    const auto id = id_at(2);
    if (args.size() != 3 || !source || !args[1].is_object() || !id)
      return reply(Outcome::Error(kErrArgument, "Invalid service connection"));
    return Connect(*source, args[1], *id, std::move(reply));
  }
  if (method == "ArdiaLive.cancel") {
    const auto id = id_at(0);
    if (args.size() != 1 || !id) return reply(Outcome::Error(kErrArgument, "A request id is required"));
    return Cancel(*id, std::move(reply));
  }
  if (method == "ArdiaLive.disconnect") {
    const auto source = source_at(0);
    if (args.size() != 1 || !source) return reply(Outcome::Error(kErrArgument, "Unknown service"));
    return Disconnect(*source, std::move(reply));
  }
  reply(Outcome::Error(kErrUnknownCall, "Unknown Live operation"));
}

uint64_t LiveCore::Open(std::string id, Source source, Reply reply) {
  if (ids_.contains(id)) {
    reply(Outcome::Error(kErrArgument, "That request id is already in use"));
    return 0;
  }
  const uint64_t serial = ++next_serial_;
  ids_[id] = serial;
  calls_[serial] = Call{std::move(id), source, std::move(reply), std::nullopt};
  return serial;
}

bool LiveCore::Alive(uint64_t serial) const {
  return calls_.contains(serial);
}

void LiveCore::Finish(uint64_t serial, Outcome outcome) {
  auto found = calls_.find(serial);
  if (found == calls_.end()) return;
  Call call = std::move(found->second);
  calls_.erase(found);
  ids_.erase(call.id);
  if (call.transfer) Drop(*call.transfer);
  call.reply(std::move(outcome));
}

void LiveCore::Send(uint64_t owner, HttpRequest request, Handler handler) {
  if (queue_.size() >= kMaxQueued) {
    if (owner) return Finish(owner, Outcome::Error(kErrBusy, "Too many service requests are waiting"));
    return handler(HttpResponse{});
  }
  const std::string transfer = "t" + std::to_string(++next_transfer_);
  request.id = transfer;
  if (owner) {
    auto found = calls_.find(owner);
    if (found == calls_.end()) return;
    found->second.transfer = transfer;
  }
  queue_.emplace_back(transfer, Queued{owner, std::move(request), std::move(handler)});
  Pump();
}

void LiveCore::Pump() {
  while (active_.size() < kMaxActive && !queue_.empty()) {
    auto [transfer, queued] = std::move(queue_.front());
    queue_.pop_front();
    HttpRequest request = queued.request;
    active_.emplace(transfer, std::move(queued));
    transport_.Send(std::move(request), [this, transfer](HttpResponse response) {
      auto found = active_.find(transfer);
      if (found == active_.end()) return;
      Queued done = std::move(found->second);
      active_.erase(found);
      if (done.owner) {
        auto call = calls_.find(done.owner);
        if (call != calls_.end() && call->second.transfer == transfer) call->second.transfer.reset();
      }
      done.handler(std::move(response));
      Pump();
    });
  }
}

void LiveCore::Drop(const std::string& transfer) {
  for (auto it = queue_.begin(); it != queue_.end(); ++it) {
    if (it->first == transfer) {
      queue_.erase(it);
      return;
    }
  }
  if (active_.erase(transfer)) {
    transport_.Cancel(transfer);
    Pump();
  }
}

void LiveCore::WithCredential(Source source, Access access) {
  Cached& cached = cache_[source];
  switch (cached.state) {
    case Cached::State::kPresent:
      return access(std::nullopt, &*cached.credential);
    case Cached::State::kAbsent:
      return access(NotConnected(), nullptr);
    case Cached::State::kLoading:
      cached.waiters.push_back(std::move(access));
      return;
    case Cached::State::kUnknown:
      break;
  }
  cached.state = Cached::State::kLoading;
  cached.waiters.push_back(std::move(access));
  const uint64_t generation = cached.generation;
  store_.Load(source, [this, source, generation](KeyStatus status, std::optional<Credential> credential) {
    Cached& current = cache_[source];
    std::optional<Outcome> failure;
    if (current.generation != generation && current.state == Cached::State::kLoading) {
      current.state = Cached::State::kUnknown;
    } else if (current.generation == generation) {
      if (status == KeyStatus::kOk && credential) {
        current.state = Cached::State::kPresent;
        current.credential = std::move(credential);
      } else if (status == KeyStatus::kOk || status == KeyStatus::kNotFound) {
        current.state = Cached::State::kAbsent;
        current.credential.reset();
      } else {
        current.state = Cached::State::kUnknown;
        failure = KeyringFailure(status);
      }
    }
    auto waiters = std::move(current.waiters);
    current.waiters.clear();
    for (auto& waiter : waiters) {
      if (failure) {
        waiter(failure, nullptr);
        continue;
      }
      Cached& now = cache_[source];
      if (now.state == Cached::State::kPresent) {
        waiter(std::nullopt, &*now.credential);
      } else if (now.state == Cached::State::kLoading || now.state == Cached::State::kUnknown) {
        WithCredential(source, std::move(waiter));
      } else {
        waiter(NotConnected(), nullptr);
      }
    }
  });
}

void LiveCore::WithAccess(Source source, uint64_t serial, Access access) {
  WithCredential(source, [this, source, serial, access = std::move(access)](std::optional<Outcome> failure,
                                                                             const Credential* credential) mutable {
    if (!Alive(serial)) return;
    if (failure || source != Source::kGdrive || credential->expires_at_ms - now_ms_() > kRenewalMarginMs)
      return access(std::move(failure), credential);
    renewal_waiters_.push_back([this, serial, access = std::move(access)](std::optional<Outcome> failure,
                                                                           const Credential* credential) {
      if (Alive(serial)) access(std::move(failure), credential);
    });
    if (!renewing_) Renew();
  });
}

void LiveCore::Renew() {
  Cached& cached = cache_[Source::kGdrive];
  if (cached.state != Cached::State::kPresent) return FinishRenewal(std::nullopt);
  renewing_ = true;
  const uint64_t generation = cached.generation;
  const Credential& credential = *cached.credential;
  HttpRequest request = Post(kGoogleToken, "application/x-www-form-urlencoded",
                             Form({{"client_id", credential.client_id},
                                   {"client_secret", credential.client_secret},
                                   {"refresh_token", credential.refresh_token},
                                   {"grant_type", "refresh_token"}}));
  Send(0, std::move(request), [this, generation](HttpResponse response) {
    Cached& current = cache_[Source::kGdrive];
    if (current.generation != generation || current.state != Cached::State::kPresent || current.saving)
      return FinishRenewal(std::nullopt);
    if (InvalidGrant(response))
      return FinishRenewal(Outcome::Error(kErrSignedOut, "Google Drive access was revoked"));
    if (auto failure = Failure(response)) return FinishRenewal(std::move(failure));
    const auto body = JsonBody(response);
    const std::string* access = body && body->is_object() ? Text(*body, "access_token") : nullptr;
    const auto expires = body && body->is_object() ? PositiveInteger(*body, "expires_in") : std::nullopt;
    if (!access || !Printable(*access, kMaxFieldBytes) || !expires) return FinishRenewal(Unreadable());
    Credential renewed = *current.credential;
    renewed.token = *access;
    renewed.expires_at_ms = now_ms_() + *expires * 1000;
    if (const std::string* rotated = Text(*body, "refresh_token"); rotated && Printable(*rotated, kMaxFieldBytes))
      renewed.refresh_token = *rotated;
    current.credential = renewed;
    store_.Save(std::move(renewed), [](KeyStatus) {});
    FinishRenewal(std::nullopt);
  });
}

void LiveCore::FinishRenewal(std::optional<Outcome> failure) {
  renewing_ = false;
  auto waiters = std::move(renewal_waiters_);
  renewal_waiters_.clear();
  for (auto& waiter : waiters) {
    if (failure) {
      waiter(failure, nullptr);
      continue;
    }
    Cached& cached = cache_[Source::kGdrive];
    if (cached.state == Cached::State::kPresent)
      waiter(std::nullopt, &*cached.credential);
    else
      waiter(NotConnected(), nullptr);
  }
}

void LiveCore::Commit(uint64_t serial, Credential candidate, std::function<void(const Credential&)> committed) {
  const Source source = candidate.source;
  WithCredential(source, [this, serial, source, candidate = std::move(candidate), committed = std::move(committed)](
                             std::optional<Outcome> failure, const Credential* current) mutable {
    if (!Alive(serial)) return;
    if (failure && failure->code != kErrNotConnected) return Finish(serial, std::move(*failure));
    std::optional<Credential> previous;
    if (current) previous = *current;
    Cached& posted = cache_[source];
    const uint64_t generation = ++posted.generation;
    ++posted.saving;
    store_.Save(candidate, [this, serial, source, generation, candidate, previous = std::move(previous),
                            committed = std::move(committed)](KeyStatus status) mutable {
      Cached& cached = cache_[source];
      --cached.saving;
      const bool latest = cached.generation == generation;
      if (status != KeyStatus::kOk) return Finish(serial, KeyringFailure(status));
      if (!Alive(serial)) {
        if (!latest) return;
        if (previous) return store_.Save(std::move(*previous), [](KeyStatus) {});
        return store_.Delete(source, [](KeyStatus) {});
      }
      if (latest) {
        ++cached.generation;
        cached.state = Cached::State::kPresent;
        cached.credential = candidate;
      }
      committed(candidate);
    });
  });
}

void LiveCore::Request(Source source, std::string operation, JsonValue params, std::string id, Reply reply) {
  std::string error;
  const Credential placeholder = Placeholder(source);
  if (!BuildRequest(source, operation, params, &placeholder, &error))
    return reply(Outcome::Error(kErrArgument, error));
  const uint64_t serial = Open(std::move(id), source, std::move(reply));
  if (serial) Issue(serial, source, std::move(operation), std::move(params), false);
}

void LiveCore::Issue(uint64_t serial, Source source, std::string operation, JsonValue params, bool retried) {
  auto send = [this, serial, source, operation, params, retried](std::optional<Outcome> failure,
                                                                 const Credential* credential) {
    if (!Alive(serial)) return;
    if (failure) return Finish(serial, std::move(*failure));
    std::string error;
    auto request = BuildRequest(source, operation, params, credential, &error);
    if (!request) return Finish(serial, Outcome::Error(kErrArgument, error));
    std::string used = credential ? credential->token : std::string();
    Send(serial, std::move(*request), [this, serial, source, operation, params, retried,
                                       used = std::move(used)](HttpResponse response) mutable {
      if (!Alive(serial)) return Wipe(used);
      Cached& cached = cache_[source];
      if (source == Source::kGdrive && response.reached && response.status == 401 && !retried &&
          cached.state == Cached::State::kPresent && cached.credential->token == used) {
        Wipe(used);
        cached.credential->expires_at_ms = 0;
        return Issue(serial, source, std::move(operation), std::move(params), true);
      }
      Wipe(used);
      if (auto failure = Failure(response)) return Finish(serial, std::move(*failure));
      if (!JsonBody(response)) return Finish(serial, Unreadable());
      JsonValue value = JsonValue::Object();
      value.Set("body", JsonValue::String(std::move(response.body)));
      Finish(serial, Outcome::Value(std::move(value)));
    });
  };
  if (!NeedsCredential(source, operation)) return send(std::nullopt, nullptr);
  WithAccess(source, serial, std::move(send));
}

void LiveCore::Connect(Source source, JsonValue fields, std::string id, Reply reply) {
  const auto text = [&](std::string_view key) -> std::string {
    const std::string* value = Text(fields, key);
    return value ? *value : std::string();
  };
  Credential candidate;
  candidate.source = source;
  switch (source) {
    case Source::kGithub:
      if (fields.Find("deviceCode")) {
        const std::string client = text("clientId");
        const std::string device = text("deviceCode");
        if (!Printable(client, 256) || !Printable(device, 256))
          return reply(Outcome::Error(kErrArgument, "A GitHub client ID and device code are required"));
        const uint64_t serial = Open(std::move(id), source, std::move(reply));
        if (serial) ConnectGithubDevice(serial, client, device);
        return;
      }
      candidate.token = text("token");
      break;
    case Source::kNotion:
      candidate.token = text("token");
      break;
    case Source::kBitbucket:
      candidate.user = text("user");
      candidate.token = text("token");
      break;
    case Source::kConfluence: {
      const auto site = NormalizeSite(text("site"));
      if (!site) return reply(Outcome::Error(kErrArgument, "Confluence needs an https:// site address"));
      candidate.site = *site;
      candidate.user = text("email");
      candidate.token = text("token");
      break;
    }
    case Source::kGdrive: {
      candidate.client_id = text("clientId");
      candidate.client_secret = text("clientSecret");
      const std::string code = text("code");
      const std::string verifier = text("verifier");
      if (!Printable(candidate.client_id, kMaxFieldBytes) || !Printable(candidate.client_secret, kMaxFieldBytes) ||
          !Printable(code, kMaxFieldBytes) || !Printable(verifier, 256) || text("redirectUri") != kGoogleRedirect)
        return reply(Outcome::Error(kErrArgument, "Google sign-in details are incomplete"));
      const uint64_t serial = Open(std::move(id), source, std::move(reply));
      if (serial) ConnectGoogle(serial, std::move(candidate), code, verifier);
      return;
    }
  }
  if (!ValidCredential(candidate)) return reply(Outcome::Error(kErrArgument, "The sign-in details are incomplete"));
  const uint64_t serial = Open(std::move(id), source, std::move(reply));
  if (serial) Verify(serial, std::move(candidate));
}

void LiveCore::Verify(uint64_t serial, Credential candidate) {
  const Source source = candidate.source;
  std::string error;
  std::optional<HttpRequest> request;
  if (source == Source::kGithub) {
    JsonValue params = JsonValue::Object();
    params.Set("query", JsonValue::String(kViewerQuery));
    request = BuildRequest(source, "graphql", params, &candidate, &error);
  } else {
    const char* operation = source == Source::kBitbucket ? "user" : source == Source::kNotion ? "me" : "current";
    request = BuildRequest(source, operation, JsonValue::Object(), &candidate, &error);
  }
  if (!request) return Finish(serial, Outcome::Error(kErrArgument, error));
  Send(serial, std::move(*request), [this, serial, source, candidate = std::move(candidate)](HttpResponse response) mutable {
    if (!Alive(serial)) return;
    if (auto failure = Failure(response)) return Finish(serial, std::move(*failure));
    auto body = JsonBody(response);
    if (!body || !body->is_object()) return Finish(serial, Unreadable());
    JsonValue value = std::move(*body);
    if (source == Source::kGithub) {
      const JsonValue* data = value.Find("data");
      const JsonValue* viewer = data && data->is_object() ? data->Find("viewer") : nullptr;
      if (!viewer || !viewer->is_object() || !Text(*viewer, "login"))
        return Finish(serial, Outcome::Error(kErrSignedOut, "GitHub didn't accept the token"));
    } else if ((source == Source::kBitbucket && !Text(value, "account_id")) ||
               (source == Source::kConfluence && !Text(value, "accountId"))) {
      return Finish(serial, Unreadable());
    }
    Commit(serial, std::move(candidate), [this, serial, value = std::move(value)](const Credential&) mutable {
      Finish(serial, Outcome::Value(std::move(value)));
    });
  });
}

void LiveCore::ConnectGithubDevice(uint64_t serial, std::string client_id, std::string device_code) {
  HttpRequest request = Post(std::string(kGithubWeb) + "/login/oauth/access_token", "application/x-www-form-urlencoded",
                             Form({{"client_id", client_id},
                                   {"device_code", device_code},
                                   {"grant_type", "urn:ietf:params:oauth:grant-type:device_code"}}));
  Send(serial, std::move(request), [this, serial](HttpResponse response) {
    if (!Alive(serial)) return;
    if (auto failure = Failure(response)) return Finish(serial, std::move(*failure));
    const auto body = JsonBody(response);
    if (!body || !body->is_object()) return Finish(serial, Unreadable());
    if (const std::string* token = Text(*body, "access_token")) {
      Credential candidate;
      candidate.source = Source::kGithub;
      candidate.token = *token;
      if (!ValidCredential(candidate)) return Finish(serial, Unreadable());
      auto& call = calls_[serial];
      Reply original = std::move(call.reply);
      call.reply = [original = std::move(original)](Outcome outcome) {
        if (!outcome.ok) return original(std::move(outcome));
        JsonValue connected = JsonValue::Object();
        connected.Set("status", JsonValue::String("connected"));
        const JsonValue* data = outcome.value.Find("data");
        connected.Set("viewer", data && data->Find("viewer") ? *data->Find("viewer") : JsonValue::Null());
        original(Outcome::Value(std::move(connected)));
      };
      return Verify(serial, std::move(candidate));
    }
    const std::string* error = Text(*body, "error");
    if (!error) return Finish(serial, Unreadable());
    JsonValue state = JsonValue::Object();
    if (*error == "authorization_pending") {
      state.Set("status", JsonValue::String("pending"));
      return Finish(serial, Outcome::Value(std::move(state)));
    }
    if (*error == "slow_down") {
      state.Set("status", JsonValue::String("slowDown"));
      if (const auto interval = PositiveInteger(*body, "interval"))
        state.Set("interval", JsonValue::Number(static_cast<double>(std::min<int64_t>(*interval, 600))));
      return Finish(serial, Outcome::Value(std::move(state)));
    }
    Finish(serial, Outcome::Error(kErrSignedOut, DeviceError(*error)));
  });
}

void LiveCore::ConnectGoogle(uint64_t serial, Credential candidate, std::string code, std::string verifier) {
  HttpRequest request = Post(kGoogleToken, "application/x-www-form-urlencoded",
                             Form({{"client_id", candidate.client_id},
                                   {"client_secret", candidate.client_secret},
                                   {"code", code},
                                   {"code_verifier", verifier},
                                   {"grant_type", "authorization_code"},
                                   {"redirect_uri", kGoogleRedirect}}));
  Wipe(code);
  Wipe(verifier);
  Send(serial, std::move(request), [this, serial, candidate = std::move(candidate)](HttpResponse response) mutable {
    if (!Alive(serial)) return;
    if (InvalidGrant(response))
      return Finish(serial, Outcome::Error(kErrSignedOut, "Google didn't accept the sign-in"));
    if (auto failure = Failure(response)) return Finish(serial, std::move(*failure));
    const auto body = JsonBody(response);
    if (!body || !body->is_object()) return Finish(serial, Unreadable());
    const std::string* access = Text(*body, "access_token");
    const std::string* refresh = Text(*body, "refresh_token");
    const auto expires = PositiveInteger(*body, "expires_in");
    if (!refresh) return Finish(serial, Outcome::Error(kErrSignedOut, "Google didn't return a refresh token"));
    if (!access || !expires) return Finish(serial, Unreadable());
    candidate.token = *access;
    candidate.refresh_token = *refresh;
    candidate.expires_at_ms = now_ms_() + *expires * 1000;
    if (!ValidCredential(candidate)) return Finish(serial, Unreadable());
    Commit(serial, std::move(candidate), [this, serial](const Credential& committed) {
      std::string error;
      auto about = BuildRequest(Source::kGdrive, "about", JsonValue::Object(), &committed, &error);
      if (!about) return Finish(serial, Outcome::Error(kErrArgument, error));
      Send(serial, std::move(*about), [this, serial](HttpResponse response) {
        JsonValue value = JsonValue::Object();
        const auto body = Failure(response) ? std::nullopt : JsonBody(response);
        value.Set("about", body && body->is_object() ? *body : JsonValue::Null());
        Finish(serial, Outcome::Value(std::move(value)));
      });
    });
  });
}

void LiveCore::CancelCaller(std::string_view caller) {
  const std::string prefix = std::string(caller) + ":";
  std::vector<uint64_t> owned;
  for (const auto& [serial, call] : calls_) {
    if (call.id.starts_with(prefix)) owned.push_back(serial);
  }
  for (const uint64_t serial : owned) Finish(serial, Cancelled());
}

void LiveCore::Cancel(const std::string& id, Reply reply) {
  const auto found = ids_.find(id);
  if (found == ids_.end()) return reply(Outcome::Value(JsonValue::Bool(false)));
  Finish(found->second, Cancelled());
  reply(Outcome::Value(JsonValue::Bool(true)));
}

void LiveCore::Disconnect(Source source, Reply reply) {
  Cached& cached = cache_[source];
  ++cached.generation;
  cached.state = Cached::State::kAbsent;
  cached.credential.reset();
  std::vector<uint64_t> owned;
  for (const auto& [serial, call] : calls_) {
    if (call.source == source) owned.push_back(serial);
  }
  for (const uint64_t serial : owned) Finish(serial, Cancelled());
  store_.Delete(source, [reply = std::move(reply)](KeyStatus status) {
    if (status == KeyStatus::kOk || status == KeyStatus::kNotFound) return reply(Outcome::Value(JsonValue::Bool(true)));
    reply(KeyringFailure(status));
  });
}

}
