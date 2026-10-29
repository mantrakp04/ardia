#include "fixtures/page_state.h"
#include "ardia/linux/ac_linux_page_lease.h"
#include "ardia/linux/ac_linux_security.h"
#include "ardia/linux/ac_linux_history_zoom.h"
#include "ardia/linux/ac_linux_theme.h"
#include "ardia/linux/ac_linux_page_state.h"
#include "ardia/linux/ac_linux_page_status.h"
#include <climits>
#include <limits>

using namespace ardiacore;

namespace ardiacore {
class LinuxPageLeaseTestPeer {
 public:
  static void Sequence(LinuxPageLease& lease,uint64_t value) { lease.sequence_=value; }
  static void Epoch(LinuxPageLease& lease,uint64_t value) { lease.document_epoch_=value; }
};
}

struct Harness {
  Profile profile;
  views::Widget window;
  BrowserWindowInterface browser{&profile};
  content::WebContents shell{&profile}, page{&profile};
  std::vector<base::DictValue> deliveries;
  int snapshots=0;
  std::unique_ptr<LinuxPageMountAuthority> authority;
  std::unique_ptr<LinuxPageLease> lease;
  Harness() {
    browser.strip.tabs.push_back(&page);
    authority=std::make_unique<LinuxPageMountAuthority>(&browser,window.GetWeakPtr(),&page,&shell,LinuxPageIdentity{7,"tab","claim",2,3,4,5});
    lease=std::make_unique<LinuxPageLease>(authority->GetWeakPtr(),[this](std::string module,std::string id,base::DictValue payload) {
      assert(module=="ArdiaWebView" && id=="7"); deliveries.push_back(std::move(payload));
    },[this](LinuxPageRequest request,std::string) { assert(request.Valid()); ++snapshots; });
  }
  void Boundary() { content::Page primary;page.Notify([&](auto* observer) { observer->PrimaryPageChanged(primary); }); }
  void Start(content::NavigationHandle& handle) { page.Notify([&](auto* observer) { observer->DidStartNavigation(&handle); }); }
  void Finish(content::NavigationHandle& handle) { page.Notify([&](auto* observer) { observer->DidFinishNavigation(&handle); }); }
};

base::ListValue Arg(double n) { return base::ListValue().Append(n); }
std::string Text(const base::DictValue& value,const char* key) { auto* result=value.FindString(key);assert(result);return *result; }
double Number(const base::DictValue& value,const char* key) { auto result=value.FindDouble(key);assert(result);return *result; }

void Authority() {
  Harness h;auto request=h.lease->Capture();assert(request && request->Valid());
  h.browser.strip.tabs.clear();assert(!request->Valid());h.browser.strip.tabs.push_back(&h.page);
  ui::BaseWindow other;h.browser.window=&other;assert(!request->Valid());h.browser.window=&h.browser.own_window;
  Profile other_profile;h.page.profile=&other_profile;assert(!request->Valid());h.page.profile=&h.profile;
  h.browser.profile=&other_profile;assert(!request->Valid());h.browser.profile=&h.profile;
  content::RenderFrameHost cached_shell;h.shell.primary=&cached_shell;assert(!request->Valid());h.shell.primary=&h.shell.frame;
  h.shell.frame.NewDocument();assert(!request->Valid());
  Harness retired;auto old=retired.lease->Capture();retired.authority->Invalidate();assert(!old->Valid());
  auto new_authority=std::make_unique<LinuxPageMountAuthority>(&retired.browser,retired.window.GetWeakPtr(),&retired.page,&retired.shell,LinuxPageIdentity{7,"tab","claim",2,3,4,5});
  assert(new_authority->Valid() && !old->Valid());
  Harness gone;auto delayed=gone.lease->Capture();gone.page.Notify([](auto* o) { o->WebContentsDestroyed(); });assert(!delayed->Valid());
  Harness window_gone;
  auto widget=std::make_unique<views::Widget>();
  LinuxPageMountAuthority window_authority(&window_gone.browser,widget->GetWeakPtr(),&window_gone.page,&window_gone.shell,{7,"key","claim",1,1,1,1});
  assert(window_authority.Valid());widget.reset();assert(!window_authority.Valid());
  auto destroyed_profile=std::make_unique<Profile>();content::WebContents detached_page(destroyed_profile.get()),detached_shell(destroyed_profile.get());BrowserWindowInterface detached_browser(destroyed_profile.get());detached_browser.strip.tabs.push_back(&detached_page);
  LinuxPageMountAuthority profile_authority(&detached_browser,window_gone.window.GetWeakPtr(),&detached_page,&detached_shell,{7,"key","claim",1,1,1,1});assert(profile_authority.Valid());destroyed_profile.reset();assert(!profile_authority.Valid());
  Harness missing;auto pending=missing.lease->Capture();missing.authority.reset();assert(!pending->Valid());
  Profile p;content::WebContents page(&p),shell(&p);auto browser=std::make_unique<BrowserWindowInterface>(&p);browser->strip.tabs.push_back(&page);
  LinuxPageMountAuthority authority(browser.get(),h.window.GetWeakPtr(),&page,&shell,{7,"key","a",1,1,1,1});assert(authority.Valid());browser.reset();assert(!authority.Valid());
}

void SplitProfiles() {
  Profile app,page;views::Widget window;BrowserWindowInterface browser{&page};
  content::WebContents shell{&app},tab{&page};browser.strip.tabs.push_back(&tab);
  LinuxPageMountAuthority authority(&browser,window.GetWeakPtr(),&tab,&shell,{7,"key","claim",1,1,1,1});
  assert(authority.Valid() && authority.contents()==&tab);
  Profile other;shell.profile=&other;assert(!authority.Valid());shell.profile=&app;assert(authority.Valid());
  tab.profile=&app;assert(!authority.Valid());tab.profile=&page;assert(authority.Valid());
  auto gone=std::make_unique<Profile>();content::WebContents temporary_shell{gone.get()};
  LinuxPageMountAuthority temporary(&browser,window.GetWeakPtr(),&tab,&temporary_shell,{7,"key","claim",1,1,1,1});
  assert(temporary.Valid());gone.reset();assert(!temporary.Valid());
}

void Documents() {
  Harness h;auto first=h.lease->Capture();content::RenderFrameHost next;h.page.primary=&next;
  assert(first->document.AsRenderFrameHostIfValid() && !first->Valid());h.Boundary();assert(!first->Valid());
  auto second=h.lease->Capture();assert(second && second->document_epoch==2);
  h.page.primary=&h.page.frame;h.Boundary();assert(!second->Valid() && !first->Valid());assert(h.lease->Capture()->document_epoch==3);
  auto restored=h.lease->Capture();h.page.frame.NewDocument();assert(!restored->Valid());h.Boundary();assert(h.lease->Capture());
  auto same=h.lease->Capture();content::NavigationHandle handle;handle.same=true;handle.committed=true;h.Start(handle);h.Finish(handle);assert(same->Valid());
}

void Provisional() {
  Harness pending_mount;pending_mount.page.controller.pending=&pending_mount.page.entry;
  LinuxPageLease initial(pending_mount.authority->GetWeakPtr(),[](std::string,std::string,base::DictValue) {},LinuxPageLease::SnapshotRequest());
  assert(!initial.Capture());auto initial_request=initial.CapturePresentation();assert(initial_request && initial.CreationState(*initial_request,base::ListValue()));
  LinuxSecurity initial_security(initial.GetWeakPtr());LinuxTheme initial_theme(initial.GetWeakPtr(),[] { return base::DictValue(); });
  assert(initial_security.web_contents()==&pending_mount.page && initial_theme.web_contents()==&pending_mount.page);
  assert(Text(initial_security.Snapshot(),"level")=="none" && initial_theme.Snapshot().Find("themeColor")->is_none());
  content::NavigationHandle canceled;pending_mount.Finish(canceled);assert(initial.Capture());
  Harness h;auto before=h.lease->Capture();content::NavigationHandle a;h.Start(a);
  assert(!before->Valid() && !h.lease->Capture() && Text(h.deliveries.back(),"reason")=="provisional");
  a.same=true;h.Finish(a);assert(h.snapshots==1 && h.lease->Capture()->document_epoch==before->document_epoch && !before->Valid());
  auto restored=h.lease->Capture();assert(restored->Valid());
  content::NavigationHandle old,newer;newer.id=2;h.Start(old);h.Start(newer);h.Finish(old);assert(!h.lease->Capture());h.Finish(newer);assert(h.lease->Capture());
  content::NavigationHandle commit;h.Start(commit);h.page.frame.NewDocument();commit.committed=true;h.Boundary();h.Finish(commit);assert(h.lease->Capture()->document_epoch==2);
}

void Overlapping() {
  Harness h;content::NavigationHandle first,second;second.id=2;
  h.Start(first);assert(!h.lease->Capture());
  h.Start(second);h.Finish(second);assert(!h.lease->Capture() && h.snapshots==0);
  h.Finish(first);assert(h.lease->Capture() && h.snapshots==1);
  content::NavigationHandle third,fourth;third.id=3;fourth.id=4;
  h.Start(third);h.Start(fourth);h.Finish(third);h.Finish(third);assert(!h.lease->Capture() && h.snapshots==1);
  h.Finish(fourth);assert(h.lease->Capture() && h.snapshots==2);
  content::NavigationHandle commit,stray;commit.id=5;stray.id=6;
  h.Start(commit);h.Start(stray);h.page.frame.NewDocument();commit.committed=true;h.Boundary();h.Finish(commit);
  assert(h.lease->Capture());h.Finish(stray);assert(h.lease->Capture() && h.snapshots==3);
  Harness pending;pending.page.controller.pending=&pending.page.entry;
  LinuxPageLease mounted(pending.authority->GetWeakPtr(),[](std::string,std::string,base::DictValue) {},LinuxPageLease::SnapshotRequest());
  assert(!mounted.Capture());content::NavigationHandle other;other.id=9;
  pending.Start(other);pending.Finish(other);assert(!mounted.Capture());
  content::NavigationHandle original;original.id=10;pending.Finish(original);assert(mounted.Capture());
}

void CommittedSecurity() {
  Harness h;LinuxSecurity security(h.lease->GetWeakPtr());
  h.page.security.connection_info_initialized=true;h.page.security.certificate=std::make_shared<net::X509Certificate>();
  content::NavigationEntry pending;pending.url=GURL("https://pending.test/");h.page.controller.visible=&pending;
  auto info=security.Snapshot();assert(Text(info,"url")=="https://example.test/" && Text(info,"level")=="none" && !info.Find("certificate"));
  pending.url=GURL("http://pending.test/");assert(Text(security.Snapshot(),"url")=="https://example.test/");
  h.page.controller.visible=nullptr;assert(Text(security.Snapshot(),"level")=="secure" && Text(security.Snapshot(),"url")=="https://example.test/");
  h.page.entry.url=GURL("http://plain.test/");h.page.controller.visible=&pending;pending.url=GURL("https://pending.test/");
  assert(Text(security.Snapshot(),"level")=="insecure" && Text(security.Snapshot(),"url")=="http://plain.test/");
}

void Transport() {
  Harness h;auto created=h.lease->CreationState(*h.lease->Capture(),base::ListValue());assert(created);
  auto* snapshot=created->FindDict("snapshot");assert(Number(*snapshot,"watermark")==1);
  auto request=h.lease->Capture();assert(h.lease->Emit(*request,"security",base::Value()));
  auto& message=h.deliveries.back();assert(Text(message,"claim")=="claim" && Text(message,"rendererGeneration")=="2" && Text(message,"bindingGeneration")=="3");
  assert(Number(message,"sequence")==2);h.Boundary();assert(Number(h.deliveries.back(),"sequence")==3 && Text(h.deliveries.back(),"documentEpoch")=="2");
  assert(h.lease->EmitSnapshot(*h.lease->Capture(),base::ListValue(),"document"));assert(Number(h.deliveries.back(),"sequence")==4);
  assert(!h.lease->Emit(*request,"security",base::Value()));
  assert(!h.lease->EmitSnapshot(*request,base::ListValue(),"restore"));
  Harness overflow;LinuxPageLeaseTestPeer::Sequence(*overflow.lease,9007199254740990ULL);auto last=overflow.lease->Capture();assert(overflow.lease->Emit(*last,"focus",base::Value()));assert(Number(overflow.deliveries.back(),"sequence")==9007199254740991.0);assert(!overflow.lease->Emit(*last,"focus",base::Value()) && !last->Valid());
  Harness epoch_overflow;LinuxPageLeaseTestPeer::Epoch(*epoch_overflow.lease,std::numeric_limits<uint64_t>::max());epoch_overflow.Boundary();assert(!epoch_overflow.lease->Capture());
  h.lease->Reset();assert(!h.lease->EmitSnapshot(*request,base::ListValue(),"restore"));
}

void Security() {
  Harness h;LinuxSecurity security(h.lease->GetWeakPtr());
  auto level=[&] { return Text(security.Snapshot(),"level"); };
  assert(level()=="none");
  h.page.security.connection_info_initialized=true;assert(level()=="none");
  h.page.security.certificate=std::make_shared<net::X509Certificate>();assert(level()=="secure");
  h.page.security.connection_status=net::SSL_CONNECTION_VERSION_TLS1_3;
  auto info=security.Snapshot();assert(Text(info,"protocol")=="TLS 1.3");assert(Number(*info.FindDict("certificate"),"validFrom")==1700000000123.0);
  assert(Number(*info.FindDict("certificate"),"validUntil")==1900000000456.0 && Number(*info.FindDict("certificate"),"chainLength")==3);
  assert(Text(*info.FindDict("certificate"),"serialNumber")=="0102FF");
  h.page.security.cert_status=net::CERT_STATUS_DATE_INVALID;assert(level()=="certificateError");
  h.page.security.cert_status=net::CERT_STATUS_NO_REVOCATION_MECHANISM;assert(level()=="secure");
  h.page.security.displayed_mixed_content=true;assert(level()=="mixed");assert(Text(security.Snapshot(),"mixedContent")=="displayed");
  h.page.security.ran_mixed_content=true;assert(Text(security.Snapshot(),"mixedContent")=="ran");
  h.page.security.cert_status=net::CERT_STATUS_COMMON_NAME_INVALID;assert(level()=="certificateError");
  h.page.security={};h.page.entry.url=GURL("http://example.test/");assert(level()=="insecure" && !security.Snapshot().Find("certificate"));
  for (const auto* local:{"file:///tmp/test","chrome://settings/","chrome-untrusted://test/","devtools://test/"}) { h.page.entry.url=GURL(local);assert(level()=="local"); }
  for (const auto* unknown:{"about:blank","data:text/html,test","blob:https://example.test/1","custom:test","https://example.test/"}) { h.page.entry.url=GURL(unknown);assert(level()=="none"); }
  h.page.controller.entry=nullptr;assert(level()=="none");h.page.controller.entry=&h.page.entry;
  h.page.security.connection_info_initialized=true;h.page.security.certificate=std::make_shared<net::X509Certificate>();h.page.entry.initial=true;assert(level()=="none");h.page.entry.initial=false;
  h.page.Notify([](auto* o) { o->DidChangeVisibleSecurityState(); });assert(Text(h.deliveries.back().FindDict("event")->Find("data")->GetDict(),"level")=="secure");
  content::NavigationHandle provisional;h.Start(provisional);assert(!security.Emit() && !security.Snapshot().Find("certificate"));h.Finish(provisional);assert(level()=="secure");
  security.Reset();assert(!security.Emit() && level()=="none");
}

void History() {
  Harness h;zoom::ZoomController controller;h.page.zoom=&controller;LinuxHistoryZoom zoom(h.lease->GetWeakPtr());
  for (double bad:{1.5,static_cast<double>(INT_MAX)+1,static_cast<double>(INT_MIN)-1,std::numeric_limits<double>::infinity(),std::numeric_limits<double>::quiet_NaN()}) assert(!zoom.GoToOffset(Arg(bad)));
  assert(!zoom.GoToOffset(base::ListValue()) && !zoom.GoToOffset(base::ListValue().Append("2")) && !zoom.GoToOffset(base::ListValue().Append(true)) && !zoom.GoToOffset(base::ListValue().Append(1).Append(2)));
  assert(zoom.GoToOffset(Arg(0)) && h.page.controller.checks==0);
  assert(zoom.GoToOffset(Arg(INT_MIN)) && zoom.GoToOffset(Arg(INT_MAX)) && h.page.controller.goes==0);
  assert(zoom.GoToOffset(Arg(-2)) && h.page.controller.last==-2 && h.page.controller.current==0);
  assert(zoom.GoToOffset(Arg(3)) && h.page.controller.current==3);
  controller.level=2;controller.fallback=1;auto info=zoom.Snapshot();assert(info && std::abs(Number(*info,"zoom")-1.44)<1e-12 && !info->Find("isDefault")->GetBool());
  assert(zoom.ZoomStep(Arg(0)) && controller.level==1 && zoom.Snapshot()->Find("isDefault")->GetBool());
  assert(zoom.ZoomStep(Arg(1)) && controller.level==2);assert(!zoom.ZoomStep(Arg(2)));
}

void HistoryBounds() {
  Harness h;zoom::ZoomController controller;h.page.zoom=&controller;LinuxHistoryZoom zoom(h.lease->GetWeakPtr());
  for (int current:{-1,0,2,INT_MAX-2}) {
    h.page.controller.current=current;
    h.page.controller.size=current<0?0:INT_MAX;
    assert(zoom.GoToOffset(Arg(INT_MIN)) && zoom.GoToOffset(Arg(INT_MAX)));
    assert(h.page.controller.current==current && h.page.controller.goes==0 && h.page.controller.checks==0);
  }
  h.page.controller.current=INT_MAX-2;
  assert(zoom.GoToOffset(Arg(1)) && h.page.controller.current==INT_MAX-1 && h.page.controller.checks==1);
}

void Domain() {
  assert(std::size(kLinuxZoomDomainRoutes)==2);
  for (const char* route:kLinuxZoomDomainRoutes) assert(IsLinuxZoomDomainRoute(route));
  assert(!IsLinuxZoomDomainRoute("sites.settings") && !IsLinuxZoomDomainRoute("sites.zoom"));
  assert(PrepareLinuxZoomDomain(kLinuxZoomDomainRoutes[0],base::DictValue()) && PrepareLinuxZoomDomain(kLinuxZoomDomainRoutes[1],base::DictValue().Set("host","a").Set("zoom",1.0)));
  auto request=PrepareLinuxZoomDomain("sites.zoomLevels",base::DictValue());assert(request && request->service=="ac_zoom_list" && request->args.empty());
  auto set=PrepareLinuxZoomDomain("sites.setZoom",base::DictValue().Set("host","EXAMPLE.TEST").Set("zoom",1.44));assert(set && Text(set->args,"host")=="example.test" && std::abs(Number(set->args,"level")-2)<1e-12 && !set->args.Find("zoom"));
  for(const auto* host:{"","https://test/","a/b","a@b","a b","a:123", "a:", "a\\b"}) assert(!PrepareLinuxZoomDomain("sites.setZoom",base::DictValue().Set("host",host).Set("zoom",1)));
  assert(!PrepareLinuxZoomDomain("sites.setZoom",base::DictValue().Set("host",std::string(254,'a')).Set("zoom",1)));
  for(double bad:{0.,-1.,std::numeric_limits<double>::infinity(),std::numeric_limits<double>::quiet_NaN()}) assert(!PrepareLinuxZoomDomain("sites.setZoom",base::DictValue().Set("host","a").Set("zoom",bad)));
  assert(!PrepareLinuxZoomDomain("sites.setZoom",base::DictValue().Set("host","a").Set("zoom",1).Set("tab",7)));
  auto factors=CompleteLinuxZoomDomain("sites.zoomLevels",base::DictValue().Set("levels",base::DictValue().Set("EXAMPLE.TEST",2.0).Set("other.test",0.5)));assert(factors && Number(factors->GetDict(),"example.test")==1.44 && Number(factors->GetDict(),"other.test")==1.10);
  assert(CompleteLinuxZoomDomain("sites.setZoom",base::DictValue())->is_none());
  assert(!CompleteLinuxZoomDomain("sites.zoomLevels",base::DictValue()));
  auto skipped=CompleteLinuxZoomDomain("sites.zoomLevels",base::DictValue().Set("levels",base::DictValue().Set("a",std::numeric_limits<double>::infinity()).Set("ok.test",2.0)));
  assert(skipped && skipped->GetDict().size()==1 && Number(skipped->GetDict(),"ok.test")==1.44);
  auto with_file=CompleteLinuxZoomDomain("sites.zoomLevels",base::DictValue().Set("levels",base::DictValue().Set("file:///home/user/page.html",2.0).Set("example.test",-2.0)));
  assert(with_file && with_file->GetDict().size()==1 && !with_file->GetDict().Find("file:///home/user/page.html"));
  assert(Number(with_file->GetDict(),"example.test")==0.69);
  auto tiny=CompleteLinuxZoomDomain("sites.zoomLevels",base::DictValue().Set("levels",base::DictValue().Set("tiny.test",-40.0)));
  assert(tiny && tiny->GetDict().empty());
  assert(!CompleteLinuxZoomDomain("sites.zoomLevels",base::DictValue().Set("levels",base::DictValue().Set("a","2"))));
  for(double bad:{0.24,5.01,1000.,1e-9}) assert(!PrepareLinuxZoomDomain("sites.setZoom",base::DictValue().Set("host","a").Set("zoom",bad)));
  for(double good:{0.25,1.,5.}) assert(PrepareLinuxZoomDomain("sites.setZoom",base::DictValue().Set("host","a").Set("zoom",good)));
}

void Zoom() {
  Harness h;auto controller=std::make_unique<zoom::ZoomController>();h.page.zoom=controller.get();LinuxHistoryZoom zoom(h.lease->GetWeakPtr());assert(controller->observers.size()==1);
  controller->scale_one=false;assert(!zoom.Snapshot() && !zoom.Emit());
  h.page.Notify([](auto* o) { o->OnPageScaleFactorChanged(2.5); });assert(Number(*zoom.Snapshot(),"pinchScale")==2.5);
  h.page.zoom=nullptr;controller.reset();assert(!zoom.Snapshot());zoom.Reset();
  zoom::ZoomController next;h.page.zoom=&next;LinuxHistoryZoom rebound(h.lease->GetWeakPtr());assert(rebound.Emit());rebound.Reset();assert(next.observers.empty());
}

void Theme() {
  Harness h;LinuxTheme theme(h.lease->GetWeakPtr(),[] { return base::DictValue().Set("url","https://example.test/"); });
  assert(theme.Snapshot().Find("themeColor")->is_none() && theme.Snapshot().Find("themeColorSource")->is_none());
  h.page.theme=0xff12abef;assert(Text(theme.Snapshot(),"themeColor")=="#12abef" && Text(theme.Snapshot(),"themeColorSource")=="meta");
  h.page.Notify([](auto* o) { o->DidChangeThemeColor(); });assert(Text(h.deliveries.back().FindDict("event")->Find("data")->GetDict(),"themeColor")=="#12abef");
  h.page.theme.reset();assert(theme.Emit());assert(h.deliveries.back().FindDict("event")->Find("data")->GetDict().Find("themeColor")->is_none());
  h.page.theme=0xffff0000;content::NavigationHandle a;h.Start(a);assert(!theme.Emit() && theme.Snapshot().Find("themeColor")->is_none());h.Finish(a);assert(theme.Emit());theme.Reset();assert(!theme.Emit());
}

void SampledTheme() {
  Harness h;LinuxTheme theme(h.lease->GetWeakPtr(),[] { return base::DictValue().Set("url","https://example.test/"); });
  auto document=h.page.frame.GetWeakDocumentPtr();
  assert(theme.SetSampled(std::make_pair(std::string("#a1b2c3"),std::string("header")),document));
  assert(Text(theme.Snapshot(),"themeColor")=="#a1b2c3" && Text(theme.Snapshot(),"themeColorSource")=="header");
  assert(Text(h.deliveries.back().FindDict("event")->Find("data")->GetDict(),"themeColorSource")=="header");
  h.page.theme=0xff12abef;assert(Text(theme.Snapshot(),"themeColorSource")=="meta");h.page.theme.reset();
  assert(theme.SetSampled(std::nullopt,document) && theme.Snapshot().Find("themeColor")->is_none());
  assert(theme.SetSampled(std::make_pair(std::string("#010203"),std::string("background")),document));
  h.page.frame.NewDocument();h.Boundary();assert(theme.Snapshot().Find("themeColor")->is_none());
  content::RenderFrameHost other;const auto deliveries=h.deliveries.size();
  assert(!theme.SetSampled(std::make_pair(std::string("#000000"),std::string("background")),other.GetWeakDocumentPtr()));
  assert(h.deliveries.size()==deliveries && theme.Snapshot().Find("themeColor")->is_none());
  assert(!theme.SetSampled(std::make_pair(std::string("#000000"),std::string("background")),content::WeakDocumentPtr()));
  auto fresh=h.page.frame.GetWeakDocumentPtr();assert(theme.SetSampled(std::make_pair(std::string("#0a0b0c"),std::string("background")),fresh));
  h.page.primary=&other;assert(theme.Snapshot().Find("themeColor")->is_none());h.page.primary=&h.page.frame;
  theme.Reset();assert(theme.Snapshot().Find("themeColor")->is_none());
}

void Reentrant() {
  Harness h;
  std::unique_ptr<LinuxSecurity> security;
  std::unique_ptr<LinuxPageLease> lease;
  lease=std::make_unique<LinuxPageLease>(h.authority->GetWeakPtr(),[&](std::string,std::string,base::DictValue) { security.reset();lease.reset(); },LinuxPageLease::SnapshotRequest());
  security=std::make_unique<LinuxSecurity>(lease->GetWeakPtr());assert(security->Emit());assert(!security && !lease);
  std::unique_ptr<LinuxTheme> theme;
  theme=std::make_unique<LinuxTheme>(h.lease->GetWeakPtr(),[&] { theme.reset();return base::DictValue(); });assert(!theme->Emit() && !theme);
  std::unique_ptr<LinuxPageLease> boundary;
  boundary=std::make_unique<LinuxPageLease>(h.authority->GetWeakPtr(),[](std::string,std::string,base::DictValue) {},[&](LinuxPageRequest,std::string) { boundary.reset(); });h.Boundary();assert(!boundary);
  std::unique_ptr<LinuxPageLease> reset_lease;
  reset_lease=std::make_unique<LinuxPageLease>(h.authority->GetWeakPtr(),[&](std::string,std::string,base::DictValue) { reset_lease.reset(); },LinuxPageLease::SnapshotRequest());h.Boundary();assert(!reset_lease);
  zoom::ZoomController controller;h.page.zoom=&controller;
  std::unique_ptr<LinuxHistoryZoom> zoom_helper;
  LinuxPageLease zoom_lease(h.authority->GetWeakPtr(),[&](std::string,std::string,base::DictValue) { zoom_helper.reset(); },LinuxPageLease::SnapshotRequest());
  zoom_helper=std::make_unique<LinuxHistoryZoom>(zoom_lease.GetWeakPtr());assert(zoom_helper->ZoomStep(Arg(1)));assert(!zoom_helper && controller.observers.empty());
}

struct Mount {
  Profile profile;
  views::Widget window;
  BrowserWindowInterface browser{&profile};
  content::WebContents shell{&profile}, page{&profile};
  zoom::ZoomController controller;
  blocked_content::PopupBlockerTabHelper popup_helper;
  std::vector<base::DictValue> deliveries;
  int navigations=0;
  std::function<void()> on_delivery;
  std::unique_ptr<LinuxPageState> state;
  explicit Mount(uint64_t binding=3) {
    browser.strip.tabs.push_back(&page);page.zoom=&controller;page.popups=&popup_helper;
    state=std::make_unique<LinuxPageState>(&browser,window.GetWeakPtr(),&page,&shell,LinuxPageIdentity{7,"tab","claim",2,binding,1,9},
      [this](std::string module,std::string id,base::DictValue payload) { assert(module=="ArdiaWebView" && id=="7");deliveries.push_back(std::move(payload));if(on_delivery) on_delivery(); },
      [this] { ++navigations;return base::DictValue().Set("url",page.entry.url.spec()).Set("title","T").Set("canGoBack",true).Set("canGoForward",false).Set("isLoading",false); });
  }
  void Boundary() { content::Page primary;page.Notify([&](auto* observer) { observer->PrimaryPageChanged(primary); }); }
  void Remount(uint64_t binding) {
    state=std::make_unique<LinuxPageState>(&browser,window.GetWeakPtr(),&page,&shell,LinuxPageIdentity{7,"tab","claim",2,binding,1,9},
      [this](std::string module,std::string id,base::DictValue payload) { assert(module=="ArdiaWebView" && id=="7");deliveries.push_back(std::move(payload));if(on_delivery) on_delivery(); },
      [this] { ++navigations;return base::DictValue().Set("url",page.entry.url.spec()).Set("title","T").Set("canGoBack",true).Set("canGoForward",false).Set("isLoading",false); });
  }
  void Start(content::NavigationHandle& handle) { page.Notify([&](auto* observer) { observer->DidStartNavigation(&handle); }); }
  void Finish(content::NavigationHandle& handle) { page.Notify([&](auto* observer) { observer->DidFinishNavigation(&handle); }); }
  const base::DictValue& Last() { assert(!deliveries.empty());return deliveries.back(); }
  std::string LastName() { return Text(*Last().FindDict("event"),"name"); }
  const base::DictValue& LastData() { return Last().FindDict("event")->Find("data")->GetDict(); }
};

const base::DictValue& EventAt(const base::DictValue& holder,size_t index,const char* name) {
  const auto& list=holder.Find("events")->GetList();assert(index<list.size());
  const auto& event=list[index].GetDict();assert(Text(event,"name")==name);return event.Find("data")->GetDict();
}

void Creation() {
  Mount m;m.page.theme=0xff102030;m.page.security.connection_info_initialized=true;m.page.security.certificate=std::make_shared<net::X509Certificate>();m.controller.level=1;
  auto created=m.state->CreationState();assert(created && m.deliveries.empty());
  const auto& lease=*created->FindDict("lease");assert(Text(lease,"claim")=="claim" && Text(lease,"rendererGeneration")=="2" && Text(lease,"bindingGeneration")=="3" && Text(lease,"documentEpoch")=="1");
  const auto& snapshot=*created->FindDict("snapshot");assert(Number(snapshot,"watermark")==Number(lease,"sequence") && snapshot.Find("events")->GetList().size()==6);
  const auto& navigation=EventAt(snapshot,0,"navigation");assert(Text(navigation,"url")=="https://example.test/" && Text(navigation,"themeColor")=="#102030" && Text(navigation,"themeColorSource")=="meta");
  assert(Text(EventAt(snapshot,1,"security"),"level")=="secure");
  assert(std::abs(Number(EventAt(snapshot,2,"zoom"),"zoom")-1.2)<1e-12 && !EventAt(snapshot,2,"zoom").Find("isDefault")->GetBool());
  for (auto* observer:std::vector<zoom::ZoomObserver*>(m.controller.observers)) observer->OnZoomControllerDestroyed(&m.controller);
  auto without_zoom=m.state->CreationState();assert(without_zoom->FindDict("snapshot")->Find("events")->GetList().size()==5 && m.controller.observers.empty());
  Mount provisional;content::NavigationHandle start;provisional.Start(start);auto cleared=provisional.state->CreationState();assert(cleared);
  const auto& cleared_navigation=EventAt(*cleared->FindDict("snapshot"),0,"navigation");assert(cleared_navigation.Find("themeColor")->is_none());
  assert(Text(EventAt(*cleared->FindDict("snapshot"),1,"security"),"level")=="none");
  Mount gone;gone.browser.strip.tabs.clear();assert(!gone.state->CreationState());
  Mount retired;retired.state->Retire();assert(!retired.state->CreationState() && !retired.state->EmitNavigation());
}

void PageMessages() {
  Mount m;int calls=0;
  m.state->SetMessageSnapshot([&] { ++calls;base::ListValue events;events.Append(base::DictValue().Set("name","pageMessage").Set("data",base::DictValue().Set("kind","scroll").Set("data",base::DictValue().Set("state","down"))));return events; });
  auto created=m.state->CreationState();const auto& snapshot=*created->FindDict("snapshot");
  const auto& list=snapshot.Find("events")->GetList();assert(calls==1 && Text(list[list.size()-1].GetDict(),"name")=="pageMessage");
  assert(m.state->SetSampledTheme(std::make_pair(std::string("#334455"),std::string("header")),m.page.frame.GetWeakDocumentPtr()));
  assert(m.LastName()=="navigation" && Text(m.LastData(),"themeColor")=="#334455" && Text(m.LastData(),"themeColorSource")=="header");
  m.page.frame.NewDocument();m.Boundary();
  const auto& events=m.Last().Find("events")->GetList();assert(Text(m.Last(),"action")=="snapshot");
  assert(EventAt(m.Last(),0,"navigation").Find("themeColor")->is_none() && Text(events[events.size()-1].GetDict(),"name")=="pageMessage");
  m.state->SetMessageSnapshot([] { base::ListValue events;for (int i=0;i<20;++i) events.Append(base::DictValue().Set("name","pageMessage").Set("data",base::DictValue()));return events; });
  auto capped=m.state->CreationState();assert(capped->FindDict("snapshot")->Find("events")->GetList().size()<=6+8);
  std::unique_ptr<LinuxPageState>* holder=&m.state;
  m.state->SetMessageSnapshot([holder] { holder->reset();return base::ListValue(); });auto destroyed=m.state->CreationState();assert(!destroyed && !m.state);
  Mount retired;retired.state->Retire();assert(!retired.state->SetSampledTheme(std::make_pair(std::string("#000000"),std::string("header")),retired.page.frame.GetWeakDocumentPtr()));
}

void Boundaries() {
  Mount m;m.state->CreationState();auto old=m.state->Capture();assert(old);
  m.page.entry.url=GURL("http://plain.test/");m.page.frame.NewDocument();m.Boundary();
  assert(m.deliveries.size()==2);
  assert(Text(m.deliveries[0],"type")=="pageLifecycle" && Text(m.deliveries[0],"action")=="reset" && Text(m.deliveries[0],"reason")=="document" && Text(m.deliveries[0],"documentEpoch")=="2");
  assert(Text(m.deliveries[1],"action")=="snapshot" && Text(m.deliveries[1],"documentEpoch")=="2" && Number(m.deliveries[1],"sequence")>Number(m.deliveries[0],"sequence"));
  assert(Text(m.deliveries[1],"reason")=="document" && m.deliveries[1].Find("events")->GetList().size()==6);
  assert(Text(EventAt(m.deliveries[1],1,"security"),"level")=="insecure" && Text(EventAt(m.deliveries[1],0,"navigation"),"url")=="http://plain.test/");
  assert(!old->Valid() && !EmitLinuxPageEvent(*old,"find",base::Value()) && m.deliveries.size()==2);
  auto current=m.state->Capture();assert(EmitLinuxPageEvent(*current,"find",base::Value(base::DictValue().Set("count",1))) && m.LastName()=="find" && Text(m.Last(),"documentEpoch")=="2");
  content::NavigationHandle pending;m.Start(pending);assert(Text(m.Last(),"reason")=="provisional");
  const auto before=m.deliveries.size();
  assert(!m.state->EmitDocument("favicon",base::Value()) && !EmitLinuxPageEvent(*current,"find",base::Value()) && m.deliveries.size()==before);
  assert(m.state->EmitNavigation() && m.LastName()=="navigation" && m.LastData().Find("themeColor")->is_none());
  assert(m.state->EmitPresentation("progress",base::Value(base::DictValue().Set("progress",0.5))) && m.LastName()=="progress");
  assert(m.state->SecurityInfo().is_none());
  const auto restoring=m.deliveries.size();m.Finish(pending);assert(m.deliveries.size()==restoring+2);
  assert(Text(m.deliveries[restoring],"action")=="snapshot" && Text(m.deliveries[restoring],"documentEpoch")=="2" && m.LastName()=="zoom");
  assert(Text(m.deliveries[restoring],"reason")=="restore");
  assert(!m.state->SecurityInfo().is_none() && Text(m.state->SecurityInfo().GetDict(),"level")=="insecure");
  double last=0;for(const auto& delivery:m.deliveries) { assert(Number(delivery,"sequence")>last);last=Number(delivery,"sequence"); }
}

void Favicons() {
  Mount m;m.page.favicons.push_back(std::make_shared<blink::mojom::FaviconURL>(blink::mojom::FaviconURL{GURL("https://example.test/a.ico")}));
  m.page.favicons.push_back(std::make_shared<blink::mojom::FaviconURL>(blink::mojom::FaviconURL{GURL("https://example.test/b.png")}));
  auto created=m.state->CreationState();const auto& snapshot=*created->FindDict("snapshot");
  const auto& favicon=EventAt(snapshot,3,"favicon");assert(Text(favicon,"url")=="https://example.test/a.ico");
  assert(favicon.Find("urls")->GetList().size()==2 && favicon.Find("urls")->GetList()[1].GetString()=="https://example.test/b.png");
  content::NavigationHandle pending;m.Start(pending);
  assert(!m.state->EmitDocument("favicon",base::Value()));
  m.Finish(pending);
  bool resent=false;for(const auto& delivery:m.deliveries) if(Text(delivery,"type")=="pageLifecycle" && delivery.FindString("reason") && Text(delivery,"reason")=="restore") { EventAt(delivery,3,"favicon");resent=true; }
  assert(resent);
  Mount empty;assert(empty.state->CreationState()->FindDict("snapshot")->Find("events")->GetList().size()==6);
}

void StripLookups() {
  Mount m;m.state->CreationState();
  const int before=m.browser.strip.lookups;
  for(int i=0;i<20;++i) assert(m.state->EmitPresentation("progress",base::Value(base::DictValue().Set("progress",0.5))));
  assert(m.state->EmitNavigation() && m.state->EmitDocument("favicon",base::Value()));
  assert(m.browser.strip.lookups==before);
  content::WebContents other(&m.profile);m.browser.strip.tabs.insert(m.browser.strip.tabs.begin(),&other);
  assert(m.state->EmitNavigation() && m.browser.strip.lookups==before+1);
  assert(m.state->EmitNavigation() && m.browser.strip.lookups==before+1);
  m.browser.strip.tabs[1]=&other;assert(!m.state->EmitNavigation());
  m.browser.strip.tabs={&m.page};assert(m.state->EmitNavigation());
}

void Commands() {
  Mount m;m.page.controller.current=3;m.page.controller.size=4;
  assert(m.state->GoToOffset(Arg(-2)) && m.page.controller.current==1);
  assert(m.state->GoToOffset(Arg(2)) && m.page.controller.current==3);
  assert(m.state->GoToOffset(Arg(-3)) && m.page.controller.current==0);
  assert(m.state->GoToOffset(Arg(-2)) && m.page.controller.current==0 && m.page.controller.goes==3);
  assert(!m.state->GoToOffset(Arg(1.5)) && !m.state->GoToOffset(base::ListValue()));
  content::NavigationHandle pending;m.Start(pending);
  assert(m.state->GoToOffset(Arg(2)) && m.page.controller.current==2);
  assert(m.state->ZoomStep(Arg(1)) && m.controller.level==1);
  m.Finish(pending);
  const auto zooms=m.deliveries.size();
  assert(m.state->ZoomStep(Arg(1)) && m.controller.level==2 && m.deliveries.size()==zooms+1 && m.LastName()=="zoom");
  assert(std::abs(Number(m.LastData(),"zoom")-1.44)<1e-12 && !m.LastData().Find("isDefault")->GetBool() && Text(m.LastData(),"host")=="example.test");
  assert(m.state->ZoomStep(Arg(0)) && m.controller.level==0 && m.LastData().Find("isDefault")->GetBool() && Number(m.LastData(),"zoom")==1);
  assert(!m.state->ZoomStep(Arg(-2)));
  m.state->Retire();assert(!m.state->GoToOffset(Arg(-1)) && !m.state->ZoomStep(Arg(1)) && m.controller.observers.empty());
}

void Closing() {
  Mount m;m.state->CreationState();m.browser.strip.tabs.clear();
  assert(!m.state->EmitNavigation() && !m.state->EmitPresentation("progress",base::Value()));
  assert(m.state->EmitClosed() && m.LastName()=="windowClose" && Text(m.Last(),"claim")=="claim");
  assert(!m.state->EmitClosed() && m.deliveries.size()==1);
  Mount retired;retired.state->Retire();assert(!retired.state->EmitClosed() && retired.deliveries.empty());
  Mount destroyed;auto* page=&destroyed.page;destroyed.state->CreationState();
  page->Notify([](auto* o) { o->WebContentsDestroyed(); });assert(!destroyed.state->EmitClosed() && destroyed.deliveries.empty());
}

void Rebinding() {
  Mount first(3);auto first_request=first.state->Capture();first.state->Retire();
  assert(!first_request->Valid() && !EmitLinuxPageEvent(*first_request,"find",base::Value()));
  first.state=std::make_unique<LinuxPageState>(&first.browser,first.window.GetWeakPtr(),&first.page,&first.shell,LinuxPageIdentity{7,"tab","claim",2,4,1,9},
      [&first](std::string,std::string,base::DictValue payload) { first.deliveries.push_back(std::move(payload)); },[] { return base::DictValue(); });
  assert(!first_request->Valid());auto created=first.state->CreationState();assert(Text(*created->FindDict("lease"),"bindingGeneration")=="4");
  assert(first.controller.observers.size()==1);
  Mount reentrant;reentrant.state->CreationState();reentrant.on_delivery=[&] { reentrant.state.reset(); };
  reentrant.page.frame.NewDocument();reentrant.Boundary();assert(!reentrant.state && reentrant.deliveries.size()==1);
  Mount snapshot_reentrant;snapshot_reentrant.state->CreationState();int seen=0;snapshot_reentrant.on_delivery=[&] { if(++seen==2) snapshot_reentrant.state.reset(); };
  snapshot_reentrant.page.frame.NewDocument();snapshot_reentrant.Boundary();assert(!snapshot_reentrant.state && snapshot_reentrant.deliveries.size()==2 && snapshot_reentrant.controller.observers.empty());
  Mount navigation_reentrant;bool destroy=false;
  navigation_reentrant.state=std::make_unique<LinuxPageState>(&navigation_reentrant.browser,navigation_reentrant.window.GetWeakPtr(),&navigation_reentrant.page,&navigation_reentrant.shell,LinuxPageIdentity{7,"tab","claim",2,5,1,9},
      [](std::string,std::string,base::DictValue) {},[&] { if (destroy) navigation_reentrant.state.reset();return base::DictValue(); });
  destroy=true;assert(!navigation_reentrant.state->EmitNavigation() && !navigation_reentrant.state);
}


const base::DictValue* Named(const base::DictValue& holder,const char* name,size_t skip=0) {
  for (const auto& item:holder.Find("events")->GetList()) {
    const auto& event=item.GetDict();if (Text(event,"name")!=name) continue;
    if (skip--) continue;
    return &event.Find("data")->GetDict();
  }
  return nullptr;
}
size_t Count(const base::DictValue& holder,const char* name) {
  size_t n=0;for (const auto& item:holder.Find("events")->GetList()) n+=Text(item.GetDict(),"name")==name;return n;
}
const base::DictValue& LastSnapshot(Mount& m) {
  for (auto it=m.deliveries.rbegin();it!=m.deliveries.rend();++it) if (Text(*it,"type")=="pageLifecycle" && it->FindString("action") && Text(*it,"action")=="snapshot") return *it;
  assert(false);return m.deliveries.front();
}
const base::DictValue& Created(Mount& m,std::optional<base::DictValue>& holder) { holder=m.state->CreationState();assert(holder);return *holder->FindDict("snapshot"); }

void PageStatus() {
  Mount m;std::optional<base::DictValue> created;
  const auto& initial=Created(m,created);
  assert(Named(initial,"fullscreen")->Find("fullscreen")->GetBool()==false && Text(*Named(initial,"status"),"text").empty());
  assert(Named(initial,"responsive") && !Named(initial,"unresponsive") && !Named(initial,"crashed") && !Named(initial,"popupBlocked"));
  auto* status=m.state->status();assert(status);
  m.page.fullscreen=true;m.page.Notify([](auto* o) { o->DidToggleFullscreenModeForTab(true,true); });
  assert(m.LastName()=="fullscreen" && m.LastData().Find("fullscreen")->GetBool());
  assert(Named(Created(m,created),"fullscreen")->Find("fullscreen")->GetBool());
  m.page.fullscreen=false;m.page.Notify([](auto* o) { o->DidToggleFullscreenModeForTab(false,true); });
  assert(m.LastName()=="fullscreen" && !m.LastData().Find("fullscreen")->GetBool());
  assert(status->TargetURL(GURL("https://example.test/link")) && m.LastName()=="status" && Text(m.LastData(),"text")=="https://example.test/link");
  const auto before=m.deliveries.size();assert(status->TargetURL(GURL("https://example.test/link")) && m.deliveries.size()==before);
  assert(Text(*Named(Created(m,created),"status"),"text")=="https://example.test/link");
  assert(status->TargetURL(GURL()) && Text(m.LastData(),"text").empty());
  content::NavigationHandle pending;m.Start(pending);
  assert(status->TargetURL(GURL("https://example.test/during")) && m.LastName()=="status" && Text(m.LastData(),"text")=="https://example.test/during");
  m.Finish(pending);
  const auto& restored=LastSnapshot(m);assert(Text(restored,"action")=="snapshot" && Text(restored,"reason")=="restore");
  assert(Text(*Named(restored,"status"),"text")=="https://example.test/during" && Named(restored,"fullscreen") && Named(restored,"responsive"));
  m.page.frame.NewDocument();m.Boundary();
  const auto& document=LastSnapshot(m);assert(Text(document,"reason")=="document" && Text(*Named(document,"status"),"text").empty());
  m.page.crashed=base::TERMINATION_STATUS_PROCESS_CRASHED;m.page.crash_code=139;
  assert(status->TargetURL(GURL("https://example.test/before-crash")));
  m.page.Notify([](auto* o) { o->PrimaryMainFrameRenderProcessGone(base::TERMINATION_STATUS_PROCESS_CRASHED); });
  assert(m.LastName()=="crashed" && Number(m.LastData(),"status")==139 && Number(m.LastData(),"code")==139 && Text(m.LastData(),"reason")=="crashed");
  const auto& crashed=Created(m,created);assert(Text(*Named(crashed,"crashed"),"reason")=="crashed" && Text(*Named(crashed,"status"),"text").empty());
  const auto quiet=m.deliveries.size();m.page.crashed.reset();
  m.page.Notify([](auto* o) { o->PrimaryMainFrameRenderProcessGone(base::TERMINATION_STATUS_NORMAL_TERMINATION); });
  m.page.Notify([](auto* o) { o->PrimaryMainFrameRenderProcessGone(base::TERMINATION_STATUS_STILL_RUNNING); });
  assert(m.deliveries.size()==quiet && !Named(Created(m,created),"crashed"));
  assert(LinuxCrashReason(base::TERMINATION_STATUS_PROCESS_WAS_KILLED)=="killed" && LinuxCrashReason(base::TERMINATION_STATUS_OOM)=="oom");
  assert(LinuxCrashReason(base::TERMINATION_STATUS_LAUNCH_FAILED)=="launchFailed" && LinuxCrashReason(base::TERMINATION_STATUS_ABNORMAL_TERMINATION)=="abnormal");
  assert(LinuxCrashReason(base::TERMINATION_STATUS_EVICTED_FOR_MEMORY)=="unknown");
  assert(!LinuxWindowFullScreen(false,false,false) && LinuxWindowFullScreen(true,false,false) && LinuxWindowFullScreen(true,false,true));
  assert(!LinuxWindowFullScreen(true,true,true) && LinuxWindowFullScreen(true,true,false) && !LinuxWindowFullScreen(false,true,false));
  m.browser.strip.tabs.clear();const auto moved=m.deliveries.size();
  assert(!status->TargetURL(GURL("https://example.test/moved")) && m.deliveries.size()==moved);
  m.page.Notify([](auto* o) { o->DidToggleFullscreenModeForTab(true,false); });assert(m.deliveries.size()==moved);
  m.browser.strip.tabs.push_back(&m.page);m.state->Retire();assert(!m.state->status() && m.deliveries.size()==moved);
}

void Hung() {
  Mount m;std::optional<base::DictValue> created;m.state->CreationState();auto* status=m.state->status();
  content::RenderProcessHost process;process.id=5;content::RenderWidgetHost widget(&process,3),other(&process,4);
  int restarts=0;base::RepeatingClosure restart([&] { ++restarts; });
  widget.unresponsive=true;assert(status->Unresponsive(&widget,restart) && m.LastName()=="unresponsive");
  assert(Named(Created(m,created),"unresponsive") && !Named(Created(m,created),"responsive"));
  assert(!status->Responsive(&other));
  widget.unresponsive=false;assert(!Named(Created(m,created),"unresponsive"));widget.unresponsive=true;
  assert(status->Responsive(&widget) && m.LastName()=="responsive" && restarts==0);
  assert(Named(Created(m,created),"responsive"));
  assert(status->Unresponsive(&widget,restart));
  assert(!status->ResolveUnresponsive(base::ListValue()) && !status->ResolveUnresponsive(Arg(1)));
  assert(status->ResolveUnresponsive(base::ListValue().Append(false)) && restarts==1 && process.alive);
  assert(Named(Created(m,created),"responsive") && status->ResolveUnresponsive(base::ListValue().Append(false)) && restarts==1);
  assert(status->Unresponsive(&widget,restart));
  assert(status->ResolveUnresponsive(base::ListValue().Append(true)) && restarts==1 && process.shutdown==content::RESULT_CODE_HUNG && !process.alive);
  content::RenderProcessHost second;second.id=6;content::RenderWidgetHost hung(&second,1);hung.unresponsive=true;
  assert(status->Unresponsive(&hung,restart));
  content::NavigationHandle pending;m.Start(pending);assert(status->Responsive(&hung) && m.LastName()=="responsive");
  assert(status->Unresponsive(&hung,restart) && m.LastName()=="unresponsive");m.Finish(pending);
  m.state->Retire();assert(restarts==1 && !m.state->status() && DeferredLinuxHangs(&m.page)==1);
  m.Remount(4);assert(Named(*m.state->CreationState()->FindDict("snapshot"),"unresponsive") && DeferredLinuxHangs(&m.page)==0);
  assert(m.state->status()->ResolveUnresponsive(base::ListValue().Append(false)) && restarts==2);
  Mount detached;auto* detached_status=detached.state->status();detached.browser.strip.tabs.clear();
  assert(!detached_status->Unresponsive(&hung,restart) && detached.deliveries.empty() && restarts==2);
  detached.browser.strip.tabs.push_back(&detached.page);assert(!Named(*detached.state->CreationState()->FindDict("snapshot"),"unresponsive"));
  Mount gone;auto* gone_status=gone.state->status();assert(gone_status->Unresponsive(&hung,restart));
  gone.page.Notify([](auto* o) { o->WebContentsDestroyed(); });assert(restarts==2);
  {
    Mount dying;dying.state->CreationState();assert(dying.state->status()->Unresponsive(&hung,restart));
    dying.page.destroying=true;dying.state->Retire();assert(restarts==2);dying.page.destroying=false;
  }
  Mount reentrant;reentrant.state->CreationState();reentrant.on_delivery=[&] { reentrant.state.reset(); };
  assert(reentrant.state->status()->Unresponsive(&hung,restart) && !reentrant.state && restarts==2 && DeferredLinuxHangs(&reentrant.page)==1);
  ForgetDeferredLinuxHangs(&reentrant.page);
  {
    Mount two;two.state->CreationState();auto* both=two.state->status();
    content::RenderProcessHost first_process,second_process;first_process.id=21;second_process.id=22;
    content::RenderWidgetHost a(&first_process,1),b(&second_process,1);a.unresponsive=b.unresponsive=true;
    int ra=0,rb=0;
    assert(both->Unresponsive(&a,base::RepeatingClosure([&] { ++ra; })) && both->Unresponsive(&b,base::RepeatingClosure([&] { ++rb; })));
    const auto before=two.deliveries.size();
    assert(both->Responsive(&a) && two.deliveries.size()==before);
    assert(Named(*two.state->CreationState()->FindDict("snapshot"),"unresponsive"));
    assert(both->Unresponsive(&a,base::RepeatingClosure([&] { ++ra; })));
    assert(both->ResolveUnresponsive(base::ListValue().Append(false)) && ra==1 && rb==1);
    assert(both->Unresponsive(&a,base::RepeatingClosure([&] { ++ra; })) && both->Unresponsive(&b,base::RepeatingClosure([&] { ++rb; })));
    assert(both->ResolveUnresponsive(base::ListValue().Append(true)) && first_process.shutdown==content::RESULT_CODE_HUNG && second_process.shutdown==content::RESULT_CODE_HUNG && ra==1 && rb==1);
    assert(both->Unresponsive(&a,base::RepeatingClosure([&] { ++ra; })) && both->Unresponsive(&b,base::RepeatingClosure([&] { ++rb; })));
    assert(both->Responsive(&b) && both->Responsive(&a) && two.LastName()=="responsive" && ra==1 && rb==1);
    assert(both->Unresponsive(&a,base::RepeatingClosure([&] { ++ra; })) && both->Unresponsive(&b,base::RepeatingClosure([&] { ++rb; })));
    two.state->Retire();assert(ra==1 && rb==1 && DeferredLinuxHangs(&two.page)==2);
    a.unresponsive=false;two.Remount(5);const auto adopted=two.state->CreationState();
    assert(Named(*adopted->FindDict("snapshot"),"unresponsive") && DeferredLinuxHangs(&two.page)==0);
    assert(two.state->status()->ResolveUnresponsive(base::ListValue().Append(false)) && ra==1 && rb==2);
  }
}

void DeferredHang() {
  content::RenderProcessHost process;process.id=31;
  int restarts=0;base::RepeatingClosure restart([&] { ++restarts; });
  Mount m;auto* status=m.state->status();m.browser.strip.tabs.clear();
  content::RenderWidgetHost widget(&process,7);widget.unresponsive=true;
  assert(!status->Unresponsive(&widget,restart) && m.deliveries.empty());
  assert(DeferLinuxHang(&m.page,&widget,restart) && DeferredLinuxHangs(&m.page)==1 && restarts==0);
  assert(!DeferLinuxHang(nullptr,&widget,restart) && !DeferLinuxHang(&m.page,nullptr,restart));
  m.browser.strip.tabs.push_back(&m.page);
  assert(Named(*m.state->CreationState()->FindDict("snapshot"),"unresponsive") && DeferredLinuxHangs(&m.page)==0);
  assert(status->ResolveUnresponsive(base::ListValue().Append(false)) && restarts==1);
  assert(DeferLinuxHang(&m.page,&widget,restart) && ResolveDeferredLinuxHang(&m.page,&widget));
  assert(!ResolveDeferredLinuxHang(&m.page,&widget) && DeferredLinuxHangs(&m.page)==0);
  assert(Named(*m.state->CreationState()->FindDict("snapshot"),"responsive") && restarts==1);
  assert(DeferLinuxHang(&m.page,&widget,restart));widget.unresponsive=false;
  assert(Named(*m.state->CreationState()->FindDict("snapshot"),"responsive") && DeferredLinuxHangs(&m.page)==0 && restarts==1);
  {
    content::RenderWidgetHost gone(&process,8);gone.unresponsive=true;assert(DeferLinuxHang(&m.page,&gone,restart));
  }
  content::RenderWidgetHost still(&process,9);still.unresponsive=true;
  Mount other;assert(DeferLinuxHang(&other.page,&still,restart) && DeferredLinuxHangs(&m.page)==0 && DeferredLinuxHangs(&other.page)==1);
  assert(Named(*m.state->CreationState()->FindDict("snapshot"),"responsive") && restarts==1);
  other.page.destroying=true;other.state->Retire();assert(DeferredLinuxHangs(&other.page)==1);
  ForgetDeferredLinuxHangs(&other.page);assert(DeferredLinuxHangs(&other.page)==0 && restarts==1);
  Profile profile;auto unclaimed=std::make_unique<content::WebContents>(&profile);content::WebContents* gone_tab=unclaimed.get();
  assert(DeferLinuxHang(gone_tab,&still,restart) && DeferredLinuxHangs(gone_tab)==1);
  assert(DeferLinuxHang(gone_tab,&widget,restart) && DeferredLinuxHangs(gone_tab)==2);
  unclaimed.reset();assert(DeferredLinuxHangs(gone_tab)==0 && restarts==1);
}

void Popups() {
  Mount m;std::optional<base::DictValue> created;m.state->CreationState();auto* status=m.state->status();
  assert(m.popup_helper.manager()->observers.size()==1);
  m.popup_helper.Block(4,GURL("https://pop.test/one"));
  assert(m.LastName()=="popupBlocked" && Text(m.LastData(),"id")=="4" && Text(m.LastData(),"url")=="https://pop.test/one" && Text(m.LastData(),"origin")=="https://example.test");
  assert(Count(Created(m,created),"popupBlocked")==1);
  content::NavigationHandle pending;m.Start(pending);const auto during=m.deliveries.size();
  m.popup_helper.Block(5,GURL("https://pop.test/two"));assert(m.deliveries.size()==during);
  m.Finish(pending);
  const auto& restored=LastSnapshot(m);assert(Text(restored,"reason")=="restore" && Count(restored,"popupBlocked")==2);
  assert(Text(*Named(restored,"popupBlocked",1),"id")=="5");
  assert(!status->OpenBlockedPopup(base::ListValue()) && !status->OpenBlockedPopup(Arg(4)) && !status->OpenBlockedPopup(base::ListValue().Append("x")));
  assert(!status->OpenBlockedPopup(base::ListValue().Append("4").Append(1)) && !status->OpenBlockedPopup(base::ListValue().Append("99")));
  auto* settings=HostContentSettingsMapFactory::GetForProfile(&m.profile);settings->set.clear();
  assert(status->OpenBlockedPopup(base::ListValue().Append("4").Append(true)));
  assert(m.popup_helper.shown.size()==1 && m.popup_helper.shown[0].first==4 && m.popup_helper.shown[0].second==WindowOpenDisposition::NEW_FOREGROUND_TAB);
  assert(settings->set.size()==1 && settings->set[0].first=="https://example.test/" && settings->set[0].second==CONTENT_SETTING_ALLOW);
  assert(!status->OpenBlockedPopup(base::ListValue().Append("4")));
  assert(Count(Created(m,created),"popupBlocked")==1);
  m.page.frame.NewDocument();m.Boundary();
  assert(Text(LastSnapshot(m),"reason")=="document" && Count(LastSnapshot(m),"popupBlocked")==0 && m.popup_helper.blocked.contains(5));
  assert(!status->OpenBlockedPopup(base::ListValue().Append("5")) && m.popup_helper.shown.size()==1);
  m.popup_helper.blocked.clear();
  for (int i=0;i<150;++i) m.popup_helper.Block(1000+i,GURL("https://pop.test/many"));
  assert(Count(Created(m,created),"popupBlocked")==100);
  Mount reentrant;reentrant.state->CreationState();reentrant.popup_helper.Block(7,GURL("https://pop.test/r"));
  reentrant.popup_helper.on_show=[&] { reentrant.state.reset(); };
  assert(reentrant.state->status()->OpenBlockedPopup(base::ListValue().Append("7")) && !reentrant.state && reentrant.popup_helper.manager()->observers.empty());
  m.state->Retire();assert(m.popup_helper.manager()->observers.empty());
  Mount destroyed;destroyed.page.Notify([](auto* o) { o->WebContentsDestroyed(); });assert(destroyed.popup_helper.manager()->observers.empty());
}

void RemountedPopups() {
  Mount m;std::optional<base::DictValue> created;m.state->CreationState();
  m.popup_helper.Block(4,GURL("https://pop.test/one"));m.popup_helper.Block(6,GURL("https://pop.test/two"));
  m.Remount(4);
  assert(m.popup_helper.manager()->observers.size()==1);
  const auto& moved=Created(m,created);
  assert(Count(moved,"popupBlocked")==2 && Text(*Named(moved,"popupBlocked"),"id")=="4" && Text(*Named(moved,"popupBlocked"),"url")=="https://pop.test/one");
  assert(Text(*Named(moved,"popupBlocked",1),"id")=="6" && Text(*Named(moved,"popupBlocked",1),"origin")=="https://example.test");
  assert(m.state->status()->OpenBlockedPopup(base::ListValue().Append("6")));
  assert(m.popup_helper.shown.size()==1 && m.popup_helper.shown[0].first==6 && Count(Created(m,created),"popupBlocked")==1);
  m.popup_helper.Block(8,GURL("https://pop.test/three"));
  assert(m.LastName()=="popupBlocked" && Text(m.LastData(),"id")=="8" && Count(Created(m,created),"popupBlocked")==2);
}

void Producers() {
  Mount m;int runs=0;
  m.state->SetSnapshotProducer([&runs] {
    ++runs;std::vector<std::pair<std::string,base::Value>> events;
    events.emplace_back("media",base::Value(base::DictValue().Set("playing",true).Set("muted",false)));
    events.emplace_back("",base::Value());
    events.emplace_back("pictureInPicture",base::Value(base::DictValue().Set("kind","video").Set("active",true)));
    return events;
  });
  std::optional<base::DictValue> created;const auto& snapshot=Created(m,created);
  const auto& events=snapshot.Find("events")->GetList();
  assert(runs==1 && Text(events[events.size()-2].GetDict(),"name")=="media" && Text(events[events.size()-1].GetDict(),"name")=="pictureInPicture");
  assert(Named(snapshot,"navigation") && Named(snapshot,"status") && Named(snapshot,"media")->FindBool("playing")==true && Named(snapshot,"pictureInPicture")->FindBool("active")==true);
  assert(Count(snapshot,"media")==1 && Count(snapshot,"")==0);
  m.page.frame.NewDocument();m.Boundary();
  const auto& document=LastSnapshot(m);
  assert(runs==2 && Text(document,"reason")=="document" && Named(document,"media")->FindBool("muted")==false && Count(document,"pictureInPicture")==1);
}

void ProducerLifetimes() {
  Mount retired;int runs=0;
  retired.state->Retire();retired.state->SetSnapshotProducer([&runs] { ++runs;return std::vector<std::pair<std::string,base::Value>>(); });
  assert(!retired.state->CreationState() && runs==0);
  Mount reentrant;
  reentrant.state->SetSnapshotProducer([&reentrant] { reentrant.state.reset();return std::vector<std::pair<std::string,base::Value>>(); });
  assert(!reentrant.state->CreationState());
  assert(!reentrant.state && reentrant.deliveries.empty());
  Mount bounded;
  bounded.state->SetSnapshotProducer([] {
    std::vector<std::pair<std::string,base::Value>> events;
    for (int i=0;i<200;++i) events.emplace_back("status",base::Value(base::DictValue().Set("text","")));
    events.emplace_back(std::string(65,'x'),base::Value());
    return events;
  });
  auto created=bounded.state->CreationState();assert(created->FindDict("snapshot")->Find("events")->GetList().size()==128);
}

int main(int argc,char** argv) {
  assert(argc==2);std::string mode=argv[1];
  if(mode=="authority") Authority();else if(mode=="split-profiles") SplitProfiles();else if(mode=="documents") Documents();else if(mode=="provisional") Provisional();else if(mode=="transport") Transport();else if(mode=="security") Security();else if(mode=="history") History();else if(mode=="history-bounds") HistoryBounds();else if(mode=="domain") Domain();else if(mode=="zoom") Zoom();else if(mode=="theme") Theme();else if(mode=="sampled-theme") SampledTheme();else if(mode=="page-messages") PageMessages();else if(mode=="reentrant") Reentrant();else if(mode=="overlapping") Overlapping();else if(mode=="committed-security") CommittedSecurity();else if(mode=="creation") Creation();else if(mode=="boundaries") Boundaries();else if(mode=="commands") Commands();else if(mode=="favicons") Favicons();else if(mode=="strip-lookups") StripLookups();else if(mode=="closing") Closing();else if(mode=="rebinding") Rebinding();else if(mode=="page-status") PageStatus();else if(mode=="hung") Hung();else if(mode=="deferred-hang") DeferredHang();else if(mode=="popups") Popups();else if(mode=="remounted-popups") RemountedPopups();else if(mode=="producers") Producers();else if(mode=="producer-lifetimes") ProducerLifetimes();else return 2;
}
