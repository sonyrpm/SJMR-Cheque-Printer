# Windows printing for the SJMR cheque writer. ASCII only; Windows PowerShell 5.1.
# Compiles ChequeDirectPrinter.cs (shipped as source beside this file) inside PowerShell, so no
# separate program has to be installed. Reads the printers or prints one job file; changes nothing else.
param(
  [Parameter(Mandatory = $true)][ValidateSet('list', 'print')][string]$Action,
  [string]$Job = ''
)
$ErrorActionPreference = 'Stop'
try {
  $source = Join-Path $PSScriptRoot 'ChequeDirectPrinter.cs'
  if (-not (Test-Path -LiteralPath $source)) { throw 'ChequeDirectPrinter.cs not found.' }
  Add-Type -Path $source -ReferencedAssemblies 'System.Drawing', 'System.Windows.Forms', 'System.Web.Extensions'
  if ($Action -eq 'list') {
    $code = [SJMRChequeWriter.ChequeDirectPrinter]::Main(@('--list-printers'))
  } else {
    if (-not $Job -or -not (Test-Path -LiteralPath $Job)) { throw 'Print job file not found.' }
    $code = [SJMRChequeWriter.ChequeDirectPrinter]::Main(@('--print', $Job))
  }
  exit $code
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 2
}
