//! An unpackaged installer can be launched by a packaged desktop host. Do not
//! inherit that host's virtualized AppData namespace into our UI or backend.
use std::{io, mem::size_of, os::windows::ffi::OsStrExt, ptr};
use windows_sys::Win32::{
    Foundation::{
        CloseHandle, APPMODEL_ERROR_NO_PACKAGE, ERROR_INSUFFICIENT_BUFFER, HANDLE, WAIT_OBJECT_0,
    },
    Security::{EqualSid, GetTokenInformation, TokenUser, TOKEN_QUERY, TOKEN_USER},
    Storage::Packaging::Appx::GetCurrentPackageFullName,
    System::{
        Environment::GetCommandLineW,
        Threading::{
            CreateProcessW, DeleteProcThreadAttributeList, GetCurrentProcess, GetExitCodeProcess,
            InitializeProcThreadAttributeList, OpenProcess, OpenProcessToken,
            UpdateProcThreadAttribute, WaitForSingleObject, CREATE_NO_WINDOW,
            EXTENDED_STARTUPINFO_PRESENT, INFINITE, PROCESS_CREATE_PROCESS, PROCESS_INFORMATION,
            PROCESS_QUERY_LIMITED_INFORMATION, PROC_THREAD_ATTRIBUTE_DESKTOP_APP_POLICY,
            PROC_THREAD_ATTRIBUTE_PARENT_PROCESS, STARTUPINFOEXW,
        },
        WindowsProgramming::PROCESS_CREATION_DESKTOP_APP_BREAKAWAY_ENABLE_PROCESS_TREE,
    },
    UI::WindowsAndMessaging::{
        GetShellWindow, GetWindowThreadProcessId, MessageBoxW, MB_ICONERROR, MB_OK,
    },
};

const MARKER: &str = "--desktop-package-relaunch";

struct Handle(HANDLE);
impl Drop for Handle {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}

fn token_user(process: HANDLE) -> io::Result<Vec<usize>> {
    let mut raw = ptr::null_mut();
    if unsafe { OpenProcessToken(process, TOKEN_QUERY, &mut raw) } == 0 {
        return Err(io::Error::last_os_error());
    }
    let token = Handle(raw);
    let mut bytes = 0;
    unsafe {
        GetTokenInformation(token.0, TokenUser, ptr::null_mut(), 0, &mut bytes);
    }
    if bytes == 0 {
        return Err(io::Error::last_os_error());
    }
    let mut user = vec![0usize; (bytes as usize).div_ceil(size_of::<usize>())];
    if unsafe {
        GetTokenInformation(
            token.0,
            TokenUser,
            user.as_mut_ptr().cast(),
            bytes,
            &mut bytes,
        )
    } == 0
    {
        return Err(io::Error::last_os_error());
    }
    Ok(user)
}

fn desktop_parent() -> io::Result<Handle> {
    let window = unsafe { GetShellWindow() };
    let mut pid = 0;
    if window.is_null() || unsafe { GetWindowThreadProcessId(window, &mut pid) } == 0 {
        return Err(io::Error::other(
            "Windows 桌面 Shell 不可用，请登录桌面后从开始菜单启动。",
        ));
    }
    let raw = unsafe {
        OpenProcess(
            PROCESS_CREATE_PROCESS | PROCESS_QUERY_LIMITED_INFORMATION,
            0,
            pid,
        )
    };
    if raw.is_null() {
        return Err(io::Error::last_os_error());
    }
    let parent = Handle(raw);
    let current_user = token_user(unsafe { GetCurrentProcess() })?;
    let desktop_user = token_user(parent.0)?;
    let equal = unsafe {
        EqualSid(
            (*(current_user.as_ptr().cast::<TOKEN_USER>())).User.Sid,
            (*(desktop_user.as_ptr().cast::<TOKEN_USER>())).User.Sid,
        )
    };
    if equal == 0 {
        return Err(io::Error::other(
            "桌面 Shell 与当前应用用户不同，请以桌面用户重新启动应用。",
        ));
    }
    Ok(parent)
}

pub fn is_packaged() -> io::Result<bool> {
    let mut length = 0;
    match unsafe { GetCurrentPackageFullName(&mut length, ptr::null_mut()) } {
        APPMODEL_ERROR_NO_PACKAGE => Ok(false),
        ERROR_INSUFFICIENT_BUFFER => Ok(true),
        error => Err(io::Error::from_raw_os_error(error as i32)),
    }
}

/// Use the same user's desktop Shell as the parent (token, device map and job),
/// plus the desktop policy, even when GetCurrentPackageFullName reports
/// no identity: an unpackaged child may still inherit filesystem virtualization.
/// Preserve the exact Windows command line, including non-Unicode paths. Never
/// invoke a shell. Keep the launcher alive to propagate the application's exit
/// code to installers and test runners; only the child creates windows/backend.
pub fn enter_desktop_environment() -> io::Result<Option<u32>> {
    if std::env::args_os().any(|arg| arg == MARKER) {
        return if is_packaged()? {
            Err(io::Error::other(
                "Windows 未能切换到独立桌面运行环境，请从开始菜单重新启动应用。",
            ))
        } else {
            Ok(None)
        };
    }
    let executable: Vec<u16> = std::env::current_exe()?
        .as_os_str()
        .encode_wide()
        .chain([0])
        .collect();
    let mut command = unsafe {
        let raw = GetCommandLineW();
        let mut length = 0;
        while *raw.add(length) != 0 {
            length += 1;
        }
        std::slice::from_raw_parts(raw, length).to_vec()
    };
    command.extend(format!(" {MARKER}").encode_utf16().chain([0]));
    spawn_and_wait(&executable, &mut command).map(Some)
}

fn spawn_and_wait(executable: &[u16], command: &mut [u16]) -> io::Result<u32> {
    let mut parent = desktop_parent()?;
    // Attribute storage needs pointer alignment and must outlive CreateProcessW.
    let mut bytes = 0;
    unsafe {
        InitializeProcThreadAttributeList(ptr::null_mut(), 2, 0, &mut bytes);
    }
    if bytes == 0 {
        return Err(io::Error::last_os_error());
    }
    let mut storage = vec![0usize; bytes.div_ceil(size_of::<usize>())];
    let list = storage.as_mut_ptr().cast();
    if unsafe { InitializeProcThreadAttributeList(list, 2, 0, &mut bytes) } == 0 {
        return Err(io::Error::last_os_error());
    }
    let mut policy = PROCESS_CREATION_DESKTOP_APP_BREAKAWAY_ENABLE_PROCESS_TREE;
    let mut info = STARTUPINFOEXW::default();
    info.StartupInfo.cb = size_of::<STARTUPINFOEXW>() as u32;
    info.lpAttributeList = list;
    let mut process = PROCESS_INFORMATION::default();
    let result = unsafe {
        if UpdateProcThreadAttribute(
            list,
            0,
            PROC_THREAD_ATTRIBUTE_DESKTOP_APP_POLICY as usize,
            (&mut policy as *mut u32).cast(),
            size_of::<u32>(),
            ptr::null_mut(),
            ptr::null(),
        ) == 0
        {
            Err(io::Error::last_os_error())
        } else if UpdateProcThreadAttribute(
            list,
            0,
            PROC_THREAD_ATTRIBUTE_PARENT_PROCESS as usize,
            (&mut parent.0 as *mut HANDLE).cast(),
            size_of::<HANDLE>(),
            ptr::null_mut(),
            ptr::null(),
        ) == 0
        {
            Err(io::Error::last_os_error())
        } else if CreateProcessW(
            executable.as_ptr(),
            command.as_mut_ptr(),
            ptr::null(),
            ptr::null(),
            0,
            EXTENDED_STARTUPINFO_PRESENT | CREATE_NO_WINDOW,
            ptr::null(),
            ptr::null(),
            &info.StartupInfo,
            &mut process,
        ) == 0
        {
            Err(io::Error::last_os_error())
        } else {
            Ok(())
        }
    };
    unsafe {
        DeleteProcThreadAttributeList(list);
    }
    result?;
    unsafe {
        CloseHandle(process.hThread);
    }
    let result = if unsafe { WaitForSingleObject(process.hProcess, INFINITE) } != WAIT_OBJECT_0 {
        Err(io::Error::last_os_error())
    } else {
        let mut code = 1;
        if unsafe { GetExitCodeProcess(process.hProcess, &mut code) } == 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(code)
        }
    };
    unsafe {
        CloseHandle(process.hProcess);
    }
    result
}

pub fn show_startup_error(error: &io::Error) {
    let title: Vec<u16> = "OpenCodex Desktop\0".encode_utf16().collect();
    let message: Vec<u16> =
        format!("无法初始化独立桌面运行环境：{error}\n请从开始菜单启动 OpenCodex Desktop。\0")
            .encode_utf16()
            .collect();
    unsafe {
        MessageBoxW(
            ptr::null_mut(),
            message.as_ptr(),
            title.as_ptr(),
            MB_OK | MB_ICONERROR,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "requires an interactive Windows desktop; run explicitly"]
    fn child_runs_without_package_identity() {
        eprintln!("packaged test host: {}", is_packaged().unwrap());
        let exe: Vec<u16> = std::env::current_exe()
            .unwrap()
            .as_os_str()
            .encode_wide()
            .chain([0])
            .collect();
        let mut command: Vec<u16> = format!(
            "\"{}\" --exact windows_runtime::tests::unpackaged_child --ignored --nocapture",
            std::env::current_exe().unwrap().display()
        )
        .encode_utf16()
        .chain([0])
        .collect();
        let code = spawn_and_wait(&exe, &mut command);
        assert_eq!(code.unwrap(), 0);
    }

    #[test]
    #[ignore = "invoked by the process-boundary regression"]
    fn unpackaged_child() {
        use std::os::windows::process::CommandExt;
        assert!(
            !is_packaged().unwrap(),
            "child still inherits the host package"
        );
        let status = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "windows_runtime::tests::unpackaged_grandchild",
                "--ignored",
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .status()
            .unwrap();
        assert!(status.success());
    }

    #[test]
    #[ignore = "invoked by the process-boundary regression"]
    fn unpackaged_grandchild() {
        assert!(
            !is_packaged().unwrap(),
            "backend descendants inherit the host package"
        );
    }
}
