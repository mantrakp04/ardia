param(
  [Parameter(Mandatory = $true)][string]$Icon,
  [Parameter(Mandatory = $true)][string]$To,
  [switch]$Check
)

$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

public static class ArdiaLauncherIdentity {
  const int RT_ICON = 3;
  const int RT_GROUP_ICON = 14;
  const int RT_VERSION = 16;
  const uint LOAD_LIBRARY_AS_DATAFILE = 0x2;
  const uint LOAD_LIBRARY_AS_IMAGE_RESOURCE = 0x20;

  delegate bool EnumName(IntPtr module, IntPtr type, IntPtr name, IntPtr param);
  delegate bool EnumLanguage(IntPtr module, IntPtr type, IntPtr name, ushort language, IntPtr param);

  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr LoadLibraryExW(string path, IntPtr file, uint flags);
  [DllImport("kernel32.dll")] static extern bool FreeLibrary(IntPtr module);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool EnumResourceNamesW(IntPtr module, IntPtr type, EnumName callback, IntPtr param);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool EnumResourceLanguagesW(IntPtr module, IntPtr type, IntPtr name, EnumLanguage callback, IntPtr param);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindResourceExW(IntPtr module, IntPtr type, IntPtr name, ushort language);
  [DllImport("kernel32.dll")] static extern IntPtr LoadResource(IntPtr module, IntPtr resource);
  [DllImport("kernel32.dll")] static extern IntPtr LockResource(IntPtr data);
  [DllImport("kernel32.dll")] static extern uint SizeofResource(IntPtr module, IntPtr resource);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr BeginUpdateResourceW(string path, bool deleteExisting);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool UpdateResourceW(IntPtr update, IntPtr type, IntPtr name, ushort language, byte[] data, uint size);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool EndUpdateResourceW(IntPtr update, bool discard);

  public class Image { public byte Width, Height, Colors; public ushort Planes, Bits; public byte[] Data; }
  public class Group { public string Name; public int Id; public ushort Language; public List<int> IconIds = new List<int>(); public List<Image> Images = new List<Image>(); }
  public class Reading { public Group First; public int HighestIconId; public ushort VersionLanguage; public byte[] Version; }

  public static List<Image> ReadIco(string path) {
    byte[] file = File.ReadAllBytes(path);
    if (file.Length < 6 || BitConverter.ToUInt16(file, 2) != 1) throw new InvalidDataException(path + " is not an .ico file");
    int count = BitConverter.ToUInt16(file, 4);
    var images = new List<Image>();
    for (int i = 0; i < count; i++) {
      int at = 6 + i * 16;
      int size = BitConverter.ToInt32(file, at + 8);
      int offset = BitConverter.ToInt32(file, at + 12);
      var image = new Image { Width = file[at], Height = file[at + 1], Colors = file[at + 2], Planes = BitConverter.ToUInt16(file, at + 4), Bits = BitConverter.ToUInt16(file, at + 6), Data = new byte[size] };
      Buffer.BlockCopy(file, offset, image.Data, 0, size);
      images.Add(image);
    }
    if (images.Count == 0) throw new InvalidDataException(path + " holds no images");
    return images;
  }

  static byte[] Bytes(IntPtr module, IntPtr type, IntPtr name, ushort language) {
    IntPtr found = FindResourceExW(module, type, name, language);
    if (found == IntPtr.Zero) return null;
    uint size = SizeofResource(module, found);
    IntPtr pointer = LockResource(LoadResource(module, found));
    if (pointer == IntPtr.Zero) return null;
    byte[] bytes = new byte[size];
    Marshal.Copy(pointer, bytes, 0, (int)size);
    return bytes;
  }

  static ushort FirstLanguage(IntPtr module, IntPtr type, IntPtr name) {
    ushort chosen = 0;
    bool seen = false;
    EnumResourceLanguagesW(module, type, name, (m, t, n, language, p) => { if (!seen) { chosen = language; seen = true; } return true; }, IntPtr.Zero);
    return chosen;
  }

  static bool IsId(IntPtr name) { return ((ulong)name.ToInt64() >> 16) == 0; }

  public static Reading Read(string path) {
    IntPtr module = LoadLibraryExW(path, IntPtr.Zero, LOAD_LIBRARY_AS_DATAFILE | LOAD_LIBRARY_AS_IMAGE_RESOURCE);
    if (module == IntPtr.Zero) throw new IOException("could not open " + path + " (Windows error " + Marshal.GetLastWin32Error() + ")");
    try {
      var reading = new Reading();
      var names = new List<object>();
      EnumResourceNamesW(module, (IntPtr)RT_GROUP_ICON, (m, t, name, p) => { names.Add(IsId(name) ? (object)(int)name.ToInt64() : Marshal.PtrToStringUni(name)); return true; }, IntPtr.Zero);
      var iconIds = new List<int>();
      EnumResourceNamesW(module, (IntPtr)RT_ICON, (m, t, name, p) => { if (IsId(name)) iconIds.Add((int)name.ToInt64()); return true; }, IntPtr.Zero);
      foreach (int id in iconIds) if (id > reading.HighestIconId) reading.HighestIconId = id;
      if (names.Count > 0) {
        var group = new Group();
        IntPtr namePointer;
        IntPtr allocated = IntPtr.Zero;
        if (names[0] is int) { group.Id = (int)names[0]; namePointer = (IntPtr)group.Id; }
        else { group.Name = (string)names[0]; allocated = Marshal.StringToHGlobalUni(group.Name); namePointer = allocated; }
        try {
          group.Language = FirstLanguage(module, (IntPtr)RT_GROUP_ICON, namePointer);
          byte[] directory = Bytes(module, (IntPtr)RT_GROUP_ICON, namePointer, group.Language);
          int count = BitConverter.ToUInt16(directory, 4);
          for (int i = 0; i < count; i++) {
            int at = 6 + i * 14;
            int id = BitConverter.ToUInt16(directory, at + 12);
            group.IconIds.Add(id);
            ushort language = FirstLanguage(module, (IntPtr)RT_ICON, (IntPtr)id);
            group.Images.Add(new Image { Width = directory[at], Height = directory[at + 1], Colors = directory[at + 2], Planes = BitConverter.ToUInt16(directory, at + 4), Bits = BitConverter.ToUInt16(directory, at + 6), Data = Bytes(module, (IntPtr)RT_ICON, (IntPtr)id, language) ?? new byte[0] });
          }
        } finally {
          if (allocated != IntPtr.Zero) Marshal.FreeHGlobal(allocated);
        }
        reading.First = group;
      }
      reading.VersionLanguage = FirstLanguage(module, (IntPtr)RT_VERSION, (IntPtr)1);
      reading.Version = Bytes(module, (IntPtr)RT_VERSION, (IntPtr)1, reading.VersionLanguage);
      return reading;
    } finally {
      FreeLibrary(module);
    }
  }

  public static bool SameImages(List<Image> one, List<Image> other) {
    if (one.Count != other.Count) return false;
    for (int i = 0; i < one.Count; i++) {
      if (one[i].Width != other[i].Width || one[i].Height != other[i].Height || one[i].Bits != other[i].Bits) return false;
      if (one[i].Data.Length != other[i].Data.Length) return false;
      for (int j = 0; j < one[i].Data.Length; j++) if (one[i].Data[j] != other[i].Data[j]) return false;
    }
    return true;
  }

  public class Node { public string Key; public ushort Type; public ushort ValueLength; public byte[] Value; public List<Node> Children = new List<Node>(); }

  static int Align(int offset) { return (offset + 3) & ~3; }

  static Node Parse(byte[] data, int start) {
    int length = BitConverter.ToUInt16(data, start);
    var node = new Node { ValueLength = BitConverter.ToUInt16(data, start + 2), Type = BitConverter.ToUInt16(data, start + 4) };
    int at = start + 6;
    var key = new StringBuilder();
    while (true) { char c = BitConverter.ToChar(data, at); at += 2; if (c == '\0') break; key.Append(c); }
    node.Key = key.ToString();
    at = Align(at);
    int valueBytes = node.Type == 1 ? node.ValueLength * 2 : node.ValueLength;
    int end = start + length;
    valueBytes = Math.Max(0, Math.Min(valueBytes, end - at));
    node.Value = new byte[valueBytes];
    Buffer.BlockCopy(data, at, node.Value, 0, valueBytes);
    at = Align(at + valueBytes);
    while (at + 6 <= end) {
      int childLength = BitConverter.ToUInt16(data, at);
      if (childLength == 0) break;
      node.Children.Add(Parse(data, at));
      at = Align(at + childLength);
    }
    return node;
  }

  static byte[] Serialize(Node node) {
    var stream = new MemoryStream();
    var writer = new BinaryWriter(stream);
    writer.Write((ushort)0);
    writer.Write(node.ValueLength);
    writer.Write(node.Type);
    writer.Write(Encoding.Unicode.GetBytes(node.Key + "\0"));
    while (stream.Length % 4 != 0) writer.Write((byte)0);
    writer.Write(node.Value);
    foreach (Node child in node.Children) {
      while (stream.Length % 4 != 0) writer.Write((byte)0);
      writer.Write(Serialize(child));
    }
    byte[] bytes = stream.ToArray();
    if (bytes.Length > ushort.MaxValue) throw new InvalidDataException("version block too large");
    BitConverter.GetBytes((ushort)bytes.Length).CopyTo(bytes, 0);
    return bytes;
  }

  public static Dictionary<string, string> VersionStrings(byte[] version) {
    var found = new Dictionary<string, string>();
    if (version == null) return found;
    Node root = Parse(version, 0);
    foreach (Node info in root.Children) if (info.Key == "StringFileInfo")
      foreach (Node table in info.Children)
        foreach (Node entry in table.Children)
          found[entry.Key] = Encoding.Unicode.GetString(entry.Value).TrimEnd('\0');
    return found;
  }

  public static byte[] WithStrings(byte[] version, Dictionary<string, string> replacements) {
    Node root = Parse(version, 0);
    foreach (Node info in root.Children) if (info.Key == "StringFileInfo")
      foreach (Node table in info.Children)
        foreach (Node entry in table.Children) {
          string value;
          if (!replacements.TryGetValue(entry.Key, out value)) continue;
          entry.Value = Encoding.Unicode.GetBytes(value + "\0");
          entry.ValueLength = (ushort)(value.Length + 1);
          entry.Type = 1;
        }
    return Serialize(root);
  }

  static void Update(IntPtr update, int type, IntPtr name, ushort language, byte[] data) {
    if (!UpdateResourceW(update, (IntPtr)type, name, language, data, data == null ? 0u : (uint)data.Length))
      throw new IOException("UpdateResource failed for type " + type + " (Windows error " + Marshal.GetLastWin32Error() + ")");
  }

  public static void Write(string path, Reading reading, List<Image> images, byte[] version) {
    IntPtr update = BeginUpdateResourceW(path, false);
    if (update == IntPtr.Zero) throw new IOException("could not open " + path + " to write resources" + " (Windows error " + Marshal.GetLastWin32Error() + ")");
    IntPtr allocated = IntPtr.Zero;
    bool written = false;
    try {
      if (images != null) {
        Group group = reading.First;
        ushort language = group != null ? group.Language : (ushort)1033;
        IntPtr groupName = (IntPtr)1;
        if (group != null && group.Name != null) { allocated = Marshal.StringToHGlobalUni(group.Name); groupName = allocated; }
        else if (group != null) groupName = (IntPtr)group.Id;
        if (group != null) {
          var removed = new List<int>();
          foreach (int id in group.IconIds) {
            if (removed.Contains(id)) continue;
            removed.Add(id);
            Update(update, RT_ICON, (IntPtr)id, language, null);
          }
        }
        var directory = new MemoryStream();
        var writer = new BinaryWriter(directory);
        writer.Write((ushort)0);
        writer.Write((ushort)1);
        writer.Write((ushort)images.Count);
        int next = reading.HighestIconId + 1;
        foreach (Image image in images) {
          writer.Write(image.Width);
          writer.Write(image.Height);
          writer.Write(image.Colors);
          writer.Write((byte)0);
          writer.Write(image.Planes);
          writer.Write(image.Bits);
          writer.Write((uint)image.Data.Length);
          writer.Write((ushort)next);
          Update(update, RT_ICON, (IntPtr)next, language, image.Data);
          next++;
        }
        Update(update, RT_GROUP_ICON, groupName, language, directory.ToArray());
      }
      if (version != null) Update(update, RT_VERSION, (IntPtr)1, reading.VersionLanguage, version);
      written = true;
    } finally {
      if (allocated != IntPtr.Zero) Marshal.FreeHGlobal(allocated);
      if (!EndUpdateResourceW(update, !written) && written) throw new IOException("could not save the resources of " + path + " (Windows error " + Marshal.GetLastWin32Error() + ")");
    }
  }
}
"@

$wanted = [ordered]@{
  CompanyName = "Ardia"
  CompanyShortName = "Ardia"
  FileDescription = "Ardia"
  ProductName = "Ardia"
  ProductShortName = "Ardia"
  InternalName = "Ardia"
  OriginalFilename = "Ardia.exe"
  LegalCopyright = "Ardia, built on Chromium. Copyright The Chromium Authors and Ardia's contributors."
}

function Get-Mismatches($reading, $images) {
  $problems = @()
  if (-not $reading.First) { $problems += "it has no icon group" }
  elseif (-not [ArdiaLauncherIdentity]::SameImages($reading.First.Images, $images)) {
    $label = if ($reading.First.Name) { $reading.First.Name } else { "#$($reading.First.Id)" }
    $problems += "its first icon group ($label) is not Ardia.ico"
  }
  $strings = [ArdiaLauncherIdentity]::VersionStrings($reading.Version)
  if ($strings.Count -eq 0) { $problems += "it has no version strings" }
  foreach ($key in $wanted.Keys) {
    if ($strings.ContainsKey($key) -and $strings[$key] -ne $wanted[$key]) { $problems += "its $key is '$($strings[$key])'" }
  }
  if ($strings.ContainsKey("FileDescription") -eq $false -and $strings.Count -gt 0) { $problems += "it has no FileDescription" }
  return $problems
}

if (-not (Test-Path -LiteralPath $Icon -PathType Leaf)) { throw "'$Icon' does not exist" }
if (-not (Test-Path -LiteralPath $To -PathType Leaf)) { throw "'$To' does not exist" }
$target = (Resolve-Path -LiteralPath $To).Path
$images = [ArdiaLauncherIdentity]::ReadIco((Resolve-Path -LiteralPath $Icon).Path)
$reading = [ArdiaLauncherIdentity]::Read($target)
$before = @(Get-Mismatches $reading $images)

if ($Check) {
  if ($before.Count) { Write-Host "launcher-identity: $target is not Ardia's: $($before -join '; ')"; exit 1 }
  Write-Host "launcher-identity: $target carries Ardia's icon ($($images.Count) images) and name"
  exit 0
}

if ($before.Count -eq 0) {
  Write-Host "launcher-identity: $target already carries Ardia's icon and name"
  exit 0
}

$iconRight = $reading.First -and [ArdiaLauncherIdentity]::SameImages($reading.First.Images, $images)
$newImages = if ($iconRight) { $null } else { $images }
$replacements = New-Object 'System.Collections.Generic.Dictionary[string,string]'
foreach ($key in $wanted.Keys) { $replacements[$key] = $wanted[$key] }
$newVersion = if ($reading.Version) { [ArdiaLauncherIdentity]::WithStrings($reading.Version, $replacements) } else { $null }
[ArdiaLauncherIdentity]::Write($target, $reading, $newImages, $newVersion)

$after = @(Get-Mismatches ([ArdiaLauncherIdentity]::Read($target)) $images)
if ($after.Count) { Write-Host "launcher-identity: wrote $target but it still differs: $($after -join '; ')"; exit 1 }
$fixed = $before -join "; "
Write-Host "launcher-identity: $target now carries Ardia's icon and name (was: $fixed)"
exit 0
