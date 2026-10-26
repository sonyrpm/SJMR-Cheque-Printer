# Windows printing for the Template Printer tab. ASCII only; Windows PowerShell 5.1.
# Compiles TemplatePrinter.cs (shipped as source beside this file) inside PowerShell. Lists the printers with
# their paper sizes, or prints one job file; changes nothing else.
param(
  [Parameter(Mandatory = $true)][ValidateSet('list', 'print')][string]$Action,
  [string]$Job = ''
)
$ErrorActionPreference = 'Stop'
try {
  $source = Join-Path $PSScriptRoot 'TemplatePrinter.cs'
  if (-not (Test-Path -LiteralPath $source)) { throw 'TemplatePrinter.cs not found.' }
  Add-Type -Path $source -ReferencedAssemblies 'System.Drawing', 'System.Windows.Forms', 'System.Web.Extensions'
  if ($Action -eq 'list') {
    $code = [SJMRChequeWriter.TemplatePrinter]::Main(@('--list-printers'))
  } else {
    if (-not $Job -or -not (Test-Path -LiteralPath $Job)) { throw 'Print job file not found.' }
    $code = [SJMRChequeWriter.TemplatePrinter]::Main(@('--print', $Job))
  }
  exit $code
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 2
}
