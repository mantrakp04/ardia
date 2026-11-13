#pragma once

#include <xaudio2.h>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <condition_variable>
#include <cstring>
#include <deque>
#include <functional>
#include <mutex>
#include <optional>
#include <string_view>
#include <thread>

#include "resource.h"

#pragma comment(lib, "xaudio2.lib")

namespace Ardia {

namespace IntroMusic {

inline constexpr float kVolume = 1.0f;
inline constexpr double kMuteFadeSeconds = 0.25;
inline constexpr int kFadeStepsPerSecond = 60;

struct Wave {
  WAVEFORMATEX format{};
  const BYTE *samples = nullptr;
  UINT32 bytes = 0;
};

inline HMODULE ThisModule() noexcept {
  HMODULE module = nullptr;
  GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT, reinterpret_cast<LPCWSTR>(&ThisModule), &module);
  return module;
}

inline std::optional<Wave> Embedded() noexcept {
  HMODULE module = ThisModule();
  HRSRC found = FindResourceW(module, MAKEINTRESOURCEW(IDR_INTRO_MUSIC), RT_RCDATA);
  if (!found) return std::nullopt;
  HGLOBAL loaded = LoadResource(module, found);
  DWORD size = SizeofResource(module, found);
  auto *data = static_cast<const BYTE *>(loaded ? LockResource(loaded) : nullptr);
  if (!data || size < 12 || memcmp(data, "RIFF", 4) != 0 || memcmp(data + 8, "WAVE", 4) != 0) return std::nullopt;
  Wave wave;
  bool hasFormat = false;
  for (DWORD at = 12; at + 8 <= size;) {
    std::string_view id{reinterpret_cast<const char *>(data + at), 4};
    DWORD length = 0;
    memcpy(&length, data + at + 4, 4);
    if (length > size - at - 8) return std::nullopt;
    if (id == "fmt " && length >= 16) {
      memcpy(&wave.format, data + at + 8, 16);
      hasFormat = wave.format.wFormatTag == WAVE_FORMAT_PCM;
    } else if (id == "data") {
      wave.samples = data + at + 8;
      wave.bytes = length;
    }
    at += 8 + length + (length & 1);
  }
  if (!hasFormat || !wave.samples || !wave.format.nBlockAlign) return std::nullopt;
  return wave;
}

inline double EmbeddedSeconds() noexcept {
  auto wave = Embedded();
  return wave ? static_cast<double>(wave->bytes / wave->format.nBlockAlign) / wave->format.nSamplesPerSec : 0;
}

inline constexpr auto kQueueIdle = std::chrono::seconds(60);

class Queue {
 public:
  static Queue &Shared() noexcept {
    static Queue queue;
    return queue;
  }

  void Post(std::function<void()> work) noexcept {
    try {
      std::lock_guard guard{m_lock};
      m_work.push_back(std::move(work));
      if (!m_running) {
        std::thread([this]() noexcept { Run(); }).detach();
        m_running = true;
      }
      m_ready.notify_one();
    } catch (...) {
    }
  }

 private:
  void Run() noexcept {
    bool com = SUCCEEDED(CoInitializeEx(nullptr, COINIT_MULTITHREADED));
    for (;;) {
      std::function<void()> work;
      {
        std::unique_lock guard{m_lock};
        if (!m_ready.wait_for(guard, kQueueIdle, [this]() { return !m_work.empty(); })) {
          m_running = false;
          break;
        }
        work = std::move(m_work.front());
        m_work.pop_front();
      }
      try {
        work();
      } catch (...) {
      }
    }
    if (com) CoUninitialize();
  }

  std::mutex m_lock;
  std::condition_variable m_ready;
  std::deque<std::function<void()>> m_work;
  bool m_running = false;
};

class Player {
 public:
  static Player &Shared() noexcept {
    static Player player;
    return player;
  }

  void Play(bool muted, bool silent) noexcept {
    std::lock_guard guard{m_lock};
    auto requested = std::chrono::steady_clock::now();
    StopLocked();
    if (silent) return;
    auto wave = Embedded();
    if (!wave) return;
    if (FAILED(XAudio2Create(m_engine.put(), 0, XAUDIO2_DEFAULT_PROCESSOR)) || FAILED(m_engine->CreateMasteringVoice(&m_master)) ||
        FAILED(m_engine->CreateSourceVoice(&m_voice, &wave->format))) {
      StopLocked();
      return;
    }
    double late = std::chrono::duration<double>(std::chrono::steady_clock::now() - requested).count();
    UINT32 frames = wave->bytes / wave->format.nBlockAlign;
    UINT32 skip = std::min<UINT32>(frames, static_cast<UINT32>(late * wave->format.nSamplesPerSec));
    XAUDIO2_BUFFER buffer{};
    buffer.Flags = XAUDIO2_END_OF_STREAM;
    buffer.AudioBytes = wave->bytes;
    buffer.pAudioData = wave->samples;
    buffer.PlayBegin = skip;
    m_voice->SetVolume(muted ? 0.0f : kVolume);
    if (FAILED(m_voice->SubmitSourceBuffer(&buffer)) || FAILED(m_voice->Start(0))) {
      StopLocked();
      return;
    }
    int session = ++m_session;
    double seconds = static_cast<double>(frames - skip) / wave->format.nSamplesPerSec;
    After(seconds, [this, session]() noexcept {
      std::lock_guard guard{m_lock};
      if (m_session == session) StopLocked();
    });
  }

  void SetMuted(bool muted) noexcept {
    std::lock_guard guard{m_lock};
    FadeLocked(muted ? 0.0f : kVolume, kMuteFadeSeconds, false);
  }

  void Stop(double seconds) noexcept {
    std::lock_guard guard{m_lock};
    if (!m_voice) return;
    FadeLocked(0.0f, seconds, true);
  }

 private:
  template <class TWork>
  static void After(double seconds, TWork work) noexcept {
    try {
      std::thread([seconds, work]() noexcept {
        std::this_thread::sleep_for(std::chrono::duration<double>(std::max(0.0, seconds)));
        work();
      }).detach();
    } catch (...) {
    }
  }

  void FadeLocked(float target, double seconds, bool stopAfter) noexcept {
    if (!m_voice) return;
    int session = m_session;
    int fade = ++m_fade;
    float from = 0;
    m_voice->GetVolume(&from);
    int steps = std::max(1, static_cast<int>(std::lround(seconds * kFadeStepsPerSecond)));
    try {
      std::thread([this, session, fade, from, target, steps, stopAfter]() noexcept {
        for (int step = 1; step <= steps; step++) {
          std::this_thread::sleep_for(std::chrono::milliseconds(1000 / kFadeStepsPerSecond));
          std::lock_guard guard{m_lock};
          if (m_session != session || m_fade != fade || !m_voice) return;
          double t = static_cast<double>(step) / steps;
          double eased = t * t * (3 - 2 * t);
          m_voice->SetVolume(static_cast<float>(from + (target - from) * eased));
        }
        std::lock_guard guard{m_lock};
        if (stopAfter && m_session == session && m_fade == fade) StopLocked();
      }).detach();
    } catch (...) {
      m_voice->SetVolume(target);
      if (stopAfter) StopLocked();
    }
  }

  void StopLocked() noexcept {
    m_session++;
    if (m_voice) {
      m_voice->Stop(0);
      m_voice->DestroyVoice();
      m_voice = nullptr;
    }
    if (m_master) {
      m_master->DestroyVoice();
      m_master = nullptr;
    }
    m_engine = nullptr;
  }

  std::mutex m_lock;
  winrt::com_ptr<IXAudio2> m_engine;
  IXAudio2MasteringVoice *m_master = nullptr;
  IXAudio2SourceVoice *m_voice = nullptr;
  int m_session = 0;
  int m_fade = 0;
};

}

}
