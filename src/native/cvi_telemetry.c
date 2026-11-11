#include <windows.h>
#include <tlhelp32.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef NTSTATUS (NTAPI *pfnNtQueryInformationThread)(
    HANDLE ThreadHandle,
    ULONG ThreadInformationClass,
    PVOID ThreadInformation,
    ULONG ThreadInformationLength,
    PULONG ReturnLength
);

#define ThreadQuerySetWin32StartAddress 9

typedef struct {
    char name[MAX_MODULE_NAME32 + 1];
    ULONG_PTR base;
    ULONG_PTR size;
} ModuleInfo;

static DWORD FindProcessIdByName(const char *name) {
    HANDLE hSnap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (hSnap == INVALID_HANDLE_VALUE) return 0;
    PROCESSENTRY32 pe;
    pe.dwSize = sizeof(pe);
    DWORD foundPid = 0;
    if (Process32First(hSnap, &pe)) {
        do {
            if (_stricmp(pe.szExeFile, name) == 0) {
                foundPid = pe.th32ProcessID;
                break;
            }
        } while (Process32Next(hSnap, &pe));
    }
    CloseHandle(hSnap);
    return foundPid;
}

static int GetProcessModules(DWORD pid, ModuleInfo **outModules) {
    HANDLE hSnap = CreateToolhelp32Snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, pid);
    if (hSnap == INVALID_HANDLE_VALUE) {
        *outModules = NULL;
        return 0;
    }
    MODULEENTRY32 me;
    me.dwSize = sizeof(me);
    int capacity = 32;
    int count = 0;
    ModuleInfo *mods = (ModuleInfo *)malloc(capacity * sizeof(ModuleInfo));

    if (Module32First(hSnap, &me)) {
        do {
            if (count >= capacity) {
                capacity *= 2;
                mods = (ModuleInfo *)realloc(mods, capacity * sizeof(ModuleInfo));
            }
            strncpy(mods[count].name, me.szModule, MAX_MODULE_NAME32);
            mods[count].name[MAX_MODULE_NAME32] = '\0';
            mods[count].base = (ULONG_PTR)me.modBaseAddr;
            mods[count].size = (ULONG_PTR)me.modBaseSize;
            count++;
        } while (Module32Next(hSnap, &me));
    }
    CloseHandle(hSnap);
    *outModules = mods;
    return count;
}

static void FormatEntryPoint(ULONG_PTR addr, ModuleInfo *mods, int modCount, char *outBuf, size_t bufSize, char *outMod, size_t modBufSize) {
    if (!addr) {
        snprintf(outBuf, bufSize, "-");
        if (outMod) snprintf(outMod, modBufSize, "Unknown");
        return;
    }
    for (int i = 0; i < modCount; i++) {
        if (addr >= mods[i].base && addr < mods[i].base + mods[i].size) {
            ULONG_PTR offset = addr - mods[i].base;
            snprintf(outBuf, bufSize, "%s!0x%llX", mods[i].name, (unsigned long long)offset);
            if (outMod) snprintf(outMod, modBufSize, "%s", mods[i].name);
            return;
        }
    }
    snprintf(outBuf, bufSize, "0x%llX", (unsigned long long)addr);
    if (outMod) snprintf(outMod, modBufSize, "System");
}

static ULONGLONG FileTimeToUInt64(const FILETIME *ft) {
    ULARGE_INTEGER uli;
    uli.LowPart = ft->dwLowDateTime;
    uli.HighPart = ft->dwHighDateTime;
    return uli.QuadPart;
}

int main(int argc, char *argv[]) {
    if (argc < 2) {
        fprintf(stderr, "Usage: %s <PID_or_ProcessName> [interval_ms]\n", argv[0]);
        return 1;
    }

    DWORD targetPid = 0;
    char *endPtr = NULL;
    long parsed = strtol(argv[1], &endPtr, 10);
    if (endPtr && *endPtr == '\0' && parsed > 0) {
        targetPid = (DWORD)parsed;
    } else {
        // Search by executable name
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
    pfnNtQueryInformationThread pNtQueryInformationThread = NULL;
    if (hNtdll) {
        pNtQueryInformationThread = (pfnNtQueryInformationThread)GetProcAddress(hNtdll, "NtQueryInformationThread");
    }

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

        size_t offset = snprintf(lineBuf, lineBufCap, "{\"pid\":%lu,\"cpuPercent\":%.1f,\"cpuMs\":%.1f,\"threads\":[",
                                 targetPid, cpuPercent, totalCpuMs);

        HANDLE hSnap = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
        int threadCount = 0;
        if (hSnap != INVALID_HANDLE_VALUE) {
            THREADENTRY32 te;
            te.dwSize = sizeof(te);
            if (Thread32First(hSnap, &te)) {
                do {
                    if (te.th32OwnerProcessID == targetPid) {
                        HANDLE hThread = OpenThread(THREAD_QUERY_INFORMATION | THREAD_QUERY_LIMITED_INFORMATION, FALSE, te.th32ThreadID);
                        if (!hThread) {
                            hThread = OpenThread(THREAD_QUERY_LIMITED_INFORMATION, FALSE, te.th32ThreadID);
                        }

                        double thCpuMs = 0.0;
                        int prio = te.tpBasePri;
                        ULONG_PTR startAddr = 0;

                        if (hThread) {
                            FILETIME tCreate, tExit, tKernel, tUser;
                            if (GetThreadTimes(hThread, &tCreate, &tExit, &tKernel, &tUser)) {
                                ULONGLONG thTotal = FileTimeToUInt64(&tKernel) + FileTimeToUInt64(&tUser);
                                thCpuMs = (double)thTotal / 10000.0;
                            }
                            int p = GetThreadPriority(hThread);
                            if (p != THREAD_PRIORITY_ERROR_RETURN) {
                                prio = p;
                            }
                            if (pNtQueryInformationThread) {
                                ULONG retLen = 0;
                                pNtQueryInformationThread(hThread, ThreadQuerySetWin32StartAddress, &startAddr, sizeof(startAddr), &retLen);
                            }
                            CloseHandle(hThread);
                        }

                        const char *prioStr = "Normal";
                        if (prio > 0) prioStr = "AboveNormal";
                        if (prio > 1) prioStr = "Highest";
                        if (prio < 0) prioStr = "BelowNormal";
                        if (prio < -1) prioStr = "Lowest";

                        char entryStr[128];
                        char modStr[MAX_MODULE_NAME32 + 1];
                        FormatEntryPoint(startAddr, modules, modCount, entryStr, sizeof(entryStr), modStr, sizeof(modStr));

                        if (offset + 256 < lineBufCap) {
                            if (threadCount > 0) {
                                lineBuf[offset++] = ',';
                            }
                            offset += snprintf(lineBuf + offset, lineBufCap - offset,
                                               "{\"id\":%lu,\"priority\":\"%s\",\"cpuMs\":%.1f,\"entryPoint\":\"%s\",\"module\":\"%s\"}",
                                               te.th32ThreadID, prioStr, thCpuMs, entryStr, modStr);
                            threadCount++;
                        }
                    }
                } while (Thread32Next(hSnap, &te));
            }
            CloseHandle(hSnap);
        }

        if (offset + 4 < lineBufCap) {
            lineBuf[offset++] = ']';
            lineBuf[offset++] = '}';
            lineBuf[offset++] = '\n';
            lineBuf[offset] = '\0';
            fputs(lineBuf, stdout);
            fflush(stdout);
        }
    }

    if (lineBuf) free(lineBuf);
    if (modules) free(modules);
    CloseHandle(hProcess);
    return 0;
}
