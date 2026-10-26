// First start on a PC without Microsoft Edge WebView2 (the Windows component that draws the window):
// download Microsoft's small bootstrapper and install it, then go on. Windows 11 and updated Windows 10
// already have it, so this is rare.
use std::os::windows::process::CommandExt;
use std::process::Command;

const CLIENT: &str = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";

fn powershell(script: &str) {
    let _ = Command::new("powershell.exe")
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-Command", script])
        .creation_flags(0x0800_0000)
        .status();
}

fn installed() -> bool {
    [
        format!(r"HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{CLIENT}"),
        format!(r"HKLM\SOFTWARE\Microsoft\EdgeUpdate\Clients\{CLIENT}"),
        format!(r"HKCU\Software\Microsoft\EdgeUpdate\Clients\{CLIENT}"),
    ]
    .iter()
    .any(|key| {
        Command::new("reg")
            .args(["query", key, "/v", "pv"])
            .creation_flags(0x0800_0000)
            .output()
            .map(|o| o.status.success() && !String::from_utf8_lossy(&o.stdout).contains("0.0.0.0"))
            .unwrap_or(false)
    })
}

pub fn ensure_or_exit() {
    if installed() {
        return;
    }
    powershell(
        r#"Add-Type -AssemblyName System.Windows.Forms
[void][System.Windows.Forms.MessageBox]::Show('SJMR Cheque Writer needs Microsoft Edge WebView2, a free Windows component. It is downloaded and installed now (about 2 MB, first start only). Press OK to continue.', 'SJMR Cheque Writer', 'OK', 'Information')
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $file = Join-Path $env:TEMP 'MicrosoftEdgeWebview2Setup.exe'
  Invoke-WebRequest -UseBasicParsing -Uri 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile $file
  Start-Process -FilePath $file -ArgumentList '/install' -Wait
} catch {
  [void][System.Windows.Forms.MessageBox]::Show('The WebView2 download did not work. Connect this PC to the internet and start SJMR Cheque Writer again, or install Microsoft Edge WebView2 Runtime from https://developer.microsoft.com/microsoft-edge/webview2/', 'SJMR Cheque Writer', 'OK', 'Warning')
}"#,
    );
    if !installed() {
        powershell(
            r#"Add-Type -AssemblyName System.Windows.Forms
[void][System.Windows.Forms.MessageBox]::Show('Microsoft Edge WebView2 is not installed, so SJMR Cheque Writer cannot start. Start it again to retry the installation.', 'SJMR Cheque Writer', 'OK', 'Warning')"#,
        );
        std::process::exit(1);
    }
}
