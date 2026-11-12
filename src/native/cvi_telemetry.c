#include <windows.h>
#include <winternl.h>
#include <tlhelp32.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifndef SystemProcessInformation
#define SystemProcessInformation 5
#endif

#ifndef ThreadQuerySetWin32StartAddress
#define ThreadQuerySetWin32StartAddress 9
#endif

typedef struct _CLIENT_ID_LOCAL {
    HANDLE UniqueProcess;
    HANDLE UniqueThread;
} CLIENT_ID_LOCAL;

typedef struct _SYSTEM_THREAD_INFORMATION_LOCAL {
    LARGE_INTEGER KernelTime;
    LARGE_INTEGER UserTime;
    LARGE_INTEGER CreateTime;
    ULONG         WaitTime;
    PVOID         StartAddress;
    CLIENT_ID_LOCAL ClientId;
    LONG          Priority;
    LONG          BasePriority;
    ULONG         ContextSwitches;
    ULONG         ThreadState;
    KWAIT_REASON  WaitReason;
} SYSTEM_THREAD_INFORMATION_LOCAL;

typedef struct _SYSTEM_PROCESS_INFORMATION_LOCAL {
    ULONG             NextEntryOffset;
    ULONG             NumberOfThreads;
    LARGE_INTEGER     WorkingSetPrivateSize;
    ULONG             HardFaultCount;
    ULONG             NumberOfThreadsHighWatermark;
    ULONGLONG         CycleTime;
    LARGE_INTEGER     CreateTime;
    LARGE_INTEGER     UserTime;
    LARGE_INTEGER     KernelTime;
    UNICODE_STRING    ImageName;
    LONG              BasePriority;
    HANDLE            UniqueProcessId;
    HANDLE            InheritedFromUniqueProcessId;
    ULONG             HandleCount;
    ULONG             SessionId;
    ULONG_PTR         UniqueProcessKey;
    SIZE_T            PeakVirtualSize;
    SIZE_T            VirtualSize;
    ULONG             PageFaultCount;
    SIZE_T            PeakWorkingSetSize;
    SIZE_T            WorkingSetSize;
    SIZE_T            QuotaPeakPagedPoolUsage;
    SIZE_T            QuotaPagedPoolUsage;
    SIZE_T            QuotaPeakNonPagedPoolUsage;
    SIZE_T            QuotaNonPagedPoolUsage;
    SIZE_T            PagefileUsage;
    SIZE_T            PeakPagefileUsage;
    SIZE_T            PrivatePageCount;
    LARGE_INTEGER     ReadOperationCount;
    LARGE_INTEGER     WriteOperationCount;
    LARGE_INTEGER     OtherOperationCount;
    LARGE_INTEGER     ReadTransferCount;
    LARGE_INTEGER     WriteTransferCount;
    LARGE_INTEGER     OtherTransferCount;
    SYSTEM_THREAD_INFORMATION_LOCAL Threads[1];
} SYSTEM_PROCESS_INFORMATION_LOCAL;

typedef NTSTATUS (NTAPI *pfnNtQuerySystemInformation)(
    ULONG SystemInformationClass,
    PVOID SystemInformation,
    ULONG SystemInformationLength,
    PULONG ReturnLength
);

typedef NTSTATUS (NTAPI *pfnNtQueryInformationThread)(
    HANDLE ThreadHandle,
    ULONG ThreadInformationClass,
    PVOID ThreadInformation,
    ULONG ThreadInformationLength,
    PULONG ReturnLength
);

typedef struct {
    ULONG_PTR base;
    ULONG_PTR size;
    char name[MAX_MODULE_NAME32 + 1];
} ModuleInfo;

static int GetProcessModules(DWORD pid, ModuleInfo **outModules) {
    HANDLE hSnap = CreateToolhelp32Snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, pid);
    if (hSnap == INVALID_HANDLE_VALUE) {
        *outModules = NULL;
        return 0;
    }

    int cap = 32;
    int count = 0;
    ModuleInfo *mods = (ModuleInfo *)malloc(sizeof(ModuleInfo) * cap);

    MODULEENTRY32 me;
    me.dwSize = sizeof(me);
    if (Module32First(hSnap, &me)) {
        do {
            if (count >= cap) {
                cap *= 2;
                mods = (ModuleInfo *)realloc(mods, sizeof(ModuleInfo) * cap);
            }
            mods[count].base = (ULONG_PTR)me.modBaseAddr;
            mods[count].size = (ULONG_PTR)me.modBaseSize;
            strncpy(mods[count].name, me.szModule, sizeof(mods[count].name) - 1);
            mods[count].name[sizeof(mods[count].name) - 1] = '\0';
            count++;
        } while (Module32Next(hSnap, &me));
    }
    CloseHandle(hSnap);
    *outModules = mods;
    return count;
}

static void FormatEntryPoint(ULONG_PTR addr, const ModuleInfo *modules, int modCount,
                             char *outBuf, size_t outSize, char *outMod, size_t outModSize) {
    if (outMod && outModSize > 0) outMod[0] = '\0';
    if (!addr) {
        snprintf(outBuf, outSize, "-");
        return;
    }
    for (int i = 0; i < modCount; i++) {
        if (addr >= modules[i].base && addr < (modules[i].base + modules[i].size)) {
            ULONG_PTR offset = addr - modules[i].base;
            snprintf(outBuf, outSize, "%s!0x%llX", modules[i].name, (unsigned long long)offset);
            if (outMod && outModSize > 0) {
                strncpy(outMod, modules[i].name, outModSize - 1);
                outMod[outModSize - 1] = '\0';
            }
            return;
        }
    }
    snprintf(outBuf, outSize, "0x%llX", (unsigned long long)addr);
}

static const char *GetWaitReasonString(int reason) {
    switch (reason) {
        case 0: return "Executive";
        case 1: return "FreePage";
        case 2: return "PageIn";
        case 3: return "PoolAllocation";
        case 4: return "DelayExecution";
        case 5: return "Suspended";
        case 6: return "UserRequest";
        case 7: return "EventPairHigh";
        case 8: return "EventPairLow";
        case 9: return "LpcReceive";
        case 10: return "LpcReply";
        case 11: return "VirtualMemory";
        case 12: return "PageOut";
        case 13: return "Rendezvous";
        case 15: return "WrQueue";
        default: return "Wait";
    }
}

static const char *GetThreadStateString(ULONG state, int reason) {
    switch (state) {
        case 0: return "Initialized";
        case 1: return "Ready";
        case 2: return "Running";
        case 3: return "Standby";
        case 4: return "Terminated";
        case 5:
            if (reason == 5) return "Suspended";
            return "Wait";
        case 6: return "Transition";
        case 7: return "Ready";
        default: return "Active";
    }
}

static const char *GetPriorityString(LONG prio) {
    if (prio <= 4) return "Lowest";
    if (prio <= 6) return "BelowNormal";
    if (prio <= 8) return "Normal";
    if (prio <= 10) return "AboveNormal";
    if (prio <= 14) return "Highest";
    return "TimeCritical";
}

static DWORD FindProcessIdByName(const char *processName) {
    HANDLE hSnap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (hSnap == INVALID_HANDLE_VALUE) return 0;

    PROCESSENTRY32 pe;
    pe.dwSize = sizeof(pe);
    DWORD pid = 0;
    if (Process32First(hSnap, &pe)) {
        do {
            if (_stricmp(pe.szExeFile, processName) == 0) {
                pid = pe.th32ProcessID;
                break;
            }
        } while (Process32Next(hSnap, &pe));
    }
    CloseHandle(hSnap);
    return pid;
}

static ULONGLONG FileTimeToUInt64(const FILETIME *ft) {
    ULARGE_INTEGER u;
    u.LowPart = ft->dwLowDateTime;
    u.HighPart = ft->dwHighDateTime;
    return u.QuadPart;
}

// Background thread for controlling individual threads via stdin
static DWORD WINAPI StdinCommandThread(LPVOID lpParam) {
    char cmdBuf[256];
    while (fgets(cmdBuf, sizeof(cmdBuf), stdin)) {
        size_t len = strlen(cmdBuf);
        while (len > 0 && (cmdBuf[len - 1] == '\r' || cmdBuf[len - 1] == '\n')) {
            cmdBuf[--len] = '\0';
        }
        if (len == 0) continue;

        DWORD tid = 0;
        if (sscanf(cmdBuf, "suspend %lu", &tid) == 1 && tid > 0) {
            HANDLE h = OpenThread(THREAD_SUSPEND_RESUME, FALSE, tid);
            if (h) {
                DWORD res = SuspendThread(h);
                CloseHandle(h);
                printf("{\"status\":\"ok\",\"action\":\"suspend\",\"tid\":%lu,\"count\":%lu}\n", tid, res);
                fflush(stdout);
            } else {
                printf("{\"status\":\"error\",\"action\":\"suspend\",\"tid\":%lu,\"error\":%lu}\n", tid, GetLastError());
                fflush(stdout);
            }
        } else if (sscanf(cmdBuf, "resume %lu", &tid) == 1 && tid > 0) {
            HANDLE h = OpenThread(THREAD_SUSPEND_RESUME, FALSE, tid);
            if (h) {
                DWORD res = ResumeThread(h);
                CloseHandle(h);
                printf("{\"status\":\"ok\",\"action\":\"resume\",\"tid\":%lu,\"count\":%lu}\n", tid, res);
                fflush(stdout);
            } else {
                printf("{\"status\":\"error\",\"action\":\"resume\",\"tid\":%lu,\"error\":%lu}\n", tid, GetLastError());
                fflush(stdout);
            }
        }
    }
    return 0;
}

int main(int argc, char **argv) {
    if (argc < 2) {
        fprintf(stderr, "Usage: cvi_telemetry.exe <PID_or_ProcessName> [interval_ms]\n");
        return 1;
    }

    DWORD targetPid = 0;
    char *endPtr = NULL;
    long parsed = strtol(argv[1], &endPtr, 10);
    if (endPtr && *endPtr == '\0' && parsed > 0) {
        targetPid = (DWORD)parsed;
    } else {
        char exeName[MAX_PATH];
        strncpy(exeName, argv[1], sizeof(exeName) - 1);
        exeName[sizeof(exeName) - 1] = '\0';
        if (!strstr(exeName, ".exe") && !strstr(exeName, ".EXE")) {
            strncat(exeName, ".exe", sizeof(exeName) - strlen(exeName) - 1);
        }
        for (int retries = 0; retries < 40; retries++) {
            targetPid = FindProcessIdByName(exeName);
            if (targetPid > 0) break;
            Sleep(250);
        }
    }

    if (!targetPid) {
        fprintf(stderr, "Target process not found: %s\n", argv[1]);
        return 1;
    }

    DWORD intervalMs = argc >= 3 ? (DWORD)atoi(argv[2]) : 1000;
    if (intervalMs < 100) intervalMs = 100;

    HANDLE hProcess = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, FALSE, targetPid);
    if (!hProcess) {
        fprintf(stderr, "Cannot open process %lu\n", targetPid);
        return 1;
    }

    HMODULE hNtdll = GetModuleHandleA("ntdll.dll");
    pfnNtQuerySystemInformation pNtQuerySystemInformation = NULL;
    pfnNtQueryInformationThread pNtQueryInformationThread = NULL;
    if (hNtdll) {
        pNtQuerySystemInformation = (pfnNtQuerySystemInformation)GetProcAddress(hNtdll, "NtQuerySystemInformation");
        pNtQueryInformationThread = (pfnNtQueryInformationThread)GetProcAddress(hNtdll, "NtQueryInformationThread");
    }

    if (!pNtQuerySystemInformation) {
        fprintf(stderr, "NtQuerySystemInformation not found in ntdll.dll\n");
        CloseHandle(hProcess);
        return 1;
    }

    // Launch background thread to handle stdin commands
    CreateThread(NULL, 0, StdinCommandThread, NULL, 0, NULL);

    SYSTEM_INFO sysInfo;
    GetSystemInfo(&sysInfo);
    DWORD numCores = sysInfo.dwNumberOfProcessors ? sysInfo.dwNumberOfProcessors : 1;

    FILETIME ftCreate, ftExit, ftKernel, ftUser;
    ULONGLONG prevCpuTime = 0;
    ULONGLONG prevWallTime = 0;

    if (GetProcessTimes(hProcess, &ftCreate, &ftExit, &ftKernel, &ftUser)) {
        prevCpuTime = FileTimeToUInt64(&ftKernel) + FileTimeToUInt64(&ftUser);
    }
    FILETIME ftNow;
    GetSystemTimeAsFileTime(&ftNow);
    prevWallTime = FileTimeToUInt64(&ftNow);

    ModuleInfo *modules = NULL;
    int modCount = GetProcessModules(targetPid, &modules);
    int modRefreshCounter = 0;

    // Buffer for NtQuerySystemInformation
    ULONG sysBufSize = 1024 * 1024;
    PVOID sysBuf = malloc(sysBufSize);

    // Line buffer for JSON output
    size_t lineBufCap = 65536;
    char *lineBuf = (char *)malloc(lineBufCap);

    while (WaitForSingleObject(hProcess, 0) == WAIT_TIMEOUT) {
        Sleep(intervalMs);

        if (!GetProcessTimes(hProcess, &ftCreate, &ftExit, &ftKernel, &ftUser)) {
            break;
        }
        GetSystemTimeAsFileTime(&ftNow);

        ULONGLONG curCpuTime = FileTimeToUInt64(&ftKernel) + FileTimeToUInt64(&ftUser);
        ULONGLONG curWallTime = FileTimeToUInt64(&ftNow);

        double cpuPercent = 0.0;
        ULONGLONG wallDelta = curWallTime - prevWallTime;
        ULONGLONG cpuDelta = (curCpuTime >= prevCpuTime) ? (curCpuTime - prevCpuTime) : 0;

        if (wallDelta > 0 && numCores > 0) {
            cpuPercent = ((double)cpuDelta / ((double)wallDelta * numCores)) * 100.0;
            if (cpuPercent < 0.0) cpuPercent = 0.0;
            if (cpuPercent > 100.0) cpuPercent = 100.0;
        }

        prevCpuTime = curCpuTime;
        prevWallTime = curWallTime;
        double totalCpuMs = (double)curCpuTime / 10000.0;

        if (++modRefreshCounter >= 10) {
            modRefreshCounter = 0;
            if (modules) free(modules);
            modCount = GetProcessModules(targetPid, &modules);
        }

        ULONG retLen = 0;
        NTSTATUS st = pNtQuerySystemInformation(SystemProcessInformation, sysBuf, sysBufSize, &retLen);
        if (st == (NTSTATUS)0xC0000004 /* STATUS_INFO_LENGTH_MISMATCH */) {
            sysBufSize = retLen + (1024 * 64);
            sysBuf = realloc(sysBuf, sysBufSize);
            st = pNtQuerySystemInformation(SystemProcessInformation, sysBuf, sysBufSize, &retLen);
        }

        size_t offset = snprintf(lineBuf, lineBufCap, "{\"pid\":%lu,\"cpuPercent\":%.1f,\"cpuMs\":%.1f,\"threads\":[",
                                 targetPid, cpuPercent, totalCpuMs);

        if (st == 0) {
            SYSTEM_PROCESS_INFORMATION_LOCAL *pProc = (SYSTEM_PROCESS_INFORMATION_LOCAL *)sysBuf;
            while (pProc) {
                DWORD pid = (DWORD)(ULONG_PTR)pProc->UniqueProcessId;
                if (pid == targetPid) {
                    for (ULONG i = 0; i < pProc->NumberOfThreads; i++) {
                        SYSTEM_THREAD_INFORMATION_LOCAL *pTh = &pProc->Threads[i];
                        DWORD tid = (DWORD)(ULONG_PTR)pTh->ClientId.UniqueThread;

                        ULONGLONG thTotal = (ULONGLONG)pTh->KernelTime.QuadPart + (ULONGLONG)pTh->UserTime.QuadPart;
                        double thCpuMs = (double)thTotal / 10000.0;

                        ULONG_PTR startAddr = (ULONG_PTR)pTh->StartAddress;
                        if (!startAddr && pNtQueryInformationThread) {
                            HANDLE hTh = OpenThread(THREAD_QUERY_INFORMATION | THREAD_QUERY_LIMITED_INFORMATION, FALSE, tid);
                            if (hTh) {
                                ULONG rlen = 0;
                                pNtQueryInformationThread(hTh, ThreadQuerySetWin32StartAddress, &startAddr, sizeof(startAddr), &rlen);
                                CloseHandle(hTh);
                            }
                        }

                        char entryStr[128];
                        char modStr[MAX_MODULE_NAME32 + 1];
                        FormatEntryPoint(startAddr, modules, modCount, entryStr, sizeof(entryStr), modStr, sizeof(modStr));

                        int waitReasonInt = (int)pTh->WaitReason;
                        const char *stateStr = GetThreadStateString(pTh->ThreadState, waitReasonInt);
                        const char *reasonStr = (pTh->ThreadState == 2) ? "-" : GetWaitReasonString(waitReasonInt);
                        const char *prioStr = GetPriorityString(pTh->Priority);

                        if (offset + 256 < lineBufCap) {
                            offset += snprintf(lineBuf + offset, lineBufCap - offset,
                                               "%s{\"id\":%lu,\"state\":\"%s\",\"waitReason\":\"%s\",\"priority\":\"%s\",\"cpuMs\":%.1f,\"entryPoint\":\"%s\",\"module\":\"%s\"}",
                                               (i > 0) ? "," : "",
                                               tid, stateStr, reasonStr, prioStr, thCpuMs, entryStr, modStr);
                        }
                    }
                    break;
                }
                if (pProc->NextEntryOffset == 0) break;
                pProc = (SYSTEM_PROCESS_INFORMATION_LOCAL *)((BYTE *)pProc + pProc->NextEntryOffset);
            }
        }

        if (offset + 3 < lineBufCap) {
            lineBuf[offset++] = ']';
            lineBuf[offset++] = '}';
            lineBuf[offset++] = '\n';
            lineBuf[offset] = '\0';
        }

        fputs(lineBuf, stdout);
        fflush(stdout);
    }

    if (modules) free(modules);
    if (sysBuf) free(sysBuf);
    free(lineBuf);
    CloseHandle(hProcess);
    return 0;
}
