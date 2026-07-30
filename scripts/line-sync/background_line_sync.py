from __future__ import annotations

import argparse
import ctypes
import json
import os
import subprocess
import sys
import time
from ctypes import wintypes
from datetime import datetime
from pathlib import Path

from PIL import Image
from wgcapture import capture_screen


ROOT = Path(__file__).resolve().parents[2]
RUNTIME_DIR = ROOT / ".sync-staging" / "line-hidden-desktop"
LINE_EXE = Path(os.environ.get("LOCALAPPDATA", "")) / "LINE" / "bin" / "current" / "LINE.exe"
DESKTOP_NAME = "AovLineSync"
CAPTURE_TITLE = "AovLineSyncCapture"

user32 = ctypes.WinDLL("user32", use_last_error=True)
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
gdi32 = ctypes.WinDLL("gdi32", use_last_error=True)

DESKTOP_CREATEWINDOW = 0x0002
DESKTOP_ENUMERATE = 0x0040
DESKTOP_WRITEOBJECTS = 0x0080
DESKTOP_READOBJECTS = 0x0001
DESKTOP_SWITCHDESKTOP = 0x0100
GENERIC_ALL = 0x10000000
CREATE_UNICODE_ENVIRONMENT = 0x00000400
WM_CLOSE = 0x0010
PW_RENDERFULLCONTENT = 0x00000002
HWND_BOTTOM = 1
SW_RESTORE = 9
SWP_NOACTIVATE = 0x0010
SWP_NOOWNERZORDER = 0x0200
DIB_RGB_COLORS = 0
BI_RGB = 0


class STARTUPINFO(ctypes.Structure):
    _fields_ = [
        ("cb", wintypes.DWORD),
        ("lpReserved", wintypes.LPWSTR),
        ("lpDesktop", wintypes.LPWSTR),
        ("lpTitle", wintypes.LPWSTR),
        ("dwX", wintypes.DWORD),
        ("dwY", wintypes.DWORD),
        ("dwXSize", wintypes.DWORD),
        ("dwYSize", wintypes.DWORD),
        ("dwXCountChars", wintypes.DWORD),
        ("dwYCountChars", wintypes.DWORD),
        ("dwFillAttribute", wintypes.DWORD),
        ("dwFlags", wintypes.DWORD),
        ("wShowWindow", wintypes.WORD),
        ("cbReserved2", wintypes.WORD),
        ("lpReserved2", ctypes.POINTER(ctypes.c_ubyte)),
        ("hStdInput", wintypes.HANDLE),
        ("hStdOutput", wintypes.HANDLE),
        ("hStdError", wintypes.HANDLE),
    ]


class PROCESS_INFORMATION(ctypes.Structure):
    _fields_ = [
        ("hProcess", wintypes.HANDLE),
        ("hThread", wintypes.HANDLE),
        ("dwProcessId", wintypes.DWORD),
        ("dwThreadId", wintypes.DWORD),
    ]


class RECT(ctypes.Structure):
    _fields_ = [("left", ctypes.c_long), ("top", ctypes.c_long), ("right", ctypes.c_long), ("bottom", ctypes.c_long)]


class BITMAPINFOHEADER(ctypes.Structure):
    _fields_ = [
        ("biSize", wintypes.DWORD),
        ("biWidth", ctypes.c_long),
        ("biHeight", ctypes.c_long),
        ("biPlanes", wintypes.WORD),
        ("biBitCount", wintypes.WORD),
        ("biCompression", wintypes.DWORD),
        ("biSizeImage", wintypes.DWORD),
        ("biXPelsPerMeter", ctypes.c_long),
        ("biYPelsPerMeter", ctypes.c_long),
        ("biClrUsed", wintypes.DWORD),
        ("biClrImportant", wintypes.DWORD),
    ]


class BITMAPINFO(ctypes.Structure):
    _fields_ = [("bmiHeader", BITMAPINFOHEADER), ("bmiColors", wintypes.DWORD * 3)]


def check_handle(value, action: str):
    if not value:
        raise ctypes.WinError(ctypes.get_last_error(), action)
    return value


def find_line_executable() -> Path:
    if LINE_EXE.exists():
        return LINE_EXE.resolve()
    base = Path(os.environ.get("LOCALAPPDATA", "")) / "LINE" / "bin"
    candidates = sorted(base.glob("*/LINE.exe"), key=lambda path: path.parent.name, reverse=True)
    if not candidates:
        raise FileNotFoundError("找不到 Windows LINE.exe")
    return candidates[0]


def line_process_ids() -> list[int]:
    command = [
        "powershell",
        "-NoProfile",
        "-Command",
        "@(Get-Process LINE -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id) -join ','",
    ]
    result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=10)
    return [int(value) for value in result.stdout.strip().split(",") if value.strip().isdigit()]


def stop_normal_line(timeout_seconds: float = 8) -> bool:
    process_ids = line_process_ids()
    if not process_ids:
        return False
    subprocess.run(["taskkill", "/IM", "LINE.exe", "/T"], capture_output=True, text=True, timeout=10)
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline and line_process_ids():
        time.sleep(0.25)
    if line_process_ids():
        subprocess.run(["taskkill", "/F", "/IM", "LINE.exe", "/T"], capture_output=True, text=True, timeout=10)
    deadline = time.monotonic() + 4
    while time.monotonic() < deadline and line_process_ids():
        time.sleep(0.2)
    if line_process_ids():
        raise RuntimeError("無法暫時關閉一般 LINE，已停止背景探測")
    return True


def restart_normal_line(executable: Path) -> None:
    subprocess.Popen([str(executable)], cwd=str(executable.parent), close_fds=True)


def create_hidden_desktop():
    user32.CreateDesktopW.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR, ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p]
    user32.CreateDesktopW.restype = wintypes.HANDLE
    access = GENERIC_ALL | DESKTOP_CREATEWINDOW | DESKTOP_ENUMERATE | DESKTOP_READOBJECTS | DESKTOP_WRITEOBJECTS | DESKTOP_SWITCHDESKTOP
    return check_handle(user32.CreateDesktopW(DESKTOP_NAME, None, None, 0, access, None), "CreateDesktopW")


def launch_on_desktop(executable: Path) -> PROCESS_INFORMATION:
    kernel32.CreateProcessW.argtypes = [
        wintypes.LPCWSTR,
        wintypes.LPWSTR,
        ctypes.c_void_p,
        ctypes.c_void_p,
        wintypes.BOOL,
        wintypes.DWORD,
        ctypes.c_void_p,
        wintypes.LPCWSTR,
        ctypes.POINTER(STARTUPINFO),
        ctypes.POINTER(PROCESS_INFORMATION),
    ]
    kernel32.CreateProcessW.restype = wintypes.BOOL
    startup = STARTUPINFO()
    startup.cb = ctypes.sizeof(startup)
    startup.lpDesktop = f"winsta0\\{DESKTOP_NAME}"
    process = PROCESS_INFORMATION()
    command = ctypes.create_unicode_buffer(f'"{executable}"')
    # LINE uses GPU composition by default, which produces black PrintWindow captures
    # on a non-interactive desktop. Software rendering keeps this isolated process capturable.
    os.environ["QT_QUICK_BACKEND"] = "software"
    os.environ["QT_OPENGL"] = "software"
    os.environ["QTWEBENGINE_CHROMIUM_FLAGS"] = "--disable-gpu --disable-gpu-compositing"
    success = kernel32.CreateProcessW(
        str(executable), command, None, None, False, CREATE_UNICODE_ENVIRONMENT, None, str(executable.parent), ctypes.byref(startup), ctypes.byref(process)
    )
    if not success:
        raise ctypes.WinError(ctypes.get_last_error(), "CreateProcessW")
    kernel32.CloseHandle(process.hThread)
    return process


def desktop_windows(desktop_handle) -> list[dict]:
    windows: list[dict] = []
    callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

    @callback_type
    def collect(hwnd, _):
        rect = RECT()
        user32.GetWindowRect(hwnd, ctypes.byref(rect))
        length = user32.GetWindowTextLengthW(hwnd)
        title = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, title, length + 1)
        class_name = ctypes.create_unicode_buffer(256)
        user32.GetClassNameW(hwnd, class_name, len(class_name))
        process_id = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(process_id))
        windows.append(
            {
                "hwnd": int(hwnd),
                "pid": process_id.value,
                "title": title.value,
                "className": class_name.value,
                "visible": bool(user32.IsWindowVisible(hwnd)),
                "width": max(0, rect.right - rect.left),
                "height": max(0, rect.bottom - rect.top),
            }
        )
        return True

    user32.EnumDesktopWindows.argtypes = [wintypes.HANDLE, callback_type, wintypes.LPARAM]
    user32.EnumDesktopWindows.restype = wintypes.BOOL
    if not user32.EnumDesktopWindows(desktop_handle, collect, 0):
        error = ctypes.get_last_error()
        # Windows returns FALSE with last-error 0 while a new desktop has no windows yet.
        if error:
            raise ctypes.WinError(error, "EnumDesktopWindows")
    return windows


def interactive_windows() -> list[dict]:
    windows: list[dict] = []
    callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

    @callback_type
    def collect(hwnd, _):
        rect = RECT()
        user32.GetWindowRect(hwnd, ctypes.byref(rect))
        length = user32.GetWindowTextLengthW(hwnd)
        title = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, title, length + 1)
        class_name = ctypes.create_unicode_buffer(256)
        user32.GetClassNameW(hwnd, class_name, len(class_name))
        process_id = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(process_id))
        windows.append(
            {
                "hwnd": int(hwnd),
                "pid": process_id.value,
                "title": title.value,
                "className": class_name.value,
                "visible": bool(user32.IsWindowVisible(hwnd)),
                "width": max(0, rect.right - rect.left),
                "height": max(0, rect.bottom - rect.top),
            }
        )
        return True

    user32.EnumWindows.argtypes = [callback_type, wintypes.LPARAM]
    user32.EnumWindows.restype = wintypes.BOOL
    if not user32.EnumWindows(collect, 0):
        raise ctypes.WinError(ctypes.get_last_error(), "EnumWindows")
    return windows


def wait_for_interactive_line_window(timeout_seconds: int) -> tuple[int, dict]:
    deadline = time.monotonic() + timeout_seconds
    last_candidates: list[dict] = []
    while time.monotonic() < deadline:
        process_ids = set(line_process_ids())
        last_candidates = [
            window
            for window in interactive_windows()
            if window["pid"] in process_ids
            and window["visible"]
            and "ScreenChangeObserver" not in window["className"]
            and window["width"] >= 600
            and window["height"] >= 400
        ]
        if last_candidates:
            last_candidates.sort(key=lambda window: window["width"] * window["height"], reverse=True)
            return last_candidates[0]["hwnd"], last_candidates[0]
        time.sleep(0.1)
    raise TimeoutError(f"LINE 在 {timeout_seconds} 秒內沒有建立主視窗；候選={json.dumps(last_candidates, ensure_ascii=False)}")


def move_window_to_background(hwnd: int) -> None:
    user32.SetWindowTextW(hwnd, CAPTURE_TITLE)
    user32.ShowWindow(hwnd, SW_RESTORE)
    if not user32.SetWindowPos(hwnd, HWND_BOTTOM, 0, 0, 1440, 900, SWP_NOACTIVATE | SWP_NOOWNERZORDER):
        raise ctypes.WinError(ctypes.get_last_error(), "SetWindowPos")
    time.sleep(8)


def capture_window_wgc(target: Path) -> tuple[int, int, float]:
    frame = capture_screen(screen=CAPTURE_TITLE)
    if frame is None or getattr(frame, "size", 0) == 0:
        raise RuntimeError("Windows Graphics Capture 沒有取得 LINE 畫面")
    image = Image.fromarray(frame).convert("RGB")
    sample = image.resize((160, 90)).convert("L")
    non_black_ratio = sum(value > 8 for value in sample.getdata()) / (160 * 90)
    if non_black_ratio < 0.01:
        raise RuntimeError("Windows Graphics Capture 取得黑畫面")
    if len(sample.getcolors(maxcolors=160 * 90) or []) < 25:
        raise RuntimeError("Windows Graphics Capture 取得空白輔助視窗，不是 LINE 主畫面")
    target.parent.mkdir(parents=True, exist_ok=True)
    image.save(target, "PNG", optimize=True)
    return image.width, image.height, non_black_ratio


def wait_for_line_window(desktop_handle, process_id: int, timeout_seconds: int) -> tuple[int, list[dict]]:
    deadline = time.monotonic() + timeout_seconds
    last_windows: list[dict] = []
    while time.monotonic() < deadline:
        last_windows = desktop_windows(desktop_handle)
        candidates = [window for window in last_windows if window["width"] >= 600 and window["height"] >= 400]
        if candidates:
            candidates.sort(key=lambda window: window["width"] * window["height"], reverse=True)
            return candidates[0]["hwnd"], last_windows
        time.sleep(0.5)
    diagnostics = json.dumps({"launcherPid": process_id, "linePids": line_process_ids(), "windows": last_windows}, ensure_ascii=False)
    raise TimeoutError(f"LINE 在 {timeout_seconds} 秒內沒有建立可擷取的背景視窗；診斷={diagnostics}")


def capture_window(hwnd: int, target: Path) -> tuple[int, int, float]:
    rect = RECT()
    check_handle(user32.GetWindowRect(hwnd, ctypes.byref(rect)), "GetWindowRect")
    width, height = rect.right - rect.left, rect.bottom - rect.top
    if width <= 0 or height <= 0:
        raise RuntimeError("LINE 背景視窗尺寸無效")
    window_dc = check_handle(user32.GetWindowDC(hwnd), "GetWindowDC")
    memory_dc = check_handle(gdi32.CreateCompatibleDC(window_dc), "CreateCompatibleDC")
    bitmap = check_handle(gdi32.CreateCompatibleBitmap(window_dc, width, height), "CreateCompatibleBitmap")
    previous = gdi32.SelectObject(memory_dc, bitmap)
    try:
        if not user32.PrintWindow(hwnd, memory_dc, PW_RENDERFULLCONTENT):
            raise RuntimeError("PrintWindow 無法擷取 LINE 背景視窗")
        info = BITMAPINFO()
        info.bmiHeader.biSize = ctypes.sizeof(BITMAPINFOHEADER)
        info.bmiHeader.biWidth = width
        info.bmiHeader.biHeight = -height
        info.bmiHeader.biPlanes = 1
        info.bmiHeader.biBitCount = 32
        info.bmiHeader.biCompression = BI_RGB
        pixels = ctypes.create_string_buffer(width * height * 4)
        rows = gdi32.GetDIBits(memory_dc, bitmap, 0, height, pixels, ctypes.byref(info), DIB_RGB_COLORS)
        if rows != height:
            raise RuntimeError("無法讀取 LINE 背景視窗像素")
        image = Image.frombuffer("RGB", (width, height), pixels, "raw", "BGRX", 0, 1)
        sample = image.resize((160, 90)).convert("L")
        non_black_ratio = sum(value > 8 for value in sample.getdata()) / (160 * 90)
        if non_black_ratio < 0.01:
            raise RuntimeError("LINE 背景截圖為黑畫面，未通過像素驗證")
        target.parent.mkdir(parents=True, exist_ok=True)
        image.save(target, "PNG", optimize=True)
        return width, height, non_black_ratio
    finally:
        gdi32.SelectObject(memory_dc, previous)
        gdi32.DeleteObject(bitmap)
        gdi32.DeleteDC(memory_dc)
        user32.ReleaseDC(hwnd, window_dc)


def close_hidden_line(process: PROCESS_INFORMATION, windows: list[dict]) -> None:
    for window in windows:
        if window["pid"] == process.dwProcessId:
            user32.PostMessageW(window["hwnd"], WM_CLOSE, 0, 0)
    kernel32.WaitForSingleObject(process.hProcess, 5000)
    exit_code = wintypes.DWORD()
    kernel32.GetExitCodeProcess(process.hProcess, ctypes.byref(exit_code))
    if exit_code.value == 259:
        kernel32.TerminateProcess(process.hProcess, 0)
        kernel32.WaitForSingleObject(process.hProcess, 3000)
    kernel32.CloseHandle(process.hProcess)


def probe(timeout_seconds: int) -> dict:
    executable = find_line_executable()
    was_running = bool(line_process_ids())
    stopped = stop_normal_line()
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    screenshot = RUNTIME_DIR / f"probe-{timestamp}.png"
    try:
        startup = subprocess.STARTUPINFO()
        startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        startup.wShowWindow = 4  # SW_SHOWNOACTIVATE
        launcher = subprocess.Popen([str(executable)], cwd=str(executable.parent), startupinfo=startup)
        hwnd, selected_window = wait_for_interactive_line_window(timeout_seconds)
        move_window_to_background(hwnd)
        width, height, non_black_ratio = capture_window_wgc(screenshot)
        result = {
            "ok": True,
            "mode": "probe",
            "capture": "Windows.Graphics.Capture",
            "linePid": launcher.pid,
            "window": {**selected_window, "width": width, "height": height, "nonBlackRatio": round(non_black_ratio, 4)},
            "screenshot": str(screenshot),
            "normalLineWasRunning": was_running,
            "capturedAt": datetime.now().astimezone().isoformat(),
        }
        report = RUNTIME_DIR / "last-probe.json"
        report.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return result
    finally:
        try:
            stop_normal_line()
        except Exception as error:
            print(f"[line-sync] 關閉背景 LINE 失敗: {error}", file=sys.stderr)
        if was_running or stopped:
            restart_normal_line(executable)


def main() -> None:
    parser = argparse.ArgumentParser(description="Windows hidden-desktop LINE sync helper")
    parser.add_argument("command", choices=["probe"])
    parser.add_argument("--timeout", type=int, default=35)
    args = parser.parse_args()
    if args.command == "probe":
        print(json.dumps(probe(args.timeout), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"[line-sync] {error}", file=sys.stderr)
        sys.exit(1)
