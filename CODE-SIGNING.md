# Windows files and code signing

**The Windows files are not code-signed.** Windows SmartScreen ("Windows protected your PC") and Chrome ("not commonly
downloaded") may warn about them because the program is new and rarely downloaded. A signature is planned when a
suitable certificate is available.

This applies to `SJMR_Cheque_Writer_Setup.exe` (installer) and `SJMR_Cheque_Writer_Portable.exe`.

## How to check your download

Compare the SHA-256 of the file with the value on https://get.sjmrsoft.com/cheque
(PowerShell: `Get-FileHash .\SJMR_Cheque_Writer_Setup.exe`). If the values are equal, it is the file that was published.

## Source

The program is released under the [MIT license](LICENSE) and contains no closed-source component. The files are built
from the source code in this repository (the GitHub Actions workflow `.github/workflows/release-windows.yml`, or the
maintainer's own build script, which follows the same checks) and published by the maintainer.

## Privacy

This program does not send information to other networked systems unless the user asks for it.
The only network use is the first start of a computer that has no Microsoft Edge WebView2 runtime:
the program then offers to download that runtime from Microsoft. The cheque data stays on your own computer,
in the `SJMR Cheque Writer Data` folder (portable) or in `%APPDATA%\SJMR Cheque Writer\data` (installed).

## Contact

Questions or a security problem: info@sjmrsoft.com (see [SECURITY.md](SECURITY.md)).
