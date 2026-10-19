# Windows Library boundary (ticket 01)

This is maintained application source, **not a general-purpose file server**. The Library is not yet integrated with HTTP or the browser. Activity startup does not run this helper.

## Build and distribution

On x64 Windows with the existing .NET Framework 4.x compiler:

```powershell
npm run build:library-helper
node --test tests/library-native.test.mjs tests/library-source.test.mjs tests/library-metadata.test.mjs
```

The build uses `%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\csc.exe` and framework assemblies only. It does not install an SDK, NuGet package, PowerShell module or global tool, or change execution policy. The generated `native/bin/LibraryHelper.exe` is ignored. **A distribution must build/package this executable at that relative location as well as the Node files**; copying source without building it is not a supported Library installation. Do not distribute synthetic test executables. No runtime compilation or download occurs.

The supported boundary is a local fixed NTFS volume with a real volume-root drive mapping. Reparse points, SUBST/skipped ancestor mappings, network/removable/unsupported filesystems and hard-linked documents are refused. Missing/incompatible helpers fail closed. Ordinary activity functionality must not depend on Library support. File symlinks could not be created by this test account (`EPERM`); actual junctions exercise root/ancestor/leaf reparse refusal without changing privileges.

## Mechanism and trust

- The Node wrapper starts one private stdio worker with `shell:false`, no port, no content diagnostics, bounded UTF-8 JSON lines, monotonic request IDs, no queue and one outstanding operation. A timeout kills the worker and retains capacity until its close event. A later read can start a replacement only after confirmed exit; ambiguous settings writes are never retried.
- Starting at the validated fixed volume root, the worker opens each ancestor relative to its held parent using `NtCreateFile`, `OBJ_DONT_REPARSE` and `FILE_OPEN_REPARSE_POINT`. No ancestor handle shares delete access. Identity/volume, reparse attributes and final opened parent/name containment are checked **before** reading. Directory enumeration uses `NtQueryDirectoryFile` on the checked handle, not a path-based framework enumeration.
- File handles deny write/delete sharing. File type, link count, bounded size and identity/size/last-write state are checked around bounded reads. The snapshot signature also includes SHA-256 of the opened bytes, so equal-size edits with restored timestamps fail. Detail reads require the complete original ancestor identity chain and signature before content is returned. Local-link targets are separately revalidated, never opened from browser-supplied paths.
- Only SENTIENT settings and its two dedicated directories/artifacts can be created/written. Creation has an explicit protected DACL granting current-user and SYSTEM full control. Existing objects are opened without reparse following and their actual handle ACL/owner is verified; broad ACLs are refused, never silently repaired. This is not `chmod` privacy.
- A stable private lock file is opened without sharing across processes and never deleted. An OS handle releases exclusion after a crash. Writes compare the complete previous file hash under the lock, create a private unique temporary, flush it, then atomically rename its handle relative to the pinned directory. Failed pre-rename writes remove only their own temporary. A crash can leave a **private** orphan temporary; there is no unsafe wildcard cleanup. If the process dies after commit but before acknowledgement, the caller disables mutations and requires restart/reload rather than guessing.
- Administrators, SYSTEM, backups, a compromised same-user application, and a user deliberately changing their own ACLs are not a separate security principal defended against by per-user settings. Source files/content/metadata are never written by the helper. No file content or absolute settings paths belong in logs, activity/SSE or publication artifacts.

The `--test-barriers` process argument enables a bounded one-handle-chain test barrier and a pre-rename failure injection. Production launches never pass it. Tests use disposable synthetic fixtures and kill/close all workers; they do not read real home `.copilot`, settings or journals.

Official API references for the interop choices:

- [NtCreateFile: relative RootDirectory, access, sharing and options](https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntcreatefile)
- [NtQueryDirectoryFile: enumeration by opened directory handle](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/nf-ntifs-ntquerydirectoryfile)
- [FILE_RENAME_INFORMATION: relative atomic rename](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/ns-ntifs-_file_rename_information)
- [GetSecurityInfo: opened-object security descriptor](https://learn.microsoft.com/en-us/windows/win32/api/aclapi/nf-aclapi-getsecurityinfo)

These references explain API semantics; passing tests and fresh independent review, not the references alone, decide SOURCE acceptance.
