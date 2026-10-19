// Windows-only, x64 .NET Framework 4.x. No ports, shell, source writes or content diagnostics.
// All source opens are root-relative NT opens under pinned no-share-delete directory handles.
using System;
using System.IO;
using System.Text;
using System.Linq;
using System.Collections;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Security.Cryptography;
using System.Web.Script.Serialization;
using Microsoft.Win32.SafeHandles;

internal static class LibraryHelper
{
    const uint READ = 0x80000000, WRITE = 0x40000000, DELETE = 0x10000, CONTROL = 0x20000;
    const uint ATTR = 0x80, SYNC = 0x100000, SHARE = 3, REPARSE = 0x400, DIRECTORY = 0x10;
    const uint OPEN = 1, CREATE = 2, OPEN_IF = 3, DIR = 1, NONDIR = 0x40, SYNCHRONOUS = 0x20, NOFOLLOW = 0x200000;
    const int MaxDocument = 262144, MaxSettings = 65536;
    static readonly string User = WindowsIdentity.GetCurrent().User.Value;
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 1048576, RecursionLimit = 48 };
    static Chain Held;
    static bool TestBarriers;

    [StructLayout(LayoutKind.Sequential)] struct UNICODE_STRING { public ushort Length, MaximumLength; public IntPtr Buffer; }
    [StructLayout(LayoutKind.Sequential)] struct OBJECT_ATTRIBUTES {
        public int Length; public IntPtr RootDirectory, ObjectName; public uint Attributes;
        public IntPtr SecurityDescriptor, SecurityQualityOfService;
    }
    [StructLayout(LayoutKind.Sequential)] struct IO_STATUS_BLOCK { public IntPtr Status, Information; }
    [StructLayout(LayoutKind.Sequential)] struct INFO {
        public uint Attributes, CreationLow, CreationHigh, AccessLow, AccessHigh, WriteLow, WriteHigh;
        public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
    }
    [DllImport("ntdll.dll")] static extern int NtCreateFile(out SafeFileHandle h, uint access, ref OBJECT_ATTRIBUTES obj,
        out IO_STATUS_BLOCK io, IntPtr allocation, uint attributes, uint share, uint disposition, uint options, IntPtr ea, uint eaLength);
    [DllImport("ntdll.dll")] static extern uint RtlNtStatusToDosError(int status);
    [DllImport("ntdll.dll")] static extern int NtQueryDirectoryFile(SafeFileHandle h, IntPtr e, IntPtr apc, IntPtr context,
        out IO_STATUS_BLOCK io, IntPtr buffer, uint length, int informationClass, byte singleEntry, IntPtr filter, byte restart);
    [DllImport("ntdll.dll")] static extern int NtSetInformationFile(SafeFileHandle h, out IO_STATUS_BLOCK io, IntPtr info, uint length, int infoClass);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern SafeFileHandle CreateFile(
        string name, uint access, uint share, IntPtr sa, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetFileInformationByHandle(SafeFileHandle h, out INFO info);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern uint GetFinalPathNameByHandle(
        SafeFileHandle h, StringBuilder path, uint length, uint flags);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern uint GetDriveType(string root);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool GetVolumeInformationByHandleW(
        SafeFileHandle h, StringBuilder volume, uint volumeSize, out uint serial, out uint maxComponent, out uint flags, StringBuilder fs, uint fsSize);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool ReadFile(SafeFileHandle h, byte[] data, uint count, out uint read, IntPtr overlapped);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool WriteFile(SafeFileHandle h, byte[] data, uint count, out uint written, IntPtr overlapped);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool FlushFileBuffers(SafeFileHandle h);
    [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr ptr);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(
        string sddl, uint revision, out IntPtr descriptor, out uint size);
    [DllImport("advapi32.dll")] static extern uint GetSecurityInfo(SafeFileHandle h, int type, uint requested,
        out IntPtr owner, out IntPtr group, out IntPtr dacl, out IntPtr sacl, out IntPtr descriptor);
    [DllImport("advapi32.dll")] static extern uint GetSecurityDescriptorLength(IntPtr descriptor);

    sealed class Fault : Exception { public readonly string Code; public Fault(string code) { Code = code; } }
    static void Fail(string code) { throw new Fault(code); }
    static void WinError(uint error) {
        if (error == 2 || error == 3) Fail("NOT_FOUND");
        if (error == 32 || error == 33) Fail("BUSY");
        // Reparse refusal/statuses never include path-bearing OS messages.
        Fail("UNSAFE_SOURCE");
    }
    static INFO Info(SafeFileHandle h) {
        INFO i; if (!GetFileInformationByHandle(h, out i)) Fail("UNSAFE_SOURCE");
        if ((i.Attributes & REPARSE) != 0) Fail("UNSAFE_SOURCE");
        if ((i.Attributes & DIRECTORY) == 0 && i.Links != 1) Fail("UNSAFE_SOURCE");
        return i;
    }
    static string Identity(INFO i) { return i.Volume.ToString("x8") + ":" + i.IndexHigh.ToString("x8") + i.IndexLow.ToString("x8"); }
    static string Signature(INFO i) { return Identity(i) + ":" + i.SizeHigh + ":" + i.SizeLow + ":" + i.WriteHigh + ":" + i.WriteLow; }
    static string Final(SafeFileHandle h, uint volume = 1) {
        StringBuilder text = new StringBuilder(4096);
        uint n = GetFinalPathNameByHandle(h, text, 4096, volume); // Default: VOLUME_NAME_GUID, not mutable drive aliases.
        if (n == 0 || n >= 4096) Fail("UNSAFE_SOURCE");
        return text.ToString().TrimEnd('\\');
    }
    static string[] Parts(string path) {
        if (path == null || path.Length < 3 || path.Length > 1024 || !Char.IsLetter(path[0]) ||
            path[1] != ':' || path[2] != '\\' || path.IndexOf('/') >= 0) { Fail("INVALID_PATH"); }
        string[] parts = path.Substring(3).Split('\\');
        if (parts.Length == 1 && parts[0] == "") return new string[0];
        foreach (string part in parts) {
            if (part.Length == 0 || part == "." || part == ".." || part.EndsWith(".") || part.EndsWith(" ") ||
                part.Equals("session-state", StringComparison.OrdinalIgnoreCase) ||
                part.Any(c => Char.IsControl(c) || "<>:\"/\\|?*".IndexOf(c) >= 0)) Fail("INVALID_PATH");
            string device = part.Split('.')[0].ToUpperInvariant();
            if (new[] { "CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$", "CLOCK$" }.Contains(device) ||
                (device.Length == 4 && (device.StartsWith("COM") || device.StartsWith("LPT")) &&
                 "123456789\u00b9\u00b2\u00b3".IndexOf(device[3]) >= 0)) Fail("INVALID_PATH");
        }
        return parts;
    }
    static SafeFileHandle Relative(SafeFileHandle parent, string name, bool directory, uint access, uint share, uint disposition, IntPtr security) {
        IntPtr nameBuffer = Marshal.StringToHGlobalUni(name);
        IntPtr nameStruct = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(UNICODE_STRING)));
        try {
            UNICODE_STRING text = new UNICODE_STRING { Length = checked((ushort)(name.Length * 2)), MaximumLength = checked((ushort)(name.Length * 2)), Buffer = nameBuffer };
            Marshal.StructureToPtr(text, nameStruct, false);
            OBJECT_ATTRIBUTES obj = new OBJECT_ATTRIBUTES {
                Length = Marshal.SizeOf(typeof(OBJECT_ATTRIBUTES)), RootDirectory = parent.DangerousGetHandle(),
                ObjectName = nameStruct, Attributes = 0x40 | 0x1000, SecurityDescriptor = security // CASE_INSENSITIVE | DONT_REPARSE
            };
            SafeFileHandle h; IO_STATUS_BLOCK io;
            int status = NtCreateFile(out h, access | ATTR | SYNC, ref obj, out io, IntPtr.Zero, 0, share, disposition,
                SYNCHRONOUS | NOFOLLOW | (directory ? DIR : NONDIR), IntPtr.Zero, 0);
            if (status < 0) { if (h != null) h.Dispose(); WinError(RtlNtStatusToDosError(status)); }
            try {
                INFO info = Info(h);
                if (((info.Attributes & DIRECTORY) != 0) != directory) Fail("UNSAFE_SOURCE");
                // NtCreateFile relative single-component opens establish containment before any read.
                string actual = Final(h);
                int separator = actual.LastIndexOf('\\');
                if (separator < 0 || !actual.Substring(0, separator).Equals(Final(parent), StringComparison.OrdinalIgnoreCase)) Fail("UNSAFE_SOURCE");
                return h;
            } catch { h.Dispose(); throw; }
        } finally { Marshal.FreeHGlobal(nameStruct); Marshal.FreeHGlobal(nameBuffer); }
    }
    sealed class Chain : IDisposable {
        public readonly List<SafeFileHandle> Handles = new List<SafeFileHandle>();
        public readonly List<string> Ids = new List<string>();
        public SafeFileHandle Last { get { return Handles[Handles.Count - 1]; } }
        public void Add(SafeFileHandle h) { Handles.Add(h); Ids.Add(Identity(Info(h))); }
        public void Dispose() { for (int n = Handles.Count - 1; n >= 0; n--) Handles[n].Dispose(); }
    }
    static Chain Open(string path, bool file, object expectedChain) {
        string[] parts = Parts(path);
        if (file && parts.Length == 0) Fail("INVALID_PATH");
        string drive = path.Substring(0, 3);
        if (GetDriveType(drive) != 3) Fail("SAFETY_UNSUPPORTED"); // no network/removable filesystem promises
        Chain chain = new Chain();
        try {
            SafeFileHandle root = CreateFile(drive, ATTR | SYNC, SHARE, IntPtr.Zero, 3, 0x02000000 | 0x00200000, IntPtr.Zero);
            if (root.IsInvalid) { root.Dispose(); Fail("UNSAFE_SOURCE"); }
            chain.Add(root);
            string volumeRoot = Final(root);
            if (!volumeRoot.StartsWith("\\\\?\\Volume{", StringComparison.OrdinalIgnoreCase) || !volumeRoot.EndsWith("}") ||
                volumeRoot.IndexOf('}') != volumeRoot.Length - 1) Fail("SAFETY_UNSUPPORTED"); // Refuse SUBST/skipped ancestors.
            StringBuilder fs = new StringBuilder(32); uint serial, max, flags;
            if (!GetVolumeInformationByHandleW(root, null, 0, out serial, out max, out flags, fs, 32) || fs.ToString() != "NTFS") Fail("SAFETY_UNSUPPORTED");
            for (int n = 0; n < parts.Length; n++) {
                bool leafFile = file && n == parts.Length - 1;
                chain.Add(Relative(chain.Last, parts[n], !leafFile, leafFile ? READ : (n == parts.Length - 1 ? 1u : 0u), leafFile ? 1u : SHARE, OPEN, IntPtr.Zero));
            }
            if (expectedChain != null) {
                string[] expected = ((IEnumerable)expectedChain).Cast<object>().Select(v => v as string).ToArray();
                if (!expected.SequenceEqual(chain.Ids)) Fail("CONTENT_CHANGED");
            }
            return chain;
        } catch { chain.Dispose(); throw; }
    }
    static byte[] Bytes(SafeFileHandle h, int maximum, string expected) {
        INFO before = Info(h);
        if (expected != null && expected != Signature(before)) Fail("CONTENT_CHANGED");
        if (before.SizeHigh != 0 || before.SizeLow > maximum) Fail("LIMIT_EXCEEDED");
        using (MemoryStream result = new MemoryStream()) {
            byte[] buffer = new byte[16384]; uint count;
            while (true) {
                if (!ReadFile(h, buffer, (uint)Math.Min(buffer.Length, maximum + 1 - result.Length), out count, IntPtr.Zero)) Fail("SOURCE_UNAVAILABLE");
                if (count == 0) break;
                result.Write(buffer, 0, (int)count);
                if (result.Length > maximum) Fail("LIMIT_EXCEEDED");
            }
            INFO after = Info(h);
            if (Signature(before) != Signature(after) || result.Length != before.SizeLow) Fail("CONTENT_CHANGED");
            return result.ToArray();
        }
    }
    static object Read(Dictionary<string, object> request, bool hold) {
        Chain chain = Open(Text(request, "path"), true, Value(request, "expectedChain"));
        try {
            Prefix(chain, Value(request, "rootChain"));
            string signature = Signature(Info(chain.Last));
            string expected = Text(request, "expected");
            if (expected != null && !expected.StartsWith(signature + "|", StringComparison.Ordinal)) Fail("CONTENT_CHANGED");
            if (hold) {
                if (!TestBarriers || Held != null) Fail("INVALID_REQUEST");
                Held = chain; chain = null;
                return new { hold = "pinned" };
            }
            byte[] bytes = Bytes(chain.Last, MaxDocument, null);
            signature += "|" + Hash(bytes);
            if (expected != null && expected != signature) Fail("CONTENT_CHANGED");
            if (Text(request, "op") == "verify") return new { signature = signature };
            return new { data = Convert.ToBase64String(bytes), chain = chain.Ids, signature = signature };
        } finally { if (chain != null) chain.Dispose(); }
    }
    static object Inspect(Dictionary<string, object> request) {
        using (Chain chain = Open(Text(request, "path"), false, Value(request, "expectedChain"))) {
            Prefix(chain, Value(request, "rootChain"));
            if (Text(request, "op") == "identify") {
                string dos = Final(chain.Last, 0);
                if (!dos.StartsWith("\\\\?\\") || dos.Length < 7 || dos[5] != ':') Fail("SAFETY_UNSUPPORTED");
                return new { chain = chain.Ids, canonical = Final(chain.Last), path = dos.Substring(4) };
            }
            int limit = Value(request, "limit") == null ? 10000 : Convert.ToInt32(request["limit"]);
            if (limit < 1 || limit > 10000) Fail("INVALID_REQUEST");
            var entries = new List<object>(); bool truncated = false; int characters = 0;
            IntPtr buffer = Marshal.AllocHGlobal(32768);
            try {
                byte restart = 1; bool finished = false;
                while (!finished) {
                    IO_STATUS_BLOCK io;
                    int status = NtQueryDirectoryFile(chain.Last, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, out io, buffer, 32768, 1, 0, IntPtr.Zero, restart);
                    restart = 0;
                    if (unchecked((uint)status) == 0x80000006) break; // STATUS_NO_MORE_FILES
                    if (status < 0) WinError(RtlNtStatusToDosError(status));
                    int available = checked((int)io.Information.ToInt64()), offset = 0;
                    while (true) {
                        if (offset < 0 || offset + 64 > available || available > 32768) Fail("UNSAFE_SOURCE");
                        IntPtr item = IntPtr.Add(buffer, offset);
                        int next = Marshal.ReadInt32(item), nameBytes = Marshal.ReadInt32(item, 60);
                        uint attributes = unchecked((uint)Marshal.ReadInt32(item, 56));
                        if (nameBytes < 0 || (nameBytes & 1) != 0 || offset + 64 + nameBytes > available) Fail("UNSAFE_SOURCE");
                        string name = Marshal.PtrToStringUni(IntPtr.Add(item, 64), nameBytes / 2);
                        if (name != "." && name != "..") {
                            if (entries.Count >= limit || characters + name.Length > 131072) { truncated = true; finished = true; break; }
                            characters += name.Length;
                            entries.Add(new { name = name, directory = (attributes & DIRECTORY) != 0, reparse = (attributes & REPARSE) != 0 });
                        }
                        if (next == 0) break;
                        if (next < 64) Fail("UNSAFE_SOURCE");
                        offset = checked(offset + next);
                    }
                }
            } finally { Marshal.FreeHGlobal(buffer); }
            return new { chain = chain.Ids, canonical = Final(chain.Last), entries = entries, truncated = truncated };
        }
    }
    static void Prefix(Chain chain, object rootChain) {
        if (rootChain == null) return;
        string[] expected = ((IEnumerable)rootChain).Cast<object>().Select(v => v as string).ToArray();
        if (expected.Length == 0 || expected.Length > chain.Ids.Count || !expected.SequenceEqual(chain.Ids.Take(expected.Length))) Fail("CONTENT_CHANGED");
    }
    static IntPtr PrivateDescriptor() {
        IntPtr descriptor; uint length;
        if (!ConvertStringSecurityDescriptorToSecurityDescriptor("O:" + User + "D:P(A;OICI;FA;;;" + User + ")(A;OICI;FA;;;SY)", 1, out descriptor, out length)) Fail("SETTINGS_UNAVAILABLE");
        return descriptor;
    }
    static void Private(SafeFileHandle handle) {
        Info(handle);
        IntPtr owner, group, dacl, sacl, descriptor;
        if (GetSecurityInfo(handle, 1, 1 | 4, out owner, out group, out dacl, out sacl, out descriptor) != 0) Fail("SETTINGS_UNAVAILABLE");
        try {
            byte[] bytes = new byte[GetSecurityDescriptorLength(descriptor)];
            Marshal.Copy(descriptor, bytes, 0, bytes.Length);
            RawSecurityDescriptor sd = new RawSecurityDescriptor(bytes, 0);
            if (sd.Owner == null || sd.Owner.Value != User || sd.DiscretionaryAcl == null ||
                (sd.ControlFlags & ControlFlags.DiscretionaryAclProtected) == 0) Fail("SETTINGS_UNAVAILABLE");
            bool userFull = false;
            foreach (GenericAce ace in sd.DiscretionaryAcl) {
                CommonAce allowed = ace as CommonAce;
                if (allowed == null || allowed.IsCallback || allowed.AceQualifier != AceQualifier.AccessAllowed ||
                    (allowed.SecurityIdentifier.Value != User && allowed.SecurityIdentifier.Value != "S-1-5-18")) Fail("SETTINGS_UNAVAILABLE");
                if (allowed.SecurityIdentifier.Value == User && (allowed.AceFlags & AceFlags.InheritOnly) == 0 &&
                    (allowed.AccessMask & 0x1f01ff) == 0x1f01ff) userFull = true;
            }
            if (!userFull) Fail("SETTINGS_UNAVAILABLE");
        } finally { LocalFree(descriptor); }
    }
    static Chain SettingsDirectory(string path) {
        string[] parts = Parts(path);
        if (parts.Length < 2) Fail("INVALID_PATH");
        string parent = path.Substring(0, path.LastIndexOf('\\'));
        string ancestor = parent.Substring(0, parent.LastIndexOf('\\') + 1).TrimEnd('\\');
        if (ancestor.Length == 2) ancestor += "\\";
        Chain chain = Open(ancestor, false, null);
        IntPtr descriptor = PrivateDescriptor();
        try {
            for (int n = parts.Length - 2; n < parts.Length; n++) {
                chain.Add(Relative(chain.Last, parts[n], true, CONTROL, SHARE, OPEN_IF, descriptor));
                Private(chain.Last); // Existing broad ACLs are refused, NEVER changed in place.
            }
            return chain;
        } catch { chain.Dispose(); throw; }
        finally { LocalFree(descriptor); }
    }
    static SafeFileHandle PrivateFile(SafeFileHandle parent, string name, uint access, uint share, uint disposition) {
        IntPtr descriptor = PrivateDescriptor();
        try {
            SafeFileHandle h = Relative(parent, name, false, access | CONTROL, share, disposition, descriptor);
            try { Private(h); return h; } catch { h.Dispose(); throw; }
        } finally { LocalFree(descriptor); }
    }
    static byte[] SettingsBytes(SafeFileHandle directory) {
        try { using (SafeFileHandle h = PrivateFile(directory, "settings.json", READ, 1, OPEN)) return Bytes(h, MaxSettings, null); }
        catch (Fault f) { if (f.Code == "NOT_FOUND") return null; throw; }
    }
    static string Hash(byte[] bytes) {
        if (bytes == null) return "missing";
        using (SHA256 sha = SHA256.Create()) return Convert.ToBase64String(sha.ComputeHash(bytes));
    }
    static void Rename(SafeFileHandle file, SafeFileHandle directory, string name, bool replace) {
        // FILE_RENAME_INFORMATION, x64 layout. Relative target is pinned, not a reparsed path.
        byte[] text = Encoding.Unicode.GetBytes(name);
        IntPtr buffer = Marshal.AllocHGlobal(20 + text.Length);
        try {
            for (int i = 0; i < 20; i++) Marshal.WriteByte(buffer, i, 0);
            Marshal.WriteByte(buffer, 0, replace ? (byte)1 : (byte)0);
            Marshal.WriteIntPtr(buffer, 8, directory.DangerousGetHandle());
            Marshal.WriteInt32(buffer, 16, text.Length);
            Marshal.Copy(text, 0, IntPtr.Add(buffer, 20), text.Length);
            IO_STATUS_BLOCK io;
            int status = NtSetInformationFile(file, out io, buffer, (uint)(20 + text.Length), 10);
            if (status < 0) Fail("SETTINGS_UNAVAILABLE");
        } finally { Marshal.FreeHGlobal(buffer); }
    }
    static void Delete(SafeFileHandle file) {
        IntPtr buffer = Marshal.AllocHGlobal(1);
        try {
            Marshal.WriteByte(buffer, 1); IO_STATUS_BLOCK io;
            if (NtSetInformationFile(file, out io, buffer, 1, 13) < 0) Fail("SETTINGS_UNAVAILABLE");
        } finally { Marshal.FreeHGlobal(buffer); }
    }
    static object Settings(Dictionary<string, object> request, bool write) {
        using (Chain chain = SettingsDirectory(Text(request, "path"))) {
            SafeFileHandle directory = chain.Last;
            // Stable lock inode; never unlink it. OS handle lifetime releases exclusion on crash.
            SafeFileHandle gate;
            try { gate = PrivateFile(directory, "settings.lock", write ? READ | WRITE : READ, 0, OPEN_IF); }
            catch (Fault f) { if (f.Code == "BUSY") Fail("SETTINGS_CONFLICT"); throw; }
            using (gate) {
                byte[] current = SettingsBytes(directory);
                if (!write) return new { data = current == null ? "" : Convert.ToBase64String(current), signature = Hash(current) };
                if (Text(request, "expected") != Hash(current)) Fail("SETTINGS_CONFLICT");
                byte[] next = Convert.FromBase64String(Text(request, "data"));
                if (next.Length > MaxSettings) Fail("LIMIT_EXCEEDED");
                string name = "pending-" + Guid.NewGuid().ToString("N") + ".tmp";
                using (SafeFileHandle temporary = PrivateFile(directory, name, READ | WRITE | DELETE, 0, CREATE)) {
                    bool committed = false;
                    try {
                        uint written;
                        if (!WriteFile(temporary, next, (uint)next.Length, out written, IntPtr.Zero) || written != next.Length ||
                            !FlushFileBuffers(temporary)) Fail("SETTINGS_UNAVAILABLE");
                        Private(temporary);
                        if (TestBarriers && Text(request, "testFailure") == "beforeReplace") Fail("SETTINGS_UNAVAILABLE");
                        Rename(temporary, directory, "settings.json", true);
                        committed = true;
                    } finally { if (!committed) Delete(temporary); }
                }
                return new { signature = Hash(next) };
            }
        }
    }
    static object Value(Dictionary<string, object> request, string key) { object value; return request.TryGetValue(key, out value) ? value : null; }
    static string Text(Dictionary<string, object> request, string key) { return Value(request, key) as string; }
    static object Execute(Dictionary<string, object> request) {
        switch (Text(request, "op")) {
            case "read": return Read(request, false);
            case "verify": return Read(request, false);
            case "inspect": return Inspect(request);
            case "identify": return Inspect(request);
            case "settingsLocation":
                string location = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                if (String.IsNullOrEmpty(location)) Fail("SETTINGS_UNAVAILABLE");
                return new { path = location };
            case "settingsRead": return Settings(request, false);
            case "settingsWrite": return Settings(request, true);
            case "hold": return Read(request, true);
            case "holdSettings":
                if (!TestBarriers || Held != null) Fail("INVALID_REQUEST");
                Chain settings = SettingsDirectory(Text(request, "path"));
                try {
                    settings.Add(PrivateFile(settings.Last, "settings.lock", READ | WRITE, 0, OPEN_IF));
                    // The directory is now the penultimate handle; the lock stays pinned too.
                    settings.Add(PrivateFile(settings.Handles[settings.Handles.Count - 2], "settings.json", READ, 1, OPEN));
                    Held = settings; settings = null;
                    return new { hold = "pinned" };
                } finally { if (settings != null) settings.Dispose(); }
            case "release":
                if (!TestBarriers || Held == null || Text(request, "hold") != "pinned") Fail("INVALID_REQUEST");
                Held.Dispose(); Held = null; return new { released = true };
            default: Fail("INVALID_REQUEST"); return null;
        }
    }
    static string Line() {
        StringBuilder text = new StringBuilder();
        while (true) {
            int c = Console.In.Read();
            if (c < 0) return text.Length == 0 ? null : text.ToString();
            if (c == '\n') return text.ToString();
            if (text.Length >= 131072) return null;
            text.Append((char)c);
        }
    }
    public static int Main(string[] args) {
        Console.InputEncoding = new UTF8Encoding(false, true);
        Console.OutputEncoding = new UTF8Encoding(false, true);
        TestBarriers = args.Length == 1 && args[0] == "--test-barriers";
        try {
            string line;
            while ((line = Line()) != null) {
                object id = null; object result = null; string error = null;
                try {
                    var request = Json.Deserialize<Dictionary<string, object>>(line);
                    id = Value(request, "id"); result = Execute(request);
                } catch (Fault f) { error = f.Code; }
                catch (Exception e) { error = TestBarriers ? "SAFETY_UNSUPPORTED_" + e.GetType().Name : "SAFETY_UNSUPPORTED"; }
                string response = Json.Serialize(error == null ? (object)new { id = id, result = result } : new { id = id, error = error });
                if (response.Length > 1048575) return 2;
                Console.WriteLine(response); Console.Out.Flush();
            }
            return 0;
        } finally { if (Held != null) Held.Dispose(); }
    }
}
