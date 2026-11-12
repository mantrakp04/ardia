[Setup]
AppId={{47A92F18-32B0-4548-A1EF-72C217FE1836}
AppName=Ardia
AppVersion={#Version}
AppVerName=Ardia {#Version}
AppPublisher=Ardia
AppPublisherURL=https://ardia.dev
AppSupportURL=https://github.com/ardia-browser/ardia/issues
DefaultDirName={localappdata}\Programs\Ardia
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableReadyPage=yes
PrivilegesRequired=lowest
OutputDir={#Out}
OutputBaseFilename=Ardia-Setup-{#Cpu}
Compression=lzma2/max
SolidCompression=yes
LZMAUseSeparateProcess=yes
ArchitecturesAllowed={#Allowed}
ArchitecturesInstallIn64BitMode={#Allowed}
SetupIconFile={#Icon}
UninstallDisplayIcon={app}\Ardia.ico
UninstallDisplayName=Ardia
WizardStyle=modern
CloseApplications=yes
RestartApplications=no

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; Flags: unchecked

[Files]
Source: "{#Source}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "{#Icon}"; DestDir: "{app}"; DestName: "Ardia.ico"; Flags: ignoreversion

[Dirs]
Name: "{localappdata}\Ardia\User Data"

[UninstallDelete]
Type: files; Name: "{app}\debug.log"
Type: dirifempty; Name: "{app}"

[Icons]
Name: "{autoprograms}\Ardia"; Filename: "{app}\Ardia.exe"; IconFilename: "{app}\Ardia.ico"
Name: "{autodesktop}\Ardia"; Filename: "{app}\Ardia.exe"; IconFilename: "{app}\Ardia.ico"; Tasks: desktopicon

[Run]
Filename: "{app}\Ardia.exe"; Description: "Open Ardia"; Flags: nowait postinstall skipifsilent
Filename: "{app}\Ardia.exe"; Flags: nowait skipifnotsilent; Check: RelaunchAsked

[Code]
function CreateFile(Name: String; Access, Share, Security, Disposition, Flags, Template: Cardinal): Cardinal;
  external 'CreateFileW@kernel32.dll stdcall';
function CloseHandle(Handle: Cardinal): Boolean;
  external 'CloseHandle@kernel32.dll stdcall';

function RelaunchAsked: Boolean;
begin
  Result := ExpandConstant('{param:relaunch|0}') = '1';
end;

function InUse(Path: String): Boolean;
var
  Handle: Cardinal;
begin
  Result := False;
  if not FileExists(Path) then Exit;
  Handle := CreateFile(Path, $40000000, 0, 0, 3, $80, 0);
  if Handle = $FFFFFFFF then
    Result := True
  else
    CloseHandle(Handle);
end;

function AppInUse: Boolean;
begin
  Result := InUse(ExpandConstant('{app}\Ardia.exe')) or InUse(ExpandConstant('{app}\chrome.dll')) or InUse(ExpandConstant('{app}\ArdiaApp.dll'));
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Waited: Integer;
begin
  Result := '';
  if not RelaunchAsked then Exit;
  Waited := 0;
  while AppInUse and (Waited < 30000) do
  begin
    Sleep(250);
    Waited := Waited + 250;
  end;
end;
