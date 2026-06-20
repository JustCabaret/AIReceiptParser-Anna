# Hackathon Submission: Receipt Expense Copilot V2

## 1. What was built
**Receipt Expense Copilot** is an Anna-native app designed to automate the process of scanning and organizing paper receipt expenses. V2 enhances this pipeline by adding automated monthly spend analytics, custom inline history filters, consistency validation warnings, sequential batch uploads, and advanced Excel and PDF exports. The latest version introduces an interactive receipt photo viewer (with Zoom In/Out, Reset, and click-and-drag panning), a multi-select batch deletion system with inline confirmation, and the ability to edit and update saved receipt details directly from the validation panel. It provides a visual dashboard to drag-and-drop receipt image scans, reviews extracted text, edits fields side-by-side using human-in-the-loop validation, and persists the curated data to a local SQLite database.

## 2. Who it is for
It is tailored for freelancers, contractors, small business owners, and employees who regularly collect paper receipts and need to compile structured expense reports without manual typing. By running locally and using the host's native services, it guarantees privacy-first storage for sensitive financial transactions.

## 3. How AI is used
The application employs AI in two stages:
1. **Local OCR Text Extraction:** Preprocesses receipt photos locally using OpenCV filters and converts them to text via Tesseract OCR in the Executa plugin.
2. **Stateless Field Structuring:** Passes raw OCR text to the host LLM (`anna.llm.complete`) with strict constraints to normalize unstructured dates, merchant names, quantities, and currency units into a clean JSON invoice schema.

## 4. How it connects to Anna
Receipt Expense Copilot runs entirely inside the Anna ecosystem:
- **Anna App UI (schema: 2):** Runs a static SPA dashboard bundle in a sandboxed iframe using the `AnnaAppRuntime` SDK.
- **Executa (Python stdio JSON-RPC):** Runs a local background Python process for Tesseract OCR, OpenCV filters, SQLite database migrations, Excel generation (`openpyxl`), and PDF rendering (`reportlab`).
- **Host APIs Used:**
  - `anna.upload.inline`: Persists receipt files locally to R2 without hardcoding AWS keys.
  - `anna.llm.complete`: Invokes stateless LLM completions dynamically with the user's default model and quota.
  - `anna.tools.invoke`: Directly calls Executa database, validation, analytics, and OCR methods.
  - `anna.storage`: Manages user configurations and UI session state.
- **Skill (receipt-copilot-coach):** Extends Anna's general assistant model so the user can interactively query their expense database ("How much did I spend yesterday?") straight from the chat panel.
