from pathlib import Path
import os
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import unittest


ROOT = Path(__file__).resolve().parents[1]


class HyprlandPipTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        compiler = shutil.which('c++')
        if not compiler:
            raise unittest.SkipTest('C++ compiler unavailable')
        cls.scratch = tempfile.TemporaryDirectory(prefix='ardia-pip-ipc-')
        cls.directory = Path(cls.scratch.name)
        cls.binary = cls.directory / 'fixture'
        source = cls.directory / 'fixture.cc'
        source.write_text(r'''
#include "ac_pip_hyprland.h"
#include <iostream>
#include <string>
#include <cstdlib>
using namespace ardia::pip_linux;
int main(int, char** argv) {
  std::string mode = argv[1];
  if (mode == "command") {
    std::cout << PlacementCommand(argv[2], std::atoi(argv[3]),
        {std::atoi(argv[4]), std::atoi(argv[5]), std::atoi(argv[6]), std::atoi(argv[7])});
  } else if (mode == "request") {
    auto reply = RequestHyprland(argv[2], "j/clients");
    if (!reply) return 2;
    std::cout << *reply;
  } else if (mode == "send") {
    SendHyprland(ConnectHyprland(argv[2]), argv[3]);
  } else if (mode == "path") {
    auto path = HyprlandSocketPath(argv[2], argv[3]);
    if (path) std::cout << *path;
  }
}
''')
        subprocess.run([compiler, '-std=c++20', '-Wall', '-Wextra', '-Werror',
                        '-I', str(ROOT / 'pip'), str(source),
                        str(ROOT / 'pip/ac_pip_hyprland.cc'), '-o', str(cls.binary)], check=True)

    @classmethod
    def tearDownClass(cls):
        cls.scratch.cleanup()

    def invoke(self, *args, **kwargs):
        return subprocess.run([str(self.binary), *map(str, args)],
                              capture_output=True, text=True, timeout=3, **kwargs)

    def test_socket_launch_values_are_optional_and_reject_path_traversal(self):
        for signature in ['', '../foreign', '..', 'x/y', 'a;exec']:
            self.assertEqual(self.invoke('path', '/tmp/pip-runtime', signature).stdout, '')
        for runtime in ['', 'relative/runtime']:
            self.assertEqual(self.invoke('path', runtime, 'abc_123').stdout, '')
        env = dict(os.environ, XDG_RUNTIME_DIR='/tmp/from-environment',
                   HYPRLAND_INSTANCE_SIGNATURE='from_environment')
        self.assertEqual(self.invoke('path', '/tmp/pip-runtime', 'abc_123', env=env).stdout,
                         '/tmp/pip-runtime/hypr/abc_123/.socket.sock')
        self.assertEqual(self.invoke('path', '', '', env=env).stdout, '')
        source = (ROOT / 'pip/ac_pip_hyprland.cc').read_text()
        self.assertNotIn('getenv', source)
        platform = (ROOT / 'pip/ac_pip_linux.cc').read_text()
        self.assertIn('ardiacore::InstanceValue("hyprland-runtime-dir")', platform)
        self.assertIn('ardiacore::InstanceValue("hyprland-instance")', platform)

    def test_socket_requests_and_sends_are_bounded(self):
        path = str(self.directory / 'ipc.sock')
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as server:
            server.bind(path)
            server.listen(1)
            seen = []
            def serve():
                with server.accept()[0] as connection:
                    seen.append(connection.recv(4096))
                    connection.sendall(b'[{"class":"unrelated"}]')
            worker = threading.Thread(target=serve)
            worker.start()
            response = self.invoke('request', path)
            worker.join(2)
            self.assertFalse(worker.is_alive())
            self.assertEqual(response.returncode, 0)
            self.assertEqual(response.stdout, '[{"class":"unrelated"}]')
            self.assertEqual(seen, [b'j/clients'])
            def stall():
                with server.accept()[0] as connection:
                    connection.recv(4096)
                    time.sleep(.3)
            worker = threading.Thread(target=stall)
            worker.start()
            started = time.monotonic()
            response = self.invoke('request', path)
            elapsed = time.monotonic() - started
            worker.join(2)
            self.assertEqual(response.returncode, 2)
            self.assertLess(elapsed, .25)
        Path(path).unlink()
        self.assertEqual(self.invoke('request', path).returncode, 2)
        self.assertEqual(self.invoke('request', '/' + 'x' * 200).returncode, 2)

    def test_command_cannot_interpolate_code(self):
        for identity in ["x';hl.exec_cmd('bad')", 'x/y', '', 'x\ny']:
            self.assertEqual(self.invoke('command', identity, 42, 0, 0, 600, 338).stdout, '')
        self.assertEqual(self.invoke('command', 'ardia-pip-test', -1, 0, 0, 600, 338).stdout, '')

    def test_placement_obeys_ownership_geometry_and_work_area(self):
        lua = shutil.which('lua')
        if not lua:
            self.skipTest('Lua interpreter unavailable')
        command = self.invoke('command', 'ardia-pip-test', 42, 1280, 38, 600, 338).stdout
        script = self.directory / 'placement.lua'
        script.write_text(r'''
local command = [==[
''' + command.removeprefix('eval ') + r'''
]==]
local function run(changes, monitor)
  local w={class='ardia-pip-test',pid=42,mapped=true,floating=true,hidden=false,
    at={x=1280,y=38},size={x=600,y=338},monitor=monitor or
    {x=0,y=0,width=3360,height=1890,scale=2,transform=0,
     reserved={top=26,right=0,bottom=0,left=0}}}
  for k,v in pairs(changes or {}) do w[k]=v end
  local moved={}
  hl={get_windows=function() return {w} end,
      dispatch=function(action) moved[#moved+1]=action end,
      dsp={window={move=function(action) return action end}}}
  assert(load(command))()
  return moved,w
end
local moved,w=run()
assert(#moved==1 and moved[1].window==w)
assert(moved[1].x==1070 and moved[1].y==38)
for _,change in ipairs({{class='other'},{pid=99},{mapped=false},
    {floating=false},{hidden=true},{at={x=1200,y=38}},{size={x=800,y=450}}}) do
  assert(#run(change)==0)
end
assert(#run(nil,{x=0,y=0,width=4000,height=2200,scale=2,transform=0,
    reserved={top=0,right=0,bottom=0,left=0}})==0)
local rotated=run(nil,{x=1000,y=-200,width=1890,height=3360,scale=2,transform=1,
    reserved={top=20,right=0,bottom=0,left=300}})
assert(#rotated==1 and rotated[1].x==1310 and rotated[1].y==38)
assert(#run(nil,{x=0,y=0,width=500,height=300,scale=1,transform=0,
    reserved={top=0,right=0,bottom=0,left=0}})==0)
''')
        subprocess.run([lua, str(script)], check=True, timeout=3)


if __name__ == '__main__':
    unittest.main()
