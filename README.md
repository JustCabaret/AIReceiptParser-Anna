# Receipt Expense Copilot

Receipt Expense Copilot is an Anna-native app designed to automate the process of scanning and organizing paper receipt expenses. It extracts text from receipt scans using local OCR, parses dates, merchant names, quantities, categories, and currency units using the host LLM, and persists data into a local SQLite database.

## Features

- **Sequential Batch Upload**: Drag-and-drop multiple receipt images. Review and save them one by one with a live upload queue.
- **Local OCR Engine**: Image preprocessing with OpenCV and text extraction using Tesseract OCR.
- **Stateless LLM Parsing**: Leverages the host LLM (`anna.llm.complete`) to securely structure raw OCR text into a clean JSON invoice format.
- **Human-in-the-Loop Review**: A side-by-side editing interface to review and correct receipt fields.
- **Interactive Receipt Image Viewer**: Supports Zoom In/Out, Reset, and click-and-drag panning, with a toggle to switch back to the raw OCR text.
- **Multi-select Batch Deletion**: Select multiple rows in scanned history to delete them at once, with an inline double-click button confirmation.
- **Inline Editing of Saved Receipts**: Edit receipt data directly in the validation panel, updating the SQLite records dynamically.
- **Validation Warnings**: Automatic validation checks for total calculation inconsistencies (`Subtotal + Tax + Tip - Discount == Total`), missing fields, and mismatches.
- **Monthly Analytics & Trends**: Dynamic dashboard widgets showing monthly expenditures, scanner counts, categories breakdown, and month-to-month trends.
- **Advanced Document Export**: Generate and download formatted CSV, Excel spreadsheets (`openpyxl`), and PDFs (`reportlab`) on the fly.
- **Localization**: Native interface localization supporting English and Chinese.

## Tech Stack

- **Frontend**: HTML5, Vanilla CSS (Premium Dark Theme), and Vanilla JavaScript modular ES modules (located in `bundle/`). Runs sandboxed inside the Anna App iframe using the `AnnaAppRuntime` SDK.
- **Backend (Executa)**: Python-based stdio JSON-RPC plugin tool wrapper for sqlite operations, OpenCV/Tesseract OCR, and document exporters (located in `executas/receipt-parser-tool/`).
- **Database**: SQLite (`receipts.db`).

## Getting Started

### Prerequisites

- **Node.js 22+**
- **Python 3.10+**
- **Tesseract OCR Engine** installed locally (if executing real image OCR)

### Running the App

Start the Anna development harness in the project root:

```bash
npx @anna-ai/cli dev
```

Open the dashboard URL printed in your terminal (typically `http://localhost:5180/`). The App UI will load in a mock dashboard shell.

---

## Validation & Quality Checks

Run the static linter and schema checker to verify manifest correctness:

```bash
npx @anna-ai/cli validate
```

For strict checking (gating host API declarations against javascript calls):

```bash
npx @anna-ai/cli validate --strict
```

To run the automated backend suite containing integration and smoke tests:

```bash
python executas/receipt-parser-tool/test_plugin.py
```

To verify Tesseract OCR path auto-detection and processing:

```bash
python executas/receipt-parser-tool/test_ocr_real.py
```
