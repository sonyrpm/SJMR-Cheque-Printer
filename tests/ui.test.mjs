import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { startHarness } from "./helpers/ui-harness.mjs";

test("window: first account, write, print with and without 'Add cheque to list', list, status, alerts", async (t) => {
  const h = await startHarness();
  t.after(() => h.close());
  const { page } = h;
  await h.open();
  await page.getByText("Welcome to SJMR Cheque Writer").waitFor();
  // The top banner carries the branding in normal-size text.
  const branding = page.getByLabel("Branding");
  assert.match(await branding.innerText(), /Powered by sonyrpm\s+www\.sjmrsoft\.com · info@sjmrsoft\.com/);
  const size = await branding.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  assert.ok(size >= 13, "normal size, not small print");
  await h.shot("01-no-account");

  // Banks & Layouts: add the first account through the screen.
  await page.getByRole("tab", { name: "Banks & Layouts" }).click();
  await page.getByRole("button", { name: "Add bank account" }).click();
  await page.getByLabel("Account name").fill("ADCB Main");
  await page.getByLabel("Account number").fill("AE07 0330 1111");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByText("Bank account saved.").waitFor();
  await h.shot("02-banks");

  // Write & Print.
  await page.getByRole("tab", { name: "Write & Print" }).click();
  await page.getByAltText("Cheque PDF preview").waitFor();
  await page.getByLabel(/Show advanced options/).check();
  await page.getByLabel("Cheque amount").fill("1250.50");
  const addBox = page.getByLabel("Add cheque to list");
  assert.equal(await addBox.isChecked(), true, "ticked by default");
  // Payee required.
  await page.getByRole("button", { name: "Print cheque" }).click();
  await page.getByText("Enter a payee, cheque number and positive amount.").waitFor();
  await page.getByPlaceholder("Type a name or pick from the payee list").fill("al noor trading");
  await page.getByLabel("Amount in words").waitFor();
  await page.waitForFunction(() => /Thousand/.test(document.querySelector('textarea[aria-label="Amount in words"]').value));
  await page.waitForTimeout(700);
  await h.shot("03-write");
  await page.getByRole("button", { name: "Print cheque" }).click();
  await page.getByText(/Cheque sent to the printer\. Added to the cheque list/).waitFor();
  assert.equal(h.sent.length, 1);
  assert.equal((await h.store.cheques()).length, 1);
  assert.equal((await h.store.cheques())[0].payee, "AL NOOR TRADING");
  assert.equal(await page.getByLabel("Cheque number").inputValue(), "000002", "number counts up after a listed cheque");
  assert.deepEqual(await h.store.payees(), ["AL NOOR TRADING"], "payee remembered");

  // The form is ready for the next cheque: payee and amount are empty, the cursor is in the payee box.
  assert.equal(await page.getByPlaceholder("Type a name or pick from the payee list").inputValue(), "");
  assert.equal(await page.getByLabel("Cheque amount").inputValue(), "");
  await page.waitForFunction(() => document.activeElement?.getAttribute("placeholder")?.startsWith("Type a name"));
  await page.getByPlaceholder("Type a name or pick from the payee list").fill("al noor trading");
  await page.getByLabel("Cheque amount").fill("1250.50");
  await page.waitForTimeout(700);

  // Unticked: only printed.
  await addBox.uncheck();
  await page.getByText("Print only: this cheque is not added to the Cheque List.").waitFor();
  await page.getByRole("button", { name: "Print cheque" }).click();
  await page.getByText("Cheque sent to the printer.", { exact: true }).waitFor();
  assert.equal(h.sent.length, 2);
  assert.equal((await h.store.cheques()).length, 1, "nothing added");
  assert.equal(await page.getByLabel("Cheque number").inputValue(), "000002", "number not counted up when not listed");

  // Cheque list.
  await page.getByRole("tab", { name: "Cheque List" }).click();
  await page.getByRole("cell", { name: "AL NOOR TRADING" }).waitFor();
  const row = page.getByRole("row", { name: /000001/ });
  assert.match(await row.innerText(), /pending/i);
  await row.getByRole("button", { name: "Returned" }).click();
  await page.getByRole("button", { name: "Mark returned", exact: true }).click();
  await page.getByText("Enter the reason the cheque was returned.").waitFor();
  await page.getByLabel("Reason").fill("Insufficient funds");
  await page.getByRole("button", { name: "Mark returned", exact: true }).click();
  await page.getByText("1 cheque marked returned.").waitFor();
  assert.equal((await h.store.cheques())[0].status, "returned");
  await page.getByRole("row", { name: /000001/ }).getByRole("button", { name: "Reopen" }).click();
  await page.getByRole("contentinfo").getByRole("button", { name: "Reopen" }).click();
  await page.getByText("1 cheque marked pending.").waitFor();
  await page.getByRole("row", { name: /000001/ }).getByRole("button", { name: "Cleared" }).click();
  await page.getByRole("button", { name: "Mark cleared", exact: true }).click();
  await page.getByText("1 cheque marked cleared.").waitFor();
  await page.getByRole("button", { name: /^Cleared \d/ }).click();
  assert.match(await page.getByRole("row", { name: /000001/ }).innerText(), /cleared/i);
  await h.shot("04-list");

  // Alerts: a cheque dated in two days raises the banner and the tab badge.
  await h.store.addCheque({ accountId: (await h.store.accounts())[0].id, chequeNo: "000050", payee: "COMING CO", amount: "10.00", currency: "AED", chequeDate: "2026-11-03", issuedOn: "2026-11-01", layoutId: "", wording: "", crossing: 1 });
  await page.getByRole("tab", { name: "Write & Print" }).click();
  await page.getByRole("tab", { name: "Cheque List" }).waitFor();
  await page.getByRole("status").getByText("1 coming soon").waitFor();
  assert.match(await page.getByRole("tab", { name: /Cheque List/ }).innerText(), /1/);
  await page.getByRole("status").getByRole("button", { name: "View" }).click();
  await page.getByRole("cell", { name: "COMING CO" }).waitFor();
  assert.equal(await page.getByRole("row", { name: /000001/ }).count(), 0, "attention view hides the cleared cheque");
  await h.shot("05-attention");
  assert.deepEqual(h.errors, []);
});

test("window: bank layouts, payees, settings and import of the old register", async (t) => {
  const old = path.join(import.meta.dirname, "fixtures", "old-register.db");
  const h = await startHarness({ chosenFile: old });
  t.after(() => h.close());
  const { page } = h;
  await h.store.saveAccount({ name: "FAB Current" });
  await h.open();
  await page.getByRole("tab", { name: "Banks & Layouts" }).click();
  await page.getByRole("cell", { name: "FAB Current" }).waitFor();
  await page.getByText("Bank layout library · 42 layouts").waitFor();
  assert.equal(await page.getByLabel("Edit layout field").count(), 0, "field positions are hidden by default");
  assert.equal(await page.getByLabel("Import bank layouts JSON").count(), 0, "import is hidden by default");
  assert.equal(await page.getByRole("button", { name: "Export all" }).count(), 0, "export is hidden by default");
  assert.equal(await page.getByRole("button", { name: /advanced/i }).count(), 0, "no visible advanced button");
  await page.getByRole("button", { name: "Create new layout" }).click();
  await page.getByLabel("Bank / layout name").fill("My Test Bank");
  await page.getByRole("button", { name: "Save new layout" }).click();
  await page.getByText("Bank layout saved.").waitFor();
  await page.getByText("Bank layout library · 43 layouts").waitFor();
  await page.keyboard.press("Control+Shift+D");
  await page.getByLabel("Edit layout field").waitFor();
  await page.getByLabel("Import bank layouts JSON").waitFor();
  const fieldList = page.getByLabel("Edit layout field");
  const labels = await fieldList.locator("option").allInnerTexts();
  for (const plain of ["Payee name", "Date: day, digit 1", "Date: month, digit 2", "Date: year, digit 4", "Amount in figures", "Amount in words, line 1", "Bank name", "Crossing line 1", "\"Or bearer\" cancel mark"])
    assert.ok(labels.includes(plain), `${plain} is in the field list`);
  assert.ok(labels.every((l) => !/^(mm|ln)[A-Z]/.test(l)), "no internal key is shown: " + labels.join(", "));
  await fieldList.selectOption({ label: "Amount in figures" });
  assert.equal(await page.getByLabel("Field width (mm)").inputValue() !== "", true);
  await h.shot("06a-banks-advanced");
  await page.keyboard.press("Control+Shift+D");
  assert.equal(await page.getByLabel("Edit layout field").count(), 0);
  await h.shot("06-banks-layouts");

  await page.getByRole("tab", { name: "Payees" }).click();
  await page.getByLabel("New payee").fill("Gulf Supplies LLC");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("cell", { name: "Gulf Supplies LLC" }).waitFor();
  await page.getByLabel("Import payee file").setInputFiles({ name: "p.csv", mimeType: "text/csv", buffer: Buffer.from("Payee Name\r\nAlpha Co\r\nGulf Supplies LLC\r\n") });
  await page.getByText("1 new payee name(s) added; 1 were already in the list.").waitFor();
  assert.deepEqual(await h.store.payees(), ["Alpha Co", "Gulf Supplies LLC"]);
  await h.shot("07-payees");

  await page.getByRole("tab", { name: "Settings" }).click();
  await page.getByLabel("Days before").fill("7");
  await page.getByRole("button", { name: "Save alert settings" }).click();
  await page.getByText("Alert settings saved.").waitFor();
  assert.equal((await h.store.alerts()).daysAhead, 7);
  await page.getByLabel("Days before").fill("-1");
  await page.getByRole("button", { name: "Save alert settings" }).click();
  await page.getByText(/whole number from 0 to 60/).waitFor();
  await page.getByRole("button", { name: "Choose old file…" }).click();
  await page.getByText(/Imported 2 bank account\(s\) \(1 already here\)/).waitFor();
  assert.equal((await h.store.cheques()).length, 5);
  await h.shot("08-settings");
  assert.deepEqual(h.errors, []);
});

test("window: payee box lists every payee on focus, narrows while typing and keeps typed text", async (t) => {
  const h = await startHarness();
  t.after(() => h.close());
  const { page } = h;
  await h.store.saveAccount({ name: "ADCB Main" });
  await h.store.importPayees(["Alpha Co", "Gulf Supplies LLC", "Gulf Traders"]);
  await h.open();
  await page.getByAltText("Cheque PDF preview").waitFor();
  const box = page.getByPlaceholder("Type a name or pick from the payee list");
  await box.fill("Alpha Co");
  await box.press("Escape");
  await page.getByLabel("Cheque amount").focus();
  await box.focus();
  await page.waitForTimeout(150);
  assert.equal(await page.locator("[data-search-menu] [role=option]").count(), 3, "all payees shown although the box holds a name");
  // The list must really be visible, under the box, with readable rows (not just present in the page).
  const menu = page.locator("[data-search-menu]");
  await menu.waitFor({ state: "visible" });
  const field = await box.boundingBox();
  const shown = await menu.boundingBox();
  assert.ok(shown.y >= field.y + field.height - 2 && shown.y < field.y + field.height + 40, "the list opens right under the box");
  assert.ok(shown.height > 60 && shown.width > 200, "the list has a real size");
  assert.equal(await page.getByRole("option", { name: "Gulf Traders" }).isVisible(), true);
  await h.shot("10-payee-list");
  await box.fill("gulf");
  await page.waitForTimeout(150);
  assert.equal(await page.locator("[data-search-menu] [role=option]").count(), 2, "narrowed while typing");
  await box.fill("Gulf New Name");
  await box.press("Enter");
  assert.equal(await box.inputValue(), "Gulf New Name", "typed text kept on Enter");
  await box.fill("gulf t");
  await box.press("ArrowDown");
  await box.press("Enter");
  assert.equal(await box.inputValue(), "Gulf Traders");
  assert.deepEqual(h.errors, []);
});

test("window: Template Printer tab - picture, DPI size, paper, PDF, print, remembered settings", async (t) => {
  const h = await startHarness();
  t.after(() => h.close());
  const { page } = h;
  await h.store.saveAccount({ name: "ADCB Main" });
  await h.open();
  await page.getByRole("tab", { name: "Template Printer" }).click();
  await page.getByText("No picture selected").waitFor();
  assert.equal(await page.getByRole("button", { name: "Save PDF" }).isDisabled(), true, "nothing to print before a picture is chosen");
  await page.getByLabel("Choose picture").setInputFiles(path.join(import.meta.dirname, "fixtures", "template", "scan.png"));
  await page.getByText("scan.png · 240 x 120 pixels").waitFor();
  await h.shot("09-template");

  // Size from the scan resolution: 240 x 120 pixels at 300 DPI = 20.32 x 10.16 mm.
  await page.getByLabel("Scan resolution (DPI)").fill("300");
  await page.getByRole("button", { name: "Calculate size from DPI" }).click();
  await page.getByText(/Size set to 20.32 x 10.16 mm/).waitFor();
  await page.waitForFunction(() => document.querySelector('input[aria-label="Image width (mm)"]')?.value === "20.32");
  await page.waitForFunction(() => document.querySelector('input[aria-label="Image height (mm)"]')?.value === "10.16");
  // Pictures are placed with the preset size and many copies fill pages.
  await page.getByRole("button", { name: "Preset: 201.9 x 100.9 mm" }).click();
  await page.getByLabel("Total copies").fill("3");
  await page.getByText("Page 1 / 2").waitFor();
  assert.equal(await page.getByRole("img", { name: "Page preview" }).locator("image").count(), 2, "two pictures on page 1");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByText("Page 2 / 2").waitFor();
  assert.equal(await page.getByRole("img", { name: "Page preview" }).locator("image").count(), 1);
  await page.getByLabel("Cutting border").check();
  await page.getByLabel("Horizontal centre lines").check();

  // A picture that cannot fit is refused with a plain message; nothing is shrunk.
  await page.getByLabel("Image width (mm)").fill("205");
  await page.getByText(/does not fit at this exact size/).first().waitFor();
  assert.equal(await page.getByRole("button", { name: "Print", exact: true }).isDisabled(), true);
  await page.getByLabel("Image width (mm)").fill("201.9");

  // Printer papers come from the printer; a preset paper takes the orientation.
  await page.getByLabel("Paper size").selectOption({ label: "A5 (148 x 210 mm)" });
  await page.getByText(/does not fit at this exact size/).first().waitFor();
  await page.getByLabel("Paper size").selectOption({ label: "Custom" });
  await page.getByLabel("Paper width (mm)").fill("297");
  await page.getByLabel("Paper height (mm)").fill("210");
  await page.getByLabel("Image width (mm)").fill("95");
  await page.getByLabel("Image height (mm)").fill("45");
  await page.getByLabel("Gap between images (mm)").fill("6");
  await page.getByLabel("Total copies").fill("2");
  await page.getByText("Fits 8 per page | 1 page(s) total").waitFor();

  // Save PDF and print.
  await page.getByRole("button", { name: "Save PDF" }).click();
  await page.getByText(/PDF saved: C:\/Docs\/Precision_Print\.pdf/).waitFor();
  assert.deepEqual(h.savedPdfs, ["Precision_Print.pdf"]);
  assert.equal(Buffer.from(h.savedData[0], "base64").subarray(0, 5).toString("latin1"), "%PDF-");
  await page.getByRole("button", { name: "Print", exact: true }).click();
  await page.getByText(/Sent 1 page\(s\) to 'HP LaserJet'/).waitFor();
  const job = JSON.parse(h.sent.at(-1).job);
  assert.equal(h.sent.at(-1).script, "template-print.ps1");
  assert.deepEqual([job.page_w_mm, job.page_h_mm, job.show_dialog, job.border_mm, job.printer_name], [297, 210, false, 0.05, "HP LaserJet"]);
  assert.equal(job.pages[0].rects.length, 2);
  assert.deepEqual([job.pages[0].rects[0].w, job.pages[0].rects[0].h], [95, 45]);
  assert.equal(job.pages[0].lines.length, 0, "one row: no horizontal centre line");
  assert.ok(job.image_base64.length > 100);
  await page.getByRole("button", { name: "Windows Print dialog" }).click();
  await page.getByText(/Sent 1 page\(s\)/).waitFor();
  assert.equal(JSON.parse(h.sent.at(-1).job).show_dialog, true);

  // The sizes are remembered, the picture is not.
  await page.waitForTimeout(1000);
  await page.reload();
  await page.getByRole("tab", { name: "Template Printer" }).click();
  await page.getByText("No picture selected").waitFor();
  await page.waitForFunction(() => document.querySelector('input[aria-label="Image width (mm)"]')?.value === "95");
  assert.equal(await page.getByLabel("Paper size").inputValue(), "Custom");
  assert.equal(await page.getByLabel("Cutting border").isChecked(), true);
  assert.deepEqual(h.errors, []);
});

test("window: Payees tab search narrows the list and clears again", async (t) => {
  const h = await startHarness();
  t.after(() => h.close());
  const { page } = h;
  await h.store.importPayees(["Alpha Co", "Gulf Supplies LLC", "Gulf Traders", "Zeta Trading"]);
  await h.open();
  await page.getByRole("tab", { name: "Payees" }).click();
  await page.getByRole("cell", { name: "Zeta Trading" }).waitFor();
  await page.getByLabel("Search payees").fill("gulf");
  await page.getByRole("cell", { name: "Gulf Traders" }).waitFor();
  assert.equal(await page.getByRole("cell", { name: "Alpha Co" }).count(), 0);
  assert.equal(await page.getByRole("cell", { name: "Zeta Trading" }).count(), 0);
  await page.getByLabel("Search payees").fill("nothing like this");
  await page.getByText("No payee matches.").waitFor();
  await page.getByLabel("Search payees").fill("");
  await page.getByRole("cell", { name: "Zeta Trading" }).waitFor();
  assert.deepEqual(h.errors, []);
});

test("a normal PC cannot switch the developer options on, even with the shortcut", async (t) => {
  const h = await startHarness({ developer: false });
  t.after(() => h.close());
  const { page } = h;
  await h.store.saveAccount({ name: "ADCB Main" });
  await h.open();
  await page.getByRole("tab", { name: "Banks & Layouts" }).click();
  await page.getByText("Bank layout library · 42 layouts").waitFor();
  await page.keyboard.press("Control+Shift+D");
  await page.waitForTimeout(300);
  for (const label of ["Edit layout field", "Import bank layouts JSON", "Layout ID"])
    assert.equal(await page.getByLabel(label).count(), 0, `${label} stays hidden`);
  for (const name of ["Export all", "Export selected"])
    assert.equal(await page.getByRole("button", { name, exact: true }).count(), 0, name);
  assert.deepEqual(h.errors, []);
});
