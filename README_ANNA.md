# Receipt Expense Copilot — Anna Integration V2

This document outlines the setup, execution, and testing procedures for V2 of the Receipt Expense Copilot Anna App.

## Prerequisites

- **Node.js 22+**
- **Python 3.10+**
- **Tesseract OCR Engine** installed locally (if testing real OCR)
- Python packages (install using standard shell commands if needed):
  ```bash
  pip install -r requirements.txt
  ```

---

## 1. Quick Start (Development Harness)

To start the local development harness, run the following command in the workspace root:

```bash
npx.cmd @anna-ai/cli dev
```

Open the dashboard URL printed in your terminal (typically `http://localhost:5180/`). The App UI will load in a mock dashboard shell.

---

## 2. Validation & Quality Checks

Run the static linter and schema checker to verify manifest correctness:

```bash
npx.cmd @anna-ai/cli validate
```

For strict checking (gating host API declarations against javascript calls):

```bash
npx.cmd @anna-ai/cli validate --strict
```

To run the automated backend suite containing smoke tests for all V1 and V2 methods:

```bash
python executas/receipt-parser-tool/test_plugin.py
```

---

## 3. Testing V2 Features

### A. Sequential Batch Upload
1. Drag and drop multiple receipt photos, or browse and select multiple files.
2. The UI will show a **Batch Upload Queue** panel listing each file.
3. Each file goes through states: `pending` -> `uploading` -> `ocr` -> `ai-parsing` -> `ready`.
4. Once a file reaches `ready`, it loads in the editor. Review the fields and click **Save Receipt**.
5. The queue marks it `saved` and automatically loads the next ready file for review.

### B. Validation Warnings & Tip/Discount Math
1. In the Review Editor, manually edit the fields.
2. Note the new **Tip** and **Discount** optional fields.
3. Total calculations follow the V2 formula: `Subtotal + Tax + Tip - Discount == Total`.
4. If there is a calculation mismatch or missing merchant/date/total, the **Validation Warnings** panel will show the inconsistency codes (e.g. `TOTAL_MISMATCH`, `ITEMS_SUM_MISMATCH`).
5. Critical structural errors will block saving, while normal warnings are saved to SQLite.

### C. Monthly Spend Analytics
1. Open the **Dashboard** view.
2. The V2 widgets show:
   - **Monthly Spend**: Total spent in the current month with a trend comparison vs the previous month (e.g., `↑ €15.00 (+12% vs last month)`).
   - **Monthly Scans**: Count of receipts saved this month.
   - **Top Category & Top Merchant**: Highest cost category and store name.
   - **Category Breakdown**: Progress bars showing percentage expenditure per category.

### D. Scanned History Filters & Advanced Exports
1. Open the **Scanned History** tab.
2. Use the filters: **Date From**, **Date To**, **Category**, and **Merchant**.
3. Click **Apply Filters** to query the SQLite database via parameterized SQL.
4. **Export Buttons**:
   - **Export CSV / Excel / PDF**: Generates Base64 encoded spreadsheets and clean PDFs (flat structured tables, no external CDNs/logos) on the fly.
   - The browser prompts download saving.
5. In receipt **Details** drawer, view detailed Tip, Discount, and Warnings. Individual CSV, Excel, and PDF downloads are also available.

### E. Interactive Receipt Image Viewer
1. Upload a receipt or trigger a batch upload process.
2. Under the editor layout, notice the left column now displays the receipt image scan by default.
3. Test the controls overlay: click **Zoom In (+)**, **Zoom Out (-)**, or **Reset**.
4. Drag and pan the image with your mouse to inspect specific receipt items.
5. Click **View OCR Text** to switch to the raw text view, and click **View Photo** to toggle back.

### F. Scanned History Checkboxes & Batch Deletion
1. Open the **Scanned History** tab.
2. Click individual row checkboxes or click the header checkbox to Select All.
3. Observe the red **Delete Selected** button appearing dynamically next to Export CSV.
4. Click **Delete Selected**; it updates to **Confirm Delete (X)?** (showing the item count).
5. Click it again to execute the deletion. Confirm that the items are removed and dashboard summaries refresh automatically.

### G. Inline Editing of Saved Receipts
1. In the **Scanned History** view, click **Details** on any saved receipt.
2. Inside the drawer, click the **Edit Receipt** button.
3. The drawer closes and the data is loaded back into the editor (restoring original items, dates, totals, and receipt photo preview).
4. Make adjustments, and click **Save Receipt**. The record is updated dynamically in the database.

