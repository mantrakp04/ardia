import assert from "node:assert/strict";
import { test } from "node:test";
import { historyOf, historyViewOf } from "../history/history.ts";
import { bookmarkRoots } from "../bookmarks/bookmarks.ts";
import { useBrowser } from "../browser/store.ts";
import { startHistory, reloadHistory } from "../history/engineSync.ts";
import { startBookmarks, reloadBookmarks } from "../bookmarks/engineSync.ts";
import { pageOf, patchPage, markTabReady, isTabReady } from "../tabs/pageState.ts";
import * as stub from "../../test-native/index.ts";
const S = () => useBrowser.getState();

test("reassignment immediately uses the target history and bookmark cache, even after zero Spaces", async () => {
  S().hydrate({});
  stub.docs.clear();stub.historyDbs.clear();stub.bookmarkDbs.clear();
  const profile = S().createProfile({ name: "Work" });
  const space = S().createSpace({ name: "Work", profileId: profile });
  stub.chromeVisit(profile, "https://work.test", "Work history");
  stub.chromeBookmarkEdit(profile, [{ op: "add", id: "11111111-1111-4111-8111-111111111111", k: "u", t: "Work bookmark", u: "https://work.test", a: 1, parent: "bar", index: 0 }]);
  const stopHistory=startHistory();const stopBookmarks=startBookmarks();
  try {
    await reloadHistory();await reloadBookmarks();
    assert.equal(historyOf(S(), space)[0].url,"https://work.test");
    S().assignSpaceProfile(space,"default");
    S().assignSpaceProfile("default",profile);
    assert.equal(historyOf(S(), "default")[0].url,"https://work.test");
    assert.equal(historyViewOf(S(), "default").ready,true);
    const bar=bookmarkRoots(S(), "default").bar;
    const bookmark=S().bookmarks.nodes[S().bookmarks.nodes[bar].children[0]];
    assert.equal(bookmark.title,"Work bookmark");
    assert.equal(S().bookmarksReady[profile],true);
  } finally {stopHistory();stopBookmarks();}
});

test("changing browsing identity drops old page state and loading flags while a same-Profile move retains them", () => {
  S().hydrate({});
  const profile=S().createProfile({name:"Work"});
  const shared=S().createSpace({name:"Shared",profileId:"default"});
  const window=S().createWindow({url:"https://form.test"});
  const tab=S().windows[window].tabIds[0];
  patchPage(tab,{security:{url:"https://form.test"},status:"old profile",fullscreen:true});
  markTabReady(tab);
  S().switchSpace(window,shared);
  assert.equal(pageOf(tab).status,"old profile");
  S().updateLive(tab,{canGoBack:true,playingAudio:true,isLoading:false});
  S().assignSpaceProfile("default",profile);
  assert.equal(pageOf(tab).status,"");
  assert.equal(pageOf(tab).security,null);
  assert.equal(pageOf(tab).fullscreen,false);
  assert.equal(isTabReady(tab),false);
  assert.equal(S().live[tab].canGoBack,false);
  assert.equal(S().live[tab].playingAudio,false);
  assert.equal(S().live[tab].isLoading,true);
});
