from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


class PipLifecycleTests(unittest.TestCase):
    def test_pending_placement_cancels_on_hide_destroy_input_drag_resize_and_timeout(self):
        compiler = shutil.which('c++')
        if not compiler:
            self.skipTest('C++ compiler unavailable')
        source = (Path(__file__).resolve().parents[1] / 'pip/ac_pip_linux.cc').read_text()
        start = source.index('class HyprlandPlacement :')
        end = source.index('\nconstexpr char kBoundsKey', start)
        observer = source[start:end]
        prelude = r'''
#include <cassert>
#include <deque>
#include <functional>
#include <memory>
#include <optional>
#include <set>
#include <string>
#include <tuple>
#include <utility>
#include <vector>
#include <unistd.h>
#define FROM_HERE 0
template<class T> using raw_ptr = T*;
namespace ui {
struct Event {};
enum class EventType { kMousePressed, kKeyPressed, kTouchPressed, kMousewheel, kScroll };
struct EventObserver { virtual ~EventObserver()=default; virtual void OnEvent(const Event&) {} };
}
namespace base {
int now=0;
struct TimeTicks {
 int n=0;
 static TimeTicks Now() { return {now}; }
 friend TimeTicks operator+(TimeTicks t,int d) {return {t.n+d};}
 bool operator>=(TimeTicks t)const{return n>=t.n;}
};
int Seconds(int n){return n*1000;}
int Milliseconds(int n){return n;}
template<class T> struct WeakPtr {
 T* value;
 std::weak_ptr<int> generation;
 explicit operator bool() const {return !generation.expired();}
 T* get()const{return value;}
};
template<class T> struct WeakPtrFactory {
 T* value;
 std::shared_ptr<int> generation=std::make_shared<int>(0);
 explicit WeakPtrFactory(T* v):value(v){}
 WeakPtr<T> GetWeakPtr(){return {value,generation};}
 void InvalidateWeakPtrs(){generation=std::make_shared<int>(0);}
};
template<class M,class T> auto BindOnce(M method,WeakPtr<T> weak) {
 return [=](auto&&...args){if(weak)std::invoke(method,weak.get(),std::forward<decltype(args)>(args)...);};
}
template<class F,class... A> requires(!std::is_member_function_pointer_v<F>)
auto BindOnce(F f,A...args){return std::bind_front(f,std::move(args)...);}
struct OneShotTimer {
 std::move_only_function<void()> action;
 static inline std::set<OneShotTimer*> timers;
 OneShotTimer(){timers.insert(this);}
 ~OneShotTimer(){timers.erase(this);}
 void Stop(){action=nullptr;}
 template<class F> void Start(int,int,F f){action=std::move(f);}
};
void Timers(){for(auto* t:OneShotTimer::timers)if(t->action){auto f=std::move(t->action);f();}}
struct MayBlock {};
enum class TaskShutdownBehavior {SKIP_ON_SHUTDOWN};
struct Traits {Traits(MayBlock,TaskShutdownBehavior){}};
std::deque<std::move_only_function<void()>> tasks;
struct ThreadPool {
 template<class F,class R> static void PostTaskAndReplyWithResult(int,Traits,F f,R reply){
  tasks.push_back([f=std::move(f),reply=std::move(reply)]()mutable{reply(f());});
 }
};
void Replies(){while(!tasks.empty()){auto f=std::move(tasks.front());tasks.pop_front();f();}}
template<class W,class O> struct ScopedObservation {
 O* observer;
 W* widget=nullptr;
 explicit ScopedObservation(O* o):observer(o){}
 ~ScopedObservation(){Reset();}
 void Observe(W* w){widget=w;w->AddObserver(observer);}
 void Reset(){if(widget){widget->RemoveObserver(observer);widget=nullptr;}}
};
}
namespace views {
struct Widget;
struct WidgetObserver {
 virtual ~WidgetObserver()=default;
 virtual void OnWidgetVisibilityChanged(Widget*,bool){}
 virtual void OnWidgetDestroying(Widget*){}
 virtual void OnWidgetDestroyed(Widget*){}
 virtual void OnWidgetUserDragStarted(Widget*){}
 virtual void OnWidgetUserResizeStarted(Widget*){}
};
struct Widget {
 bool visible=false;
 std::set<WidgetObserver*> observers;
 void AddObserver(WidgetObserver* o){observers.insert(o);}
 void RemoveObserver(WidgetObserver* o){observers.erase(o);}
 bool IsVisible(){return visible;}
 void Show(bool v){visible=v;auto copy=observers;for(auto* o:copy)o->OnWidgetVisibilityChanged(this,v);}
 ~Widget(){auto copy=observers;for(auto* o:copy)o->OnWidgetDestroying(this);for(auto* o:copy)o->OnWidgetDestroyed(this);}
 void Drag(){auto copy=observers;for(auto* o:copy)o->OnWidgetUserDragStarted(this);}
 void Resize(){auto copy=observers;for(auto* o:copy)o->OnWidgetUserResizeStarted(this);}
};
}
namespace aura {
struct Env {
 std::set<ui::EventObserver*> observers;
 static bool HasInstance(){return true;}
 static Env* GetInstance(){static Env e;return &e;}
 void AddEventObserver(ui::EventObserver* o,Env*,std::set<ui::EventType>){observers.insert(o);}
 void RemoveEventObserver(ui::EventObserver* o){observers.erase(o);}
 void Input(){auto copy=observers;for(auto* o:copy)o->OnEvent({});}
};
}
struct Rectangle {int x,y,width,height;bool operator==(const Rectangle&)const=default;};
struct Connection {bool valid=true;explicit operator bool()const{return valid;}};
struct PlacementSnapshot {std::optional<Rectangle> bounds;Connection connection;};
int moves=0;
Rectangle bounds{1280,38,600,338};
PlacementSnapshot InspectHyprland(const std::string&,const std::string&,int){return {bounds,{true}};}
namespace ardia::pip_linux {
std::string PlacementCommand(const std::string&,int,const Rectangle&){return "move";}
void SendHyprland(Connection,const std::string&){++moves;}
}
'''
        checks = r'''
void tick(){base::Timers();base::Replies();}
void reset(){base::now=0;moves=0;bounds={1280,38,600,338};assert(base::tasks.empty());}
int main(){
 reset();
 {
  views::Widget w;
  new HyprlandPlacement(&w,"socket","identity");
  w.Show(true);tick();assert(moves==0);tick();assert(moves==1);
  w.Show(false);w.Show(true);tick();assert(moves==1);
  tick();assert(moves==2);
 }
 reset();
 {
  views::Widget w;
  new HyprlandPlacement(&w,"socket","identity");
  w.Show(true);tick();base::Timers();
  w.Show(false);w.Show(true);
  base::Replies();assert(moves==0);
  tick();assert(moves==0);
  tick();assert(moves==1);
 }
 reset();
 {
  views::Widget w;
  new HyprlandPlacement(&w,"socket","identity");
  w.Show(true);tick();aura::Env::GetInstance()->Input();
  w.Show(true);tick();assert(moves==0);
 }
 for(int cancellation=0;cancellation<6;++cancellation){
  reset();
  auto w=std::make_unique<views::Widget>();
  new HyprlandPlacement(w.get(),"socket","identity");
  w->Show(true);tick();base::Timers();
  assert(!base::tasks.empty());
  if(cancellation==0)w->Show(false);
  if(cancellation==1)w.reset();
  if(cancellation==2)aura::Env::GetInstance()->Input();
  if(cancellation==3)w->Drag();
  if(cancellation==4)w->Resize();
  if(cancellation==5)base::now=1001;
  base::Replies();tick();assert(moves==0);
 }
 reset();
 {
  views::Widget w;
  new HyprlandPlacement(&w,"socket","identity");
  w.Show(true);tick();bounds.width=800;tick();assert(moves==0);
  tick();assert(moves==1);
 }
 assert(aura::Env::GetInstance()->observers.empty());
 assert(base::OneShotTimer::timers.empty());
}
'''
        with tempfile.TemporaryDirectory(prefix='ardia-pip-lifetime-') as directory:
            cpp = Path(directory) / 'lifetime.cc'
            binary = Path(directory) / 'lifetime'
            cpp.write_text(prelude + observer + checks)
            subprocess.run([compiler, '-std=c++23', '-Wall', '-Wextra', '-Werror',
                            str(cpp), '-o', str(binary)], check=True)
            subprocess.run([str(binary)], check=True, timeout=3)


if __name__ == '__main__':
    unittest.main()
