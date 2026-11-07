#pragma once
namespace content {
struct BrowserThread {
  enum ID { UI };
  static inline bool on_ui = true;
  static bool CurrentlyOn(ID) { return on_ui; }
};
}
