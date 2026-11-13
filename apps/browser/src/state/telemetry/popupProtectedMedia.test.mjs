import assert from "node:assert/strict";
import { test } from "node:test";

const { notePopupProtectedMedia, takePopupProtectedMediaCounts } = await import("./popupProtectedMedia.ts");

const zero = {
  popup_protected_media_refused_widevine_listed: 0,
  popup_protected_media_refused_widevine_unlisted: 0,
  popup_protected_media_refused_playready_listed: 0,
  popup_protected_media_refused_playready_unlisted: 0,
  popup_protected_media_refused_fairplay_listed: 0,
  popup_protected_media_refused_fairplay_unlisted: 0,
  popup_protected_media_refused_other_listed: 0,
  popup_protected_media_refused_other_unlisted: 0,
};

test("nothing counted until a popup is refused protected media", () => {
  assert.deepEqual(takePopupProtectedMediaCounts(), zero);
});

test("each refusal counts once under its key-system family and whether the popup's host is listed, and a take resets", () => {
  notePopupProtectedMedia({ family: "widevine", listed: false });
  notePopupProtectedMedia({ family: "widevine", listed: false });
  notePopupProtectedMedia({ family: "widevine", listed: true });
  notePopupProtectedMedia({ family: "playready", listed: false });
  notePopupProtectedMedia({ family: "fairplay", listed: true });
  assert.deepEqual(takePopupProtectedMediaCounts(), {
    ...zero,
    popup_protected_media_refused_widevine_listed: 1,
    popup_protected_media_refused_widevine_unlisted: 2,
    popup_protected_media_refused_playready_unlisted: 1,
    popup_protected_media_refused_fairplay_listed: 1,
  });
  assert.deepEqual(takePopupProtectedMediaCounts(), zero);
});

test("a family or flag the app doesn't know counts as other and unlisted, never as a new field", () => {
  notePopupProtectedMedia({ family: "clearkey", listed: "yes" });
  notePopupProtectedMedia({ family: "https://audible.com/webplayer" });
  notePopupProtectedMedia(undefined);
  const counts = takePopupProtectedMediaCounts();
  assert.deepEqual(counts, { ...zero, popup_protected_media_refused_other_unlisted: 3 });
  assert.deepEqual(Object.keys(counts), Object.keys(zero));
});
