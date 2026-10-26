# SJMR Cheque Writer

Write and print cheques on your bank's cheque leaf, and keep a simple list of the cheques you issued.
A compact Windows program with tabs (about 10 MB, built with Tauri on the Windows WebView2 that ships with Windows 10 and 11). It prints exactly like the Write & Print screen of SJMR Accounting:
the printing engine and the bank layouts are the same.

| Tab | What it does |
|---|---|
| **Write & Print** | Bank account, layout, cheque number, date, payee, amount, wording, crossing. Live preview (drag a field to move it). Printer, tray, orientation, feed. Buttons: Print directly, Windows Print dialog, Cheque PDF. |
| **Cheque List** | Every cheque you listed. Mark **Cleared**, **Returned** (with a reason) or **Cancelled**, reopen, add a note, change the date, export CSV. Filters: Pending, Coming, Needs attention, Cleared, Returned, Cancelled. Every change is kept in the cheque history. |
| **Template Printer** | Prints copies of a cheque scan at its exact size on plain paper, for test printing without a real cheque (see below). |
| **Banks & Layouts** | Bank accounts and the library of 42 bank layouts (create, edit, import, export). |
| **Payees** | Payee list for quick entry. Import JSON, CSV or TXT. |
| **Settings** | Alerts, data copy and restore, import from the old Cheque Printer. |

## Add cheque to list

On the print screen the box **Add cheque to list** is ticked by default.

- **Ticked:** the cheque is printed (or saved as PDF) and, only after that worked, added to the Cheque List as **Pending**. The cheque number then counts up by one.
- **Unticked:** the cheque is only printed. Nothing is saved.
- A number that is already **Cleared**, **Returned** or **Cancelled** in the list is refused *before* printing, so no cheque leaf is wasted.
- Printing the same **Pending** number again updates its entry instead of adding a second one.

## Template Printer (test printing without a real cheque)

Scan a cheque at 300 DPI, crop exactly to its four edges (crop only: no resizing), save as PNG or JPG. On the **Template Printer** tab choose the picture (or drop it on the tab), enter the scan DPI and press **Calculate size from DPI**, or type the width and height in mm. Then choose the printer, paper (A4, the printer's own sizes, or Custom), orientation, minimum margin, gap and total copies. The preview shows each page; **Save PDF** or **Print** (or the Windows Print dialog) sends it out.

| Option | Meaning |
|---|---|
| Cutting border, border thickness | A thin black line around every picture (0.01 to 2 mm) for cutting. |
| Horizontal / vertical centre lines | Hairline guides halfway between rows or columns. |
| Horizontal / vertical offset | Micro-adjustment in mm (+ right / down) for the whole sheet; a picture pushed off the paper is refused. |
| Preset | 201.9 x 100.9 mm, 2 copies, margin 4, gap 10. |

The picture is never shrunk: a size that does not fit the paper, or the printer's printable area, stops the job with a message. In the printer properties turn off Fit, Shrink, borderless expansion and scaling, and measure the first print with a ruler. The sizes are remembered; the picture is not. The PDF engine is the one of the original SJMR Template Printer (tests compare its PDFs byte for byte).

## Alerts for coming cheques

Settings > Alerts: alert N days before the cheque date and N days after it when it is still not cleared.
Alerts show as a banner, a red number on the **Cheque List** tab and a Windows notification (once a day for each cheque).
Only **Pending** cheques raise alerts. With "Keep running in the tray" the program stays in the tray so alerts still appear
when the window is closed; "Start with Windows" starts it minimized.

## Where the data is

| Build | Data |
|---|---|
| Portable exe | `SJMR Cheque Writer Data` folder beside the exe (move the folder with the program). |
| Installed | `%APPDATA%\SJMR Cheque Writer\data` (kept when you uninstall; the same place the earlier Electron version used, so an update keeps your list). |

The program needs Microsoft Edge WebView2. If a PC does not have it, the first start downloads and installs it by itself (the installer does the same), then goes on.

Settings > Data: save a copy, restore from a copy, open the folder.
Settings > Import from the old Cheque Printer reads the old `cheque_writer.db` (accounts, calibration, layouts, cheques with their cleared / voided status, payees). The old file is never changed.

## Builds (GitHub Actions, started by hand)

| Workflow | Result |
|---|---|
| `portable-windows.yml` | Tests, then the single **SJMR_Cheque_Writer_Portable_x.y.z.exe** (no extraction, no extra files); starts the packaged program and checks the screen and the data folder beside it. |
| `installer-windows.yml` | Tests, then **SJMR_Cheque_Writer_Setup_x.y.z.exe**; installs silently, starts the installed program, checks the printing helper, uninstalls (data stays). |

Both also compile the Windows printing helper in Windows PowerShell as a check.

## Development

```
npm install
npm run typecheck
npm test            # data, print flow, alerts, importer, engine vs the original Python engine, real window in Chromium
npm run tauri dev   # needs Rust (https://rustup.rs) and the Tauri prerequisites
npm run dist:portable   # single exe: src-tauri/target/release/sjmr-cheque-writer.exe
```

Folders: `core/` (app core in JavaScript: data file, print flow, alerts, importer; runs inside the window), `src-tauri/` (the small Rust shell: SQLite, Windows printing helper, dialogs, tray, start-up), `shared/` (printing engine, rules, 42 layouts,
Windows print helpers), `src/` (the window), `tests/`.

`shared/cheque-core.mjs` and `shared/direct/*` are the same files as in SJMR Accounting (`desktop/cheque-core.mjs`,
`desktop/cheque-engine/`). `tests/engine-golden.test.mjs` proves the output equals the original Python engine (140 saved cases).

Windows printing (tray, orientation, print dialog) goes through `shared/direct/cheque-direct.ps1`, which compiles
`ChequeDirectPrinter.cs` inside Windows PowerShell: there is no second program to install.

## Code signing

Free code signing provided by [SignPath.io](https://signpath.io), certificate by [SignPath Foundation](https://signpath.org).
See the [code signing policy](CODE-SIGNING.md). The program is open source under the [MIT license](LICENSE).
