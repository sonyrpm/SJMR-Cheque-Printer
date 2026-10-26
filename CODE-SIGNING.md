# Code signing policy

Free code signing provided by [SignPath.io](https://signpath.io), certificate by [SignPath Foundation](https://signpath.org).

This policy applies to the Windows files of **SJMR Cheque Writer**:
`SJMR_Cheque_Writer_Setup.exe` (installer) and `SJMR_Cheque_Writer_Portable.exe`.
The release files are signed once SignPath Foundation has approved this project. Until then they are published unsigned.

## What is signed

Only files built from the source code in this repository, by the GitHub Actions workflow
`.github/workflows/release-windows.yml` on the `main` branch. Nothing is built or signed on a personal computer.
The program is released under the [MIT license](LICENSE). It contains no closed-source component.

## Roles

| Role | Person |
|---|---|
| Committers and reviewers | The maintainer, [sonyrpm](https://github.com/sonyrpm) |
| Approver of every signing request | The maintainer, [sonyrpm](https://github.com/sonyrpm) |

The project has one maintainer. Every release run is approved by hand in the GitHub
`production` environment before it can publish or sign.

## Privacy

This program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it.

The only network use is the first start of a computer that has no Microsoft Edge WebView2 runtime:
the program then offers to download that runtime from Microsoft. The cheque data stays on your own computer,
in the `SJMR Cheque Writer Data` folder (portable) or in `%APPDATA%\SJMR Cheque Writer\data` (installed).

## Contact

Questions about this policy or a security problem: info@sjmrsoft.com (see [SECURITY.md](SECURITY.md)).
