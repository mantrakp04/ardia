#include "ardia/linux/ac_linux_credentials.h"

#include <charconv>
#include <cmath>
#include <filesystem>
#include <system_error>

namespace ardia::linux_credentials {
namespace {

constexpr std::string_view kSecretNames[] = {
    "passwords.unlock", "passwords.reveal", "passwords.export", "passwords.save",
    "passwords.update", "passwords.add",    "autofill.cardNumber", "autofill.saveCard"};

constexpr std::string_view kManagedNames[] = {
    "passwords.list",     "passwords.remove",      "passwords.neverSaveOrigins",
    "passwords.allowSaving", "passwords.autofillEnabled", "passwords.setAutofillEnabled",
    "autofill.settings",  "autofill.setSettings",  "autofill.addresses",
    "autofill.saveAddress", "autofill.cards",       "autofill.remove"};

constexpr std::string_view kAddressFields[] = {"name",  "organization", "street", "city", "state",
                                               "postalCode", "country", "phone", "email"};

class Sink {
 public:
  explicit Sink(std::string* out) : out_(out) {}
  void Put(std::string_view piece) {
    if (out_) {
      out_->append(piece);
    } else {
      size_ += piece.size();
    }
  }
  void Put(char c) { Put(std::string_view(&c, 1)); }
  size_t size() const { return size_; }

 private:
  std::string* out_;
  size_t size_ = 0;
};

void Quoted(Sink& sink, std::string_view text) {
  static constexpr char kHex[] = "0123456789abcdef";
  sink.Put('"');
  for (char c : text) {
    const unsigned char byte = static_cast<unsigned char>(c);
    if (c == '"' || c == '\\') {
      sink.Put('\\');
      sink.Put(c);
    } else if (byte < 0x20) {
      const char escaped[] = {'\\', 'u', '0', '0', kHex[byte >> 4], kHex[byte & 15]};
      sink.Put(std::string_view(escaped, sizeof(escaped)));
    } else {
      sink.Put(c);
    }
  }
  sink.Put('"');
}

void HexQuoted(Sink& sink, std::string_view secret) {
  static constexpr char kHex[] = "0123456789abcdef";
  sink.Put('"');
  for (char c : secret) {
    const unsigned char byte = static_cast<unsigned char>(c);
    const char pair[] = {kHex[byte >> 4], kHex[byte & 15]};
    sink.Put(std::string_view(pair, 2));
  }
  sink.Put('"');
}

class Json {
 public:
  Json& Text(std::string_view key, std::string value) {
    members_.push_back({std::string(key), Kind::kText, std::move(value), {}, false, 0, {}});
    return *this;
  }
  Json& Secret(std::string_view key, std::string_view secret) {
    members_.push_back({std::string(key) + "Hex", Kind::kSecret, {}, secret, false, 0, {}});
    return *this;
  }
  Json& Flag(std::string_view key, bool value) {
    members_.push_back({std::string(key), Kind::kFlag, {}, {}, value, 0, {}});
    return *this;
  }
  Json& Integer(std::string_view key, long long value) {
    members_.push_back({std::string(key), Kind::kInteger, {}, {}, false, value, {}});
    return *this;
  }
  Json& Nested(std::string_view key, Json value) {
    members_.push_back({std::string(key), Kind::kObject, {}, {}, false, 0, std::move(value.members_)});
    return *this;
  }

  SecretText Build() const {
    Sink measure(nullptr);
    Write(measure, members_);
    std::string out;
    out.reserve(measure.size() + 1);
    Sink sink(&out);
    Write(sink, members_);
    return SecretText(std::move(out));
  }

 private:
  enum class Kind { kText, kSecret, kFlag, kInteger, kObject };
  struct Member {
    std::string key;
    Kind kind;
    std::string text;
    std::string_view secret;
    bool flag;
    long long integer;
    std::vector<Member> members;
  };

  static void Write(Sink& sink, const std::vector<Member>& members) {
    sink.Put('{');
    bool first = true;
    for (const Member& member : members) {
      if (!first) {
        sink.Put(',');
      }
      first = false;
      Quoted(sink, member.key);
      sink.Put(':');
      switch (member.kind) {
        case Kind::kText:
          Quoted(sink, member.text);
          break;
        case Kind::kSecret:
          HexQuoted(sink, member.secret);
          break;
        case Kind::kFlag:
          sink.Put(member.flag ? "true" : "false");
          break;
        case Kind::kInteger:
          sink.Put(std::to_string(member.integer));
          break;
        case Kind::kObject:
          Write(sink, member.members);
          break;
      }
    }
    sink.Put('}');
  }

  std::vector<Member> members_;
};

Plan Invalid(std::string_view code, std::string_view message) {
  Plan plan;
  plan.code = std::string(code);
  plan.message = std::string(message);
  return plan;
}

Plan Engine(std::string_view service, const Json& args, Reply reply, std::vector<Store> stores) {
  Plan plan;
  plan.service = std::string(service);
  plan.args = args.Build();
  plan.reply = reply;
  plan.requires_stores = std::move(stores);
  return plan;
}

bool Contains(const std::string_view* names, size_t count, std::string_view name) {
  for (size_t i = 0; i < count; ++i) {
    if (names[i] == name) {
      return true;
    }
  }
  return false;
}

template <size_t N>
bool Contains(const std::string_view (&names)[N], std::string_view name) {
  return Contains(names, N, name);
}

bool PlainText(std::string_view text, size_t limit) {
  if (text.size() > limit) {
    return false;
  }
  for (char c : text) {
    if (c == '\0') {
      return false;
    }
  }
  return true;
}

bool ValidId(std::string_view id) {
  if (id.empty() || id.size() > kMaxIdBytes) {
    return false;
  }
  for (char c : id) {
    const bool allowed = (c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '-';
    if (!allowed) {
      return false;
    }
  }
  return true;
}

std::optional<long long> WholeNumber(const Arg& arg, long long low, long long high) {
  if (arg.type != Arg::Type::kNumber || !std::isfinite(arg.number) || std::floor(arg.number) != arg.number ||
      arg.number < static_cast<double>(low) || arg.number > static_cast<double>(high)) {
    return std::nullopt;
  }
  return static_cast<long long>(arg.number);
}

std::string NumberText(double number) {
  if (std::isfinite(number) && std::floor(number) == number && std::fabs(number) < 1e15) {
    return std::to_string(static_cast<long long>(number));
  }
  char buffer[64];
  const auto written = std::to_chars(buffer, buffer + sizeof(buffer), number);
  return written.ec == std::errc() ? std::string(buffer, written.ptr) : std::string();
}

bool LoginArgs(const Arg& origin, const Arg& username, Json& json, Plan* failure) {
  if (!origin.is_string() || !username.is_string()) {
    *failure = Invalid("ERR_CREDENTIAL_REQUEST", "An origin and a username are required");
    return false;
  }
  std::optional<std::string> normalized = NormalizeOrigin(origin.text);
  if (!normalized) {
    *failure = Invalid("ERR_CREDENTIAL_REQUEST", "The origin is not a valid web origin");
    return false;
  }
  if (!PlainText(username.text, kMaxUsernameBytes)) {
    *failure = Invalid("ERR_CREDENTIAL_REQUEST", "The username is too long");
    return false;
  }
  json.Text("origin", std::move(*normalized)).Text("username", username.text);
  return true;
}

bool SecretArg(const Arg& value, bool allow_null, Plan* failure) {
  if (value.type == Arg::Type::kNull && allow_null) {
    return true;
  }
  if (!value.is_string() || value.text.empty() || !PlainText(value.text, kMaxSecretBytes)) {
    *failure = Invalid("ERR_CREDENTIAL_REQUEST", "A non-empty password of bounded length is required");
    return false;
  }
  return true;
}

bool CardNumberArg(const Arg& value, bool required, Plan* failure) {
  if (value.type == Arg::Type::kNull && !required) {
    return true;
  }
  if (!value.is_string() || value.text.size() > 64) {
    *failure = Invalid("ERR_CARD_NUMBER", "A card number is required");
    return false;
  }
  size_t digits = 0;
  for (char c : value.text) {
    if (c >= '0' && c <= '9') {
      ++digits;
    } else if (c != ' ' && c != '-') {
      *failure = Invalid("ERR_CARD_NUMBER", "Card numbers contain only digits, spaces and dashes");
      return false;
    }
  }
  if (digits < 12 || digits > 19) {
    *failure = Invalid("ERR_CARD_NUMBER", "Card numbers have 12 to 19 digits");
    return false;
  }
  return true;
}

Plan PlanSaveAddress(const Arg& input) {
  const Arg* address = input.Find("address");
  if (!address || address->type != Arg::Type::kObject) {
    return Invalid("ERR_CREDENTIAL_REQUEST", "An address object is required");
  }
  Json fields;
  if (const Arg* id = address->Find("id"); id && id->type != Arg::Type::kNull) {
    if (!id->is_string() || (!id->text.empty() && !ValidId(id->text))) {
      return Invalid("ERR_CREDENTIAL_REQUEST", "The address id is invalid");
    }
    fields.Text("id", id->text);
  }
  for (std::string_view key : kAddressFields) {
    const Arg* value = address->Find(key);
    if (!value) {
      continue;
    }
    std::string text;
    if (value->is_string()) {
      text = value->text;
    } else if (value->type == Arg::Type::kNumber) {
      text = NumberText(value->number);
    } else {
      continue;
    }
    if (!PlainText(text, kMaxFieldBytes)) {
      return Invalid("ERR_CREDENTIAL_REQUEST", "An address field is too long");
    }
    fields.Text(key, std::move(text));
  }
  return Engine("ac_autofill_save_address", Json().Nested("address", std::move(fields)), Reply::kAsIs,
                {Store::kAddresses});
}

Plan PlanSaveCard(const Arg& card, const Arg& number) {
  if (card.type != Arg::Type::kObject) {
    return Invalid("ERR_CREDENTIAL_REQUEST", "A card object is required");
  }
  Json fields;
  bool existing = false;
  if (const Arg* id = card.Find("id"); id && id->type != Arg::Type::kNull) {
    if (!id->is_string() || (!id->text.empty() && !ValidId(id->text))) {
      return Invalid("ERR_CREDENTIAL_REQUEST", "The card id is invalid");
    }
    existing = !id->text.empty();
    fields.Text("id", id->text);
  }
  if (const Arg* name = card.Find("name"); name && name->type != Arg::Type::kNull) {
    if (!name->is_string() || !PlainText(name->text, kMaxFieldBytes)) {
      return Invalid("ERR_CREDENTIAL_REQUEST", "The name on the card is invalid");
    }
    fields.Text("name", name->text);
  }
  if (const Arg* month = card.Find("expMonth"); month && month->type != Arg::Type::kNull) {
    std::optional<long long> value = WholeNumber(*month, 1, 12);
    if (!value) {
      return Invalid("ERR_CREDENTIAL_REQUEST", "The expiry month is invalid");
    }
    fields.Integer("expMonth", *value);
  }
  if (const Arg* year = card.Find("expYear"); year && year->type != Arg::Type::kNull) {
    std::optional<long long> value = WholeNumber(*year, 2000, 2199);
    if (!value) {
      return Invalid("ERR_CREDENTIAL_REQUEST", "The expiry year is invalid");
    }
    fields.Integer("expYear", *value);
  }
  Plan failure;
  if (!CardNumberArg(number, !existing, &failure)) {
    return failure;
  }
  Json json;
  json.Nested("card", std::move(fields));
  if (number.is_string()) {
    json.Secret("number", number.text);
  }
  return Engine("ac_autofill_save_card", json, Reply::kAsIs, {Store::kCards});
}

}

void Wipe(std::string& text) {
  volatile char* bytes = text.data();
  for (size_t i = 0; i < text.size(); ++i) {
    bytes[i] = 0;
  }
  text.clear();
}

SecretText::SecretText(std::string&& text) : text_(std::move(text)) {
  Wipe(text);
}

SecretText::SecretText(SecretText&& other) noexcept : text_(std::move(other.text_)) {
  Wipe(other.text_);
}

SecretText& SecretText::operator=(SecretText&& other) noexcept {
  if (this != &other) {
    Wipe(text_);
    text_ = std::move(other.text_);
    Wipe(other.text_);
  }
  return *this;
}

SecretText::~SecretText() {
  Wipe(text_);
}

void SecretText::Clear() {
  Wipe(text_);
}

Arg::Arg() = default;
Arg::Arg(const Arg& other) = default;

Arg::Arg(Arg&& other) noexcept
    : type(other.type), text(other.text), flag(other.flag), number(other.number), object(std::move(other.object)) {
  Wipe(other.text);
}

Arg& Arg::operator=(const Arg& other) {
  if (this != &other) {
    Wipe(text);
    type = other.type;
    text = other.text;
    flag = other.flag;
    number = other.number;
    object = other.object;
  }
  return *this;
}

Arg& Arg::operator=(Arg&& other) noexcept {
  if (this != &other) {
    Wipe(text);
    type = other.type;
    text = other.text;
    Wipe(other.text);
    flag = other.flag;
    number = other.number;
    object = std::move(other.object);
  }
  return *this;
}

Arg::~Arg() {
  Wipe(text);
}

Arg Arg::String(std::string_view value) {
  Arg arg;
  arg.type = Type::kString;
  arg.text.assign(value.data(), value.size());
  return arg;
}

Arg Arg::Bool(bool value) {
  Arg arg;
  arg.type = Type::kBool;
  arg.flag = value;
  return arg;
}

Arg Arg::Number(double value) {
  Arg arg;
  arg.type = Type::kNumber;
  arg.number = value;
  return arg;
}

Arg Arg::Null() {
  Arg arg;
  arg.type = Type::kNull;
  return arg;
}

Arg Arg::Other() {
  Arg arg;
  arg.type = Type::kOther;
  return arg;
}

Arg Arg::Object(std::vector<std::pair<std::string, Arg>> members) {
  Arg arg;
  arg.type = Type::kObject;
  arg.object = std::move(members);
  return arg;
}

const Arg* Arg::Find(std::string_view key) const {
  for (const auto& [name, value] : object) {
    if (name == key) {
      return &value;
    }
  }
  return nullptr;
}

Protection ProtectionFromCiphertext(std::string_view ciphertext) {
  const std::string_view tag = ciphertext.substr(0, 3);
  if (tag == "v10") {
    return Protection::kObfuscated;
  }
  if (tag == "v11") {
    return Protection::kKeyring;
  }
  if (tag == "v12") {
    return Protection::kPortal;
  }
  return Protection::kUnknown;
}

Storage DescribeStorage(std::string_view backend, Protection protection) {
  switch (protection) {
    case Protection::kKeyring:
      if (backend == "gnome-libsecret") {
        return {"keyring", false, "the Secret Service keyring"};
      }
      if (backend == "kwallet" || backend == "kwallet5" || backend == "kwallet6") {
        return {"keyring", false, "KWallet"};
      }
      return {"keyring", false, "your desktop keyring (Secret Service or KWallet)"};
    case Protection::kPortal:
      return {"portal", false, "your desktop's secret portal"};
    case Protection::kObfuscated:
      if (backend == "basic") {
        return {"obfuscated", false, "Chromium's basic store, which only obfuscates"};
      }
      return {"obfuscated", true, "Chromium's built-in key, which only obfuscates"};
    case Protection::kNone:
      return {"none", false, "no encryption key"};
    case Protection::kUnknown:
      break;
  }
  return {"unknown", false, "an unknown key"};
}

Availability Assess(Store store, const Probe& probe) {
  const char* unavailable = store == Store::kPasswords ? "ERR_PASSWORDS_UNAVAILABLE" : "ERR_AUTOFILL_UNAVAILABLE";
  if (probe.private_profile) {
    return {false, "privateProfile", "ERR_PROFILE_PRIVATE",
            "Saved passwords and autofill data aren't available in a private window"};
  }
  if (!probe.service) {
    return {false, "noStore", unavailable,
            store == Store::kPasswords ? "The password store isn't running for this profile"
                                       : "Autofill data isn't loaded for this profile"};
  }
  if (store == Store::kPasswords) {
    if (probe.error == StoreError::kKeychain) {
      return {false, "keyringLocked", unavailable,
              "The system keyring is locked or unavailable, so saved passwords can't be read"};
    }
    if (probe.error == StoreError::kInactionable || probe.error == StoreError::kOther) {
      return {false, "storeFailed", unavailable, "The password store couldn't be opened"};
    }
  }
  if (store != Store::kAddresses && (!probe.encryption || !probe.decryption)) {
    return {false, "encryptionUnavailable", unavailable,
            "No encryption key is available to read or protect saved secrets"};
  }
  return {};
}

bool AwaitsStore(StoreError error, int64_t waited_ms) {
  return error == StoreError::kInactionable && waited_ms < kStoreReadyTimeoutMs;
}

bool HandlesCall(std::string_view name) {
  return Contains(kManagedNames, name) || Contains(kSecretNames, name);
}

bool HandlesInvoke(std::string_view method) {
  for (const char* capability : kCapabilities) {
    if (method == capability) {
      return true;
    }
  }
  return false;
}

bool ClaimsInvoke(std::string_view method) {
  for (std::string_view domain : {std::string_view("ArdiaPasswords."), std::string_view("ArdiaAutofill.")}) {
    if (method.size() > domain.size() && method.starts_with(domain)) {
      return true;
    }
  }
  return false;
}

std::optional<std::string> NormalizeOrigin(std::string_view origin) {
  if (origin.empty() || !PlainText(origin, kMaxOriginBytes)) {
    return std::nullopt;
  }
  const size_t separator = origin.find("://");
  if (separator == std::string_view::npos || separator == 0) {
    return std::nullopt;
  }
  std::string scheme(origin.substr(0, separator));
  for (char& c : scheme) {
    const bool letter = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
    const bool other = (c >= '0' && c <= '9') || c == '+' || c == '-' || c == '.';
    if (!letter && !(other && &c != scheme.data())) {
      return std::nullopt;
    }
    if (c >= 'A' && c <= 'Z') {
      c = static_cast<char>(c - 'A' + 'a');
    }
  }
  const bool web = scheme == "http" || scheme == "https";
  std::string_view rest = origin.substr(separator + 3);
  std::string_view authority = rest.substr(0, rest.find_first_of("/?#"));
  if (const size_t at = authority.rfind('@'); web && at != std::string_view::npos) {
    authority = authority.substr(at + 1);
  }
  if (authority.empty()) {
    return std::nullopt;
  }
  std::string host(authority);
  for (char& c : host) {
    const unsigned char byte = static_cast<unsigned char>(c);
    if (byte <= 0x20 || c == '\\' || c == '"' || c == '<' || c == '>') {
      return std::nullopt;
    }
    if (web && c >= 'A' && c <= 'Z') {
      c = static_cast<char>(c - 'A' + 'a');
    }
  }
  return scheme + "://" + host;
}

Plan PlanCall(std::string_view name, const Arg& input) {
  if (Contains(kSecretNames, name)) {
    return Invalid("ERR_SECRET_ROUTE", "Secret operations use their dedicated native method");
  }
  if (!Contains(kManagedNames, name)) {
    return Invalid("ERR_UNKNOWN_CALL", "This call is unavailable on Linux");
  }
  if (input.type != Arg::Type::kObject) {
    return Invalid("ERR_CREDENTIAL_REQUEST", "Arguments must be an object");
  }
  if (name == "passwords.list") {
    return Engine("ac_passwords_list", Json(), Reply::kAsIs, {Store::kPasswords});
  }
  if (name == "passwords.neverSaveOrigins") {
    return Engine("ac_passwords_exceptions", Json(), Reply::kAsIs, {Store::kPasswords});
  }
  if (name == "passwords.remove") {
    const Arg* origin = input.Find("origin");
    const Arg* username = input.Find("username");
    Json json;
    Plan failure;
    if (!origin || !username || !LoginArgs(*origin, *username, json, &failure)) {
      return failure.ok() ? Invalid("ERR_CREDENTIAL_REQUEST", "An origin and a username are required") : std::move(failure);
    }
    return Engine("ac_passwords_remove", json, Reply::kOk, {Store::kPasswords});
  }
  if (name == "passwords.allowSaving") {
    const Arg* origin = input.Find("origin");
    std::optional<std::string> normalized = origin && origin->is_string() ? NormalizeOrigin(origin->text) : std::nullopt;
    if (!normalized) {
      return Invalid("ERR_CREDENTIAL_REQUEST", "The origin is not a valid web origin");
    }
    return Engine("ac_passwords_allow", Json().Text("origin", std::move(*normalized)), Reply::kOk,
                  {Store::kPasswords});
  }
  if (name == "passwords.autofillEnabled") {
    Plan plan;
    plan.reply = Reply::kPreference;
    plan.reads = {{"enabled", kPasswordsEnabledPref}};
    return plan;
  }
  if (name == "passwords.setAutofillEnabled") {
    const Arg* enabled = input.Find("enabled");
    if (!enabled || enabled->type != Arg::Type::kBool) {
      return Invalid("ERR_CREDENTIAL_REQUEST", "A boolean setting is required");
    }
    Plan plan;
    plan.reply = Reply::kNull;
    plan.writes = {{kPasswordsEnabledPref, enabled->flag}};
    return plan;
  }
  if (name == "autofill.settings") {
    Plan plan;
    plan.reply = Reply::kPreferences;
    plan.reads = {{"addresses", kAddressesEnabledPref}, {"cards", kCardsEnabledPref}};
    return plan;
  }
  if (name == "autofill.setSettings") {
    Plan plan;
    plan.reply = Reply::kNull;
    for (const auto& [key, pref] : {std::pair<const char*, const char*>{"addresses", kAddressesEnabledPref},
                                    std::pair<const char*, const char*>{"cards", kCardsEnabledPref}}) {
      const Arg* value = input.Find(key);
      if (!value || value->type == Arg::Type::kNull) {
        continue;
      }
      if (value->type != Arg::Type::kBool) {
        return Invalid("ERR_CREDENTIAL_REQUEST", "Autofill settings are booleans");
      }
      plan.writes.emplace_back(pref, value->flag);
    }
    return plan;
  }
  if (name == "autofill.addresses") {
    return Engine("ac_autofill_addresses", Json(), Reply::kAsIs, {Store::kAddresses});
  }
  if (name == "autofill.cards") {
    return Engine("ac_autofill_cards", Json(), Reply::kAsIs, {Store::kCards});
  }
  if (name == "autofill.saveAddress") {
    return PlanSaveAddress(input);
  }
  const Arg* id = input.Find("id");
  if (!id || !id->is_string() || !ValidId(id->text)) {
    return Invalid("ERR_CREDENTIAL_REQUEST", "A valid id is required");
  }
  return Engine("ac_autofill_remove", Json().Text("id", id->text), Reply::kOk, {Store::kAddresses});
}

Plan PlanWindowInvoke(bool private_window, std::string_view method, const std::vector<Arg>& values) {
  if (private_window) {
    return Invalid("ERR_PROFILE_PRIVATE", kPrivateCredentialsMessage);
  }
  return PlanInvoke(method, values);
}

Plan PlanInvoke(std::string_view method, const std::vector<Arg>& values) {
  if (!HandlesInvoke(method)) {
    return Invalid("ERR_UNKNOWN_CALL", "This method is unavailable on Linux");
  }
  if (values.empty() || !values[0].is_string() || !PlainText(values[0].text, kMaxProfileBytes)) {
    return Invalid("ERR_PROFILE", "A profile identity is required");
  }
  auto arity = [&](size_t count) { return values.size() == count; };
  const auto bad_arity = [] { return Invalid("ERR_CREDENTIAL_REQUEST", "Unexpected arguments"); };
  if (method == "ArdiaPasswords.status" || method == "ArdiaAutofill.status") {
    if (!arity(1)) {
      return bad_arity();
    }
    Plan plan;
    plan.reply = Reply::kStatus;
    return plan;
  }
  if (method == "ArdiaPasswords.unlock") {
    if (!arity(1)) {
      return bad_arity();
    }
    return Engine("ac_passwords_unlock", Json(), Reply::kUnlocked, {Store::kPasswords});
  }
  if (method == "ArdiaPasswords.export") {
    if (!arity(1)) {
      return bad_arity();
    }
    Plan plan;
    plan.reply = Reply::kExport;
    plan.requires_stores = {Store::kPasswords};
    plan.asks_for_path = true;
    return plan;
  }
  if (method == "ArdiaAutofill.cardNumber") {
    if (!arity(2)) {
      return bad_arity();
    }
    if (!values[1].is_string() || !ValidId(values[1].text)) {
      return Invalid("ERR_CREDENTIAL_REQUEST", "A valid card id is required");
    }
    return Engine("ac_autofill_card_number", Json().Text("id", values[1].text), Reply::kCardNumber,
                  {Store::kCards});
  }
  if (method == "ArdiaAutofill.saveCard") {
    if (!arity(3)) {
      return bad_arity();
    }
    return PlanSaveCard(values[1], values[2]);
  }
  Json json;
  Plan failure;
  if (method == "ArdiaPasswords.reveal") {
    if (!arity(3)) {
      return bad_arity();
    }
    if (!LoginArgs(values[1], values[2], json, &failure)) {
      return failure;
    }
    return Engine("ac_passwords_reveal", json, Reply::kPassword, {Store::kPasswords});
  }
  if (method == "ArdiaPasswords.save") {
    if (!arity(4)) {
      return bad_arity();
    }
    if (!LoginArgs(values[1], values[2], json, &failure) || !SecretArg(values[3], false, &failure)) {
      return failure;
    }
    json.Secret("password", values[3].text);
    return Engine("ac_passwords_add", json, Reply::kOk, {Store::kPasswords});
  }
  if (!arity(5)) {
    return bad_arity();
  }
  if (!LoginArgs(values[1], values[2], json, &failure) || !SecretArg(values[4], true, &failure)) {
    return failure;
  }
  const Arg& new_username = values[3];
  if (new_username.is_string()) {
    if (!PlainText(new_username.text, kMaxUsernameBytes)) {
      return Invalid("ERR_CREDENTIAL_REQUEST", "The username is too long");
    }
    json.Text("newUsername", new_username.text);
  } else if (new_username.type != Arg::Type::kNull) {
    return Invalid("ERR_CREDENTIAL_REQUEST", "The new username must be text or null");
  }
  if (values[4].is_string()) {
    json.Secret("newPassword", values[4].text);
  }
  return Engine("ac_passwords_update", json, Reply::kOk, {Store::kPasswords});
}

Plan PlanExport(std::string_view path) {
  if (path.empty() || path[0] != '/' || !PlainText(path, kMaxPathBytes)) {
    return Invalid("ERR_EXPORT_PATH", "An absolute export path is required");
  }
  return Engine("ac_passwords_export", Json().Text("path", std::string(path)), Reply::kExport,
                {Store::kPasswords});
}

SyncedLoginPlans PlanSyncedLogin(std::string_view profile, std::string_view origin, std::string_view username,
                                 std::string_view password) {
  SyncedLoginPlans plans;
  const std::optional<std::string> normalized = NormalizeOrigin(origin);
  if (!normalized || *normalized != origin) {
    return plans;
  }
  std::vector<Arg> values;
  values.push_back(Arg::String(profile));
  values.push_back(Arg::String(origin));
  values.push_back(Arg::String(username));
  values.push_back(Arg::String(password));
  plans.save = PlanInvoke("ArdiaPasswords.save", values);
  values.clear();
  std::vector<std::pair<std::string, Arg>> login;
  login.emplace_back("origin", Arg::String(origin));
  login.emplace_back("username", Arg::String(username));
  plans.remove = PlanCall("passwords.remove", Arg::Object(std::move(login)));
  plans.storable = plans.save.ok() && plans.remove.ok();
  return plans;
}

bool PasswordsSyncUsable(bool skip_undecryptable, bool service, StoreError error) {
  return !skip_undecryptable && service && error == StoreError::kNone;
}

Failure ClassifyEngineError(std::string_view message) {
  struct Known {
    std::string_view message;
    const char* code;
  };
  static constexpr Known kKnown[] = {
      {"OS authentication is unavailable on this platform", "ERR_REAUTH_UNAVAILABLE"},
      {"Not authenticated", "ERR_REAUTH_DENIED"},
      {"no engine data for a private profile", "ERR_PROFILE_PRIVATE"},
      {"no password manager", "ERR_PASSWORDS_UNAVAILABLE"},
      {"no autofill in this profile", "ERR_AUTOFILL_UNAVAILABLE"},
      {"No such password", "ERR_NOT_FOUND"},
      {"No such card", "ERR_NOT_FOUND"},
      {"No such address", "ERR_NOT_FOUND"},
      {"Could not save the password (invalid, or already saved)", "ERR_PASSWORD_REJECTED"},
      {"Could not change the password", "ERR_STORE_WRITE"},
      {"The password store didn't take the change", "ERR_STORE_WRITE"},
      {"Chrome didn't save the change", "ERR_STORE_WRITE"},
      {"invalid number", "ERR_CARD_NUMBER"},
      {"closed", "ERR_ENGINE_CLOSED"},
      {"no reply", "ERR_ENGINE_CLOSED"},
      {"unknown engine service", "ERR_UNKNOWN_CALL"},
      {"origin and password required", "ERR_CREDENTIAL_REQUEST"},
      {"bad arguments", "ERR_CREDENTIAL_REQUEST"},
      {"arguments too large", "ERR_CREDENTIAL_REQUEST"},
      {"arguments are not a JSON object", "ERR_CREDENTIAL_REQUEST"},
      {"an absolute path required", "ERR_EXPORT_PATH"},
      {"address required", "ERR_CREDENTIAL_REQUEST"},
      {"card required", "ERR_CREDENTIAL_REQUEST"},
  };
  for (const Known& known : kKnown) {
    if (message == known.message) {
      return {known.code, std::string(known.message)};
    }
  }
  return {"ERR_ENGINE", "The engine refused the request"};
}

std::string ReauthMessage(std::string_view reason) {
  if (reason == "available") {
    return std::string();
  }
  if (reason == "background") {
    return "System authentication is off in background instances, so secrets stay hidden";
  }
  if (reason == "noPolkit") {
    return "polkit isn't running, so saved passwords and card numbers can't be shown, changed or exported";
  }
  if (reason == "policyMissing") {
    return "Ardia's polkit policy isn't installed in /usr/share/polkit-1/actions (install Ardia from a package or run "
           "its install.sh), so saved passwords and card numbers can't be shown, changed or exported";
  }
  if (reason == "notPermitted") {
    return "This session isn't allowed to authenticate, so saved passwords and card numbers can't be shown, "
           "changed or exported";
  }
  return "System authentication is unavailable, so saved passwords and card numbers can't be shown, changed or "
         "exported";
}

bool ShouldRemoveFailedExport(std::string_view status, bool existed_before, bool exists_now) {
  return status != "succeeded" && status != "inProgress" && !existed_before && exists_now;
}

bool RemoveFailedExport(const std::string& path, std::string_view status, bool existed_before) {
  std::error_code error;
  const bool exists = std::filesystem::is_regular_file(std::filesystem::symlink_status(path, error));
  if (!ShouldRemoveFailedExport(status, existed_before, exists)) {
    return false;
  }
  return std::filesystem::remove(path, error) && !error;
}

}
