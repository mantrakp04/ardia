#include <android/log.h>
#include <fbjni/fbjni.h>
#include <hermes/hermes.h>
#include <jni.h>
#include <jsi/jsi.h>

#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

using facebook::hermes::HermesRuntime;
namespace jsi = facebook::jsi;

namespace {

jclass stringClass = nullptr;
jclass scriptErrorClass = nullptr;
jmethodID callHostMethod = nullptr;

struct Engine {
  std::unique_ptr<HermesRuntime> runtime;
  JNIEnv *env = nullptr;
  jobject owner = nullptr;
};

class Scope {
 public:
  Scope(Engine &engine, JNIEnv *env, jobject owner) : engine_(engine), env_(engine.env), owner_(engine.owner) {
    engine.env = env;
    engine.owner = owner;
  }
  ~Scope() {
    engine_.env = env_;
    engine_.owner = owner_;
  }

 private:
  Engine &engine_;
  JNIEnv *env_;
  jobject owner_;
};

class Bytes : public jsi::Buffer {
 public:
  explicit Bytes(std::vector<uint8_t> bytes) : bytes_(std::move(bytes)) {}
  size_t size() const override { return bytes_.size(); }
  const uint8_t *data() const override { return bytes_.data(); }

 private:
  std::vector<uint8_t> bytes_;
};

struct Failure {
  std::string message;
};

std::u16string javaText(JNIEnv *env, jstring value) {
  if (value == nullptr) return {};
  jsize length = env->GetStringLength(value);
  const jchar *chars = env->GetStringChars(value, nullptr);
  std::u16string text(reinterpret_cast<const char16_t *>(chars), static_cast<size_t>(length));
  env->ReleaseStringChars(value, chars);
  return text;
}

jstring javaString(JNIEnv *env, const std::u16string &text) {
  return env->NewString(reinterpret_cast<const jchar *>(text.data()), static_cast<jsize>(text.size()));
}

std::string utf8(const std::u16string &text) {
  std::string out;
  out.reserve(text.size());
  for (size_t i = 0; i < text.size(); i++) {
    uint32_t c = text[i];
    if (c >= 0xD800 && c <= 0xDBFF && i + 1 < text.size() && text[i + 1] >= 0xDC00 && text[i + 1] <= 0xDFFF) {
      c = 0x10000 + ((c - 0xD800) << 10) + (text[i + 1] - 0xDC00);
      i++;
    } else if (c >= 0xD800 && c <= 0xDFFF) {
      c = 0xFFFD;
    }
    if (c < 0x80) {
      out.push_back(static_cast<char>(c));
    } else if (c < 0x800) {
      out.push_back(static_cast<char>(0xC0 | (c >> 6)));
      out.push_back(static_cast<char>(0x80 | (c & 0x3F)));
    } else if (c < 0x10000) {
      out.push_back(static_cast<char>(0xE0 | (c >> 12)));
      out.push_back(static_cast<char>(0x80 | ((c >> 6) & 0x3F)));
      out.push_back(static_cast<char>(0x80 | (c & 0x3F)));
    } else {
      out.push_back(static_cast<char>(0xF0 | (c >> 18)));
      out.push_back(static_cast<char>(0x80 | ((c >> 12) & 0x3F)));
      out.push_back(static_cast<char>(0x80 | ((c >> 6) & 0x3F)));
      out.push_back(static_cast<char>(0x80 | (c & 0x3F)));
    }
  }
  return out;
}

std::u16string jsText(jsi::Runtime &rt, const jsi::Value &value) {
  if (value.isString()) return value.getString(rt).utf16(rt);
  return value.toString(rt).utf16(rt);
}

std::string describeThrown(jsi::Runtime &rt, const jsi::Value &value) {
  std::string message;
  std::string stack;
  if (value.isObject()) {
    jsi::Object object = value.getObject(rt);
    jsi::Value text = object.getProperty(rt, "message");
    if (!text.isUndefined() && !text.isNull()) message = utf8(jsText(rt, text));
    jsi::Value trace = object.getProperty(rt, "stack");
    if (trace.isString()) stack = utf8(trace.getString(rt).utf16(rt));
  }
  if (message.empty()) message = utf8(jsText(rt, value));
  if (stack.empty() || stack == "undefined") return message;
  return message + "\n" + stack;
}

std::string describe(const jsi::JSError &error) {
  const std::string &stack = error.getStack();
  if (stack.empty() || stack == "undefined") return error.getMessage();
  return error.getMessage() + "\n" + stack;
}

void throwScriptError(JNIEnv *env, const std::string &message) {
  if (env->ExceptionCheck()) return;
  env->ThrowNew(scriptErrorClass, message.c_str());
}

std::string throwableText(JNIEnv *env, jthrowable thrown) {
  jclass throwable = env->FindClass("java/lang/Throwable");
  jmethodID toString = env->GetMethodID(throwable, "toString", "()Ljava/lang/String;");
  auto text = static_cast<jstring>(env->CallObjectMethod(thrown, toString));
  env->DeleteLocalRef(throwable);
  if (env->ExceptionCheck()) {
    env->ExceptionClear();
    return "host function failed";
  }
  std::string out = utf8(javaText(env, text));
  env->DeleteLocalRef(text);
  return out;
}

Engine &engineOf(jlong handle) { return *reinterpret_cast<Engine *>(handle); }

void drain(HermesRuntime &runtime) {
  while (!runtime.drainMicrotasks()) {
  }
}

jsi::Value hostCall(Engine &engine, const std::u16string &name, jsi::Runtime &rt, const jsi::Value *args, size_t count) {
  JNIEnv *env = engine.env;
  if (env == nullptr || engine.owner == nullptr) throw jsi::JSError(rt, "the host isn't attached");
  if (env->PushLocalFrame(static_cast<jint>(count) + 8) != 0) throw jsi::JSError(rt, "out of JNI references");
  jobjectArray array = env->NewObjectArray(static_cast<jsize>(count), stringClass, nullptr);
  for (size_t i = 0; i < count; i++) {
    jstring item = javaString(env, jsText(rt, args[i]));
    env->SetObjectArrayElement(array, static_cast<jsize>(i), item);
    env->DeleteLocalRef(item);
  }
  jstring jname = javaString(env, name);
  auto result = static_cast<jstring>(env->CallObjectMethod(engine.owner, callHostMethod, jname, array));
  if (env->ExceptionCheck()) {
    jthrowable thrown = env->ExceptionOccurred();
    env->ExceptionClear();
    std::string message = throwableText(env, thrown);
    env->PopLocalFrame(nullptr);
    throw jsi::JSError(rt, message);
  }
  std::u16string text = javaText(env, result);
  env->PopLocalFrame(nullptr);
  return jsi::String::createFromUtf16(rt, text);
}

jsi::Function hostFunction(jsi::Runtime &rt, const char *name, unsigned count, jsi::HostFunctionType body) {
  return jsi::Function::createFromHostFunction(rt, jsi::PropNameID::forAscii(rt, name), count, std::move(body));
}

jsi::Value target(jsi::Runtime &rt, const std::u16string &global, const std::u16string &function) {
  std::string space = utf8(global);
  std::string name = utf8(function);
  jsi::Value namespaceValue = rt.global().getProperty(rt, jsi::PropNameID::forUtf8(rt, space));
  if (!namespaceValue.isObject()) throw Failure{space + "." + name + " doesn't exist"};
  jsi::Value member = namespaceValue.getObject(rt).getProperty(rt, jsi::PropNameID::forUtf8(rt, name));
  if (!member.isObject() || !member.getObject(rt).isFunction(rt)) throw Failure{space + "." + name + " doesn't exist"};
  return member;
}

std::vector<jsi::Value> parsedArguments(JNIEnv *env, jsi::Runtime &rt, jobjectArray arguments, const std::string &function) {
  jsi::Function parse = rt.global().getPropertyAsObject(rt, "JSON").getPropertyAsFunction(rt, "parse");
  std::vector<jsi::Value> values;
  jsize count = arguments == nullptr ? 0 : env->GetArrayLength(arguments);
  values.reserve(static_cast<size_t>(count));
  for (jsize i = 0; i < count; i++) {
    auto item = static_cast<jstring>(env->GetObjectArrayElement(arguments, i));
    std::u16string text = javaText(env, item);
    env->DeleteLocalRef(item);
    try {
      values.push_back(parse.call(rt, jsi::String::createFromUtf16(rt, text)));
    } catch (const jsi::JSError &error) {
      throw Failure{"bad argument for " + function + ": " + describe(error)};
    }
  }
  return values;
}

jsi::Value invoke(JNIEnv *env, Engine &engine, jstring global, jstring function, jobjectArray arguments) {
  jsi::Runtime &rt = *engine.runtime;
  std::u16string space = javaText(env, global);
  std::u16string name = javaText(env, function);
  jsi::Value member = target(rt, space, name);
  std::vector<jsi::Value> values = parsedArguments(env, rt, arguments, utf8(name));
  const jsi::Value *first = values.empty() ? nullptr : values.data();
  return member.getObject(rt).asFunction(rt).call(rt, first, values.size());
}

std::u16string stringified(jsi::Runtime &rt, const jsi::Value &value) {
  jsi::Function stringify = rt.global().getPropertyAsObject(rt, "JSON").getPropertyAsFunction(rt, "stringify");
  jsi::Value encoded = stringify.call(rt, value);
  if (encoded.isUndefined() || encoded.isNull()) return u"null";
  return jsText(rt, encoded);
}

const char *setup =
    "globalThis.__host = {};"
    "globalThis.console = { log: (...a) => __log(a.join(' ')), warn: (...a) => __log(a.join(' ')), error: (...a) => __log(a.join(' ')) };"
    "globalThis.__settle = (p, ok, bad) => Promise.resolve(p).then((v) => ok(JSON.stringify(v) ?? 'null'), (e) => bad(e));";

}

extern "C" JNIEXPORT jint JNI_OnLoad(JavaVM *vm, void *) {
  bool ready = false;
  jint version = facebook::jni::initialize(vm, [&ready] {
    JNIEnv *env = facebook::jni::Environment::current();
    stringClass = static_cast<jclass>(env->NewGlobalRef(env->FindClass("java/lang/String")));
    scriptErrorClass = static_cast<jclass>(env->NewGlobalRef(env->FindClass("com/ardia/shared/ScriptError")));
    jclass engine = env->FindClass("com/ardia/shared/ScriptEngine");
    callHostMethod = env->GetMethodID(engine, "callHost", "(Ljava/lang/String;[Ljava/lang/String;)Ljava/lang/String;");
    env->DeleteLocalRef(engine);
    ready = stringClass != nullptr && scriptErrorClass != nullptr && callHostMethod != nullptr;
  });
  return ready ? version : JNI_ERR;
}

extern "C" JNIEXPORT jlong JNICALL Java_com_ardia_shared_ScriptEngine_nativeCreate(JNIEnv *env, jobject self) {
  auto config = ::hermes::vm::RuntimeConfig::Builder().withMicrotaskQueue(true).withES6BlockScoping(true).withEnableAsyncGenerators(true).build();
  auto engine = std::make_unique<Engine>();
  try {
    engine->runtime = facebook::hermes::makeHermesRuntime(config);
    Engine *raw = engine.get();
    Scope scope(*raw, env, self);
    jsi::Runtime &rt = *raw->runtime;
    rt.global().setProperty(rt, "__log", hostFunction(rt, "__log", 1, [](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *args, size_t count) {
      if (count > 0) __android_log_print(ANDROID_LOG_DEBUG, "ArdiaJS", "%s", utf8(jsText(rt, args[0])).c_str());
      return jsi::Value::undefined();
    }));
    rt.evaluateJavaScript(std::make_shared<jsi::StringBuffer>(setup), "ardia://setup.js");
    drain(*raw->runtime);
  } catch (const jsi::JSError &error) {
    throwScriptError(env, describe(error));
    return 0;
  } catch (const std::exception &error) {
    throwScriptError(env, std::string("Hermes didn't start: ") + error.what());
    return 0;
  }
  return reinterpret_cast<jlong>(engine.release());
}

extern "C" JNIEXPORT void JNICALL Java_com_ardia_shared_ScriptEngine_nativeDestroy(JNIEnv *, jobject, jlong handle) {
  delete reinterpret_cast<Engine *>(handle);
}

extern "C" JNIEXPORT jint JNICALL Java_com_ardia_shared_ScriptEngine_nativeBytecodeVersion(JNIEnv *, jclass) {
  auto *root = jsi::castInterface<facebook::hermes::IHermesRootAPI>(facebook::hermes::makeHermesRootAPI());
  return root == nullptr ? -1 : static_cast<jint>(root->getBytecodeVersion());
}

extern "C" JNIEXPORT void JNICALL Java_com_ardia_shared_ScriptEngine_nativeEvaluate(JNIEnv *env, jobject self, jlong handle, jbyteArray source, jstring name) {
  Engine &engine = engineOf(handle);
  Scope scope(engine, env, self);
  jsize length = env->GetArrayLength(source);
  std::vector<uint8_t> data(static_cast<size_t>(length));
  env->GetByteArrayRegion(source, 0, length, reinterpret_cast<jbyte *>(data.data()));
  std::string url = "ardia://" + utf8(javaText(env, name));
  try {
    jsi::Runtime &rt = *engine.runtime;
    rt.evaluateJavaScript(std::make_shared<Bytes>(std::move(data)), url);
    drain(*engine.runtime);
  } catch (const jsi::JSError &error) {
    throwScriptError(env, describe(error));
  } catch (const std::exception &error) {
    throwScriptError(env, error.what());
  }
}

extern "C" JNIEXPORT void JNICALL Java_com_ardia_shared_ScriptEngine_nativeRegister(JNIEnv *env, jobject self, jlong handle, jstring name) {
  Engine &engine = engineOf(handle);
  Scope scope(engine, env, self);
  std::u16string key = javaText(env, name);
  Engine *raw = &engine;
  try {
    jsi::Runtime &rt = *engine.runtime;
    jsi::Object host = rt.global().getPropertyAsObject(rt, "__host");
    std::string label = utf8(key);
    host.setProperty(rt, jsi::PropNameID::forUtf8(rt, label), hostFunction(rt, label.c_str(), 0, [raw, key](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *args, size_t count) {
      return hostCall(*raw, key, rt, args, count);
    }));
  } catch (const jsi::JSError &error) {
    throwScriptError(env, describe(error));
  } catch (const std::exception &error) {
    throwScriptError(env, error.what());
  }
}

extern "C" JNIEXPORT jstring JNICALL Java_com_ardia_shared_ScriptEngine_nativeCall(JNIEnv *env, jobject self, jlong handle, jstring global, jstring function, jobjectArray arguments) {
  Engine &engine = engineOf(handle);
  Scope scope(engine, env, self);
  try {
    jsi::Runtime &rt = *engine.runtime;
    jsi::Value raw = invoke(env, engine, global, function, arguments);
    std::u16string out = stringified(rt, raw);
    drain(*engine.runtime);
    return javaString(env, out);
  } catch (const Failure &failure) {
    throwScriptError(env, failure.message);
  } catch (const jsi::JSError &error) {
    throwScriptError(env, describe(error));
  } catch (const std::exception &error) {
    throwScriptError(env, error.what());
  }
  return nullptr;
}

extern "C" JNIEXPORT jstring JNICALL Java_com_ardia_shared_ScriptEngine_nativeCallAsync(JNIEnv *env, jobject self, jlong handle, jstring global, jstring function, jobjectArray arguments) {
  Engine &engine = engineOf(handle);
  Scope scope(engine, env, self);
  std::u16string space = javaText(env, global);
  std::u16string name = javaText(env, function);
  try {
    jsi::Runtime &rt = *engine.runtime;
    jsi::Value promise = invoke(env, engine, global, function, arguments);
    auto fulfilled = std::make_shared<std::optional<std::u16string>>();
    auto rejected = std::make_shared<std::optional<std::string>>();
    jsi::Function ok = hostFunction(rt, "ok", 1, [fulfilled](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *args, size_t count) {
      *fulfilled = count > 0 ? jsText(rt, args[0]) : u"null";
      return jsi::Value::undefined();
    });
    jsi::Function bad = hostFunction(rt, "bad", 1, [rejected](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *args, size_t count) {
      *rejected = count > 0 ? describeThrown(rt, args[0]) : std::string("rejected");
      return jsi::Value::undefined();
    });
    rt.global().getPropertyAsFunction(rt, "__settle").call(rt, promise, ok, bad);
    drain(*engine.runtime);
    if (rejected->has_value()) throw Failure{**rejected};
    if (!fulfilled->has_value()) throw Failure{utf8(space) + "." + utf8(name) + " is waiting on something that never resolves"};
    return javaString(env, **fulfilled);
  } catch (const Failure &failure) {
    throwScriptError(env, failure.message);
  } catch (const jsi::JSError &error) {
    throwScriptError(env, describe(error));
  } catch (const std::exception &error) {
    throwScriptError(env, error.what());
  }
  return nullptr;
}
