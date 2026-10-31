// Copyright 2026 Ardia. Apache-2.0.

#ifndef CHROME_BROWSER_ARDIA_PUBLIC_AC_ENGINE_H_
#define CHROME_BROWSER_ARDIA_PUBLIC_AC_ENGINE_H_

#ifdef __cplusplus
extern "C" {
#endif

#define AC_ENGINE_EXPORT __attribute__((visibility("default")))

#define AC_ENGINE_ABI_VERSION 2

typedef void (*ac_engine_reply_t)(void* context, const char* json);
typedef void (*ac_engine_call_t)(const char* profile_dir,
                                 const char* args_json,
                                 ac_engine_reply_t reply,
                                 void* context);
typedef void (*ac_engine_event_t)(void* context,
                                  const char* topic,
                                  const char* json);

typedef void (*ac_engine_dispatch_t)(const char* name,
                                     const char* profile_dir,
                                     const char* args_json,
                                     ac_engine_reply_t reply,
                                     void* context);

typedef int (*ac_engine_abi_version_t)(void);
typedef void (*ac_engine_set_event_sink_t)(ac_engine_event_t sink,
                                           void* context);

AC_ENGINE_EXPORT int ac_engine_abi_version(void);
AC_ENGINE_EXPORT void ac_engine_call(const char* name,
                                     const char* profile_dir,
                                     const char* args_json,
                                     ac_engine_reply_t reply,
                                     void* context);
AC_ENGINE_EXPORT void ac_engine_set_event_sink(ac_engine_event_t sink,
                                               void* context);

#ifdef __cplusplus
}
#endif

#endif
