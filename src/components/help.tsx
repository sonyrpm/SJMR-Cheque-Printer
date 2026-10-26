import { FormDialog, Button } from "@/components/ui";

const TOPICS: [string, string[]][] = [
  ["Write and print a cheque", [
    "Choose the bank account, type the payee and the amount, check the preview and press Print cheque (Ctrl+P). The cheque is added to the Cheque List as Pending and the form is ready for the next one.",
    "Ctrl+N clears the form. The cheque number counts up by itself.",
  ]],
  ["Arabic cheques", [
    "Choose Cheque language: Arabic. Type the payee in Arabic, or type the English name and press Suggest, then check the spelling. The amount in words is written in Arabic.",
    "Arabic names are saved with the payee (Payees tab), so next time they fill in by themselves.",
  ]],
  ["Move the writing (alignment)", [
    "Print a Test print on plain paper, hold it against a real cheque, then drag the writing in the preview: each piece moves on its own (payee, date, amount, words, crossing). Hold Shift to move one date box. Drag an empty place to move everything.",
    "Press Save calibration (under Show advanced options) to remember it for this bank.",
  ]],
  ["Batch printing", ["Paste a list of cheques (payee, amount, date) on the Batch tab and print them one after the other. The list stops at the first problem so no cheque leaf is wasted."]],
  ["Cheque list", [
    "Mark cheques cleared, returned or cancelled. Every change can be undone straight away. Print list gives a report with totals by bank and month; Export opens in Excel.",
    "Details > Reprint prints the same cheque again, for example after a paper jam.",
  ]],
  ["Your data", [
    "The data is kept in one file. A copy is saved by itself once a day (last 7 days). Settings > Save a copy of the data makes a copy anywhere you choose.",
  ]],
  ["Keys", ["Ctrl+P print cheque · Ctrl+N new cheque · Ctrl+1 to Ctrl+7 switch tab · F1 this help."]],
];

export function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <FormDialog title="Help" onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}>
      <div className="space-y-3 text-[13px]">
        {TOPICS.map(([title, lines]) => (
          <section key={title}>
            <h3 className="font-semibold">{title}</h3>
            {lines.map((l) => <p key={l} className="text-muted">{l}</p>)}
          </section>
        ))}
        <p className="text-xs text-muted">Questions: info@sjmrsoft.com · www.sjmrsoft.com</p>
      </div>
    </FormDialog>
  );
}
