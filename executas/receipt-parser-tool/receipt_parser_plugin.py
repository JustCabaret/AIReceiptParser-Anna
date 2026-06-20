#!/usr/bin/env python3
import json
import sys
import traceback
import os

# Import the core engine logic
import receipt_parser_core

MANIFEST = {
    "name": "receipt-parser",
    "display_name": "Receipt Parser Tool",
    "version": "0.2.0",
    "description": "Local OCR, SQLite database, validation, and analytics exports for the Receipt Expense Copilot.",
    "tools": [
        {
            "name": "health",
            "description": "Checks the status of local dependencies (Python, Tesseract, OpenCV, Database).",
            "parameters": []
        },
        {
            "name": "parse_receipt_image",
            "description": "Extracts text from a receipt image URL using local OCR.",
            "parameters": [
                {"name": "image_url", "type": "string", "description": "The URL of the receipt image (R2 transient or public link)", "required": True},
                {"name": "mock_mode", "type": "boolean", "description": "If true, bypasses OCR and returns mock text.", "required": False}
            ]
        },
        {
            "name": "parse_receipt_text",
            "description": "Simulates receipt parsing on raw OCR text.",
            "parameters": [
                {"name": "text", "type": "string", "description": "Raw OCR text to parse", "required": True}
            ]
        },
        {
            "name": "save_receipt",
            "description": "Persists structured receipt JSON to the SQLite database.",
            "parameters": [
                {"name": "receipt", "type": "object", "description": "Structured receipt JSON object containing merchant, date, total, items, tip, discount, warnings", "required": True}
            ]
        },
        {
            "name": "list_receipts",
            "description": "Lists all saved receipts from the database, supporting optional filters.",
            "parameters": [
                {"name": "date_from", "type": "string", "description": "Filter receipts on or after date (YYYY-MM-DD)", "required": False},
                {"name": "date_to", "type": "string", "description": "Filter receipts on or before date (YYYY-MM-DD)", "required": False},
                {"name": "category", "type": "string", "description": "Filter receipts by category name", "required": False},
                {"name": "merchant", "type": "string", "description": "Filter receipts by merchant name pattern", "required": False}
            ]
        },
        {
            "name": "get_receipt_details",
            "description": "Retrieves the items and details of a specific receipt.",
            "parameters": [
                {"name": "receipt_id", "type": "integer", "description": "The SQLite ID of the receipt", "required": True}
            ]
        },
        {
            "name": "delete_receipt",
            "description": "Deletes a receipt and its items from SQLite.",
            "parameters": [
                {"name": "receipt_id", "type": "integer", "description": "The SQLite ID of the receipt", "required": True}
            ]
        },
        {
            "name": "export_receipts_csv",
            "description": "Generates CSV content for stored receipts.",
            "parameters": [
                {"name": "receipt_id", "type": "integer", "description": "Optional ID to export only one receipt. Omit to export all.", "required": False}
            ]
        },
        {
            "name": "validate_receipt",
            "description": "Validates a receipt's internal details and price consistency.",
            "parameters": [
                {"name": "receipt", "type": "object", "description": "The receipt JSON structure to validate", "required": True}
            ]
        },
        {
            "name": "get_monthly_summary",
            "description": "Gets an analytics summary for a specific month.",
            "parameters": [
                {"name": "year", "type": "integer", "description": "Optional year (YYYY)", "required": False},
                {"name": "month", "type": "integer", "description": "Optional month (1-12)", "required": False}
            ]
        },
        {
            "name": "export_receipts_excel",
            "description": "Generates Excel spreadsheet in Base64 for receipts matching filters.",
            "parameters": [
                {"name": "date_from", "type": "string", "description": "Optional date filter", "required": False},
                {"name": "date_to", "type": "string", "description": "Optional date filter", "required": False},
                {"name": "category", "type": "string", "description": "Optional category filter", "required": False},
                {"name": "merchant", "type": "string", "description": "Optional merchant filter", "required": False},
                {"name": "receipt_ids", "type": "array", "description": "Optional list of integer receipt IDs to restrict the export", "required": False}
            ]
        },
        {
            "name": "export_receipts_pdf",
            "description": "Generates PDF report in Base64 for receipts matching filters.",
            "parameters": [
                {"name": "date_from", "type": "string", "description": "Optional date filter", "required": False},
                {"name": "date_to", "type": "string", "description": "Optional date filter", "required": False},
                {"name": "category", "type": "string", "description": "Optional category filter", "required": False},
                {"name": "merchant", "type": "string", "description": "Optional merchant filter", "required": False},
                {"name": "receipt_ids", "type": "array", "description": "Optional list of integer receipt IDs to restrict the export", "required": False},
                {"name": "mode", "type": "string", "description": "Export mode ('summary' or 'receipt')", "required": False}
            ]
        },
        {
            "name": "seed_demo_data",
            "description": "Seeds the database with a rich set of demo receipts.",
            "parameters": [
                {"name": "reset", "type": "boolean", "description": "If true, resets database by deleting existing demo receipts first.", "required": False}
            ]
        }
    ]
}


def log(msg):
    """Logs a debug message to stderr so it does not interfere with stdout JSON-RPC."""
    print(f"[receipt-parser-plugin] {msg}", file=sys.stderr)
    sys.stderr.flush()


def invoke(tool, args):
    log(f"Invoking tool: {tool} with args: {args}")
    
    if tool == "health":
        db_writable = False
        try:
            receipt_parser_core.init_db()
            db_writable = True
        except Exception as e:
            log(f"Database health check failed: {e}")

        import platform
        python_executable = sys.executable
        python_version = platform.python_version()
        requirements_path = os.path.join(
            os.path.dirname(os.path.abspath(__file__)), "requirements.txt"
        )
        
        tesseract_version = ""
        if receipt_parser_core.tesseract_available and receipt_parser_core.pytesseract:
            try:
                tesseract_version = str(receipt_parser_core.pytesseract.get_tesseract_version()).strip()
            except Exception as tess_ver_err:
                tesseract_version = f"Error: {tess_ver_err}"

        return {
            "success": True,
            "data": {
                "status": "ready",
                "opencv_available": receipt_parser_core.cv2 is not None,
                "pytesseract_available": receipt_parser_core.tesseract_available,
                "database_path": receipt_parser_core.get_db_path(),
                "database_writable": db_writable,
                
                # New V2 diagnostics
                "python_executable": python_executable,
                "python_version": python_version,
                "requirements_path": requirements_path,
                "openpyxl_available": receipt_parser_core.openpyxl is not None,
                "reportlab_available": receipt_parser_core.reportlab is not None,
                "tesseract_cmd": receipt_parser_core.tesseract_cmd_path,
                "tesseract_available": receipt_parser_core.tesseract_available,
                "tesseract_version": tesseract_version,
                "tesseract_detection_paths_checked": receipt_parser_core.tesseract_paths_checked
            }
        }

    elif tool == "parse_receipt_image":
        image_url = args.get("image_url")
        mock_mode = args.get("mock_mode", False)

        if not image_url:
            return {
                "success": False,
                "error": {
                    "code": "MISSING_PARAMETER",
                    "message": "Missing image_url parameter.",
                    "details": ""
                }
            }

        if mock_mode:
            log("Mock Mode enabled. Returning deterministic mock OCR text.")
            mock_text = (
                "MOCK SCAN - DEMO RECEIPT\n"
                "Store: Mock Supermarket\n"
                "Address: 123 Mock Street, Lisbon\n"
                "Date: 2026-06-15 14:30\n"
                "-----------------------------------\n"
                "Simulated Milk       1x   1.25   1.25  [Groceries]\n"
                "Simulated Bread      2x   1.25   2.50  [Groceries]\n"
                "Test Keyboard        1x  39.25  39.25  [Electronics]\n"
                "-----------------------------------\n"
                "Subtotal: €43.00\n"
                "Tax (23%): €2.50\n"
                "Total: €45.50\n"
                "Payment Method: Card\n"
                "Thank you for shopping!"
            )
            return {
                "success": True,
                "data": {
                    "success": True,
                    "ocr_text": mock_text,
                    "mock_used": True
                }
            }

        log(f"Downloading image from URL: {image_url}")
        temp_path = None
        try:
            temp_path = receipt_parser_core.download_file(image_url)
            log(f"Image downloaded to: {temp_path}. Running OCR...")
            ocr_text = receipt_parser_core.run_ocr(temp_path)
            log("OCR completed successfully.")
            return {
                "success": True,
                "data": {
                    "success": True,
                    "ocr_text": ocr_text,
                    "mock_used": False
                }
            }
        except Exception as e:
            log(f"OCR execution failed: {traceback.format_exc()}")
            return {
                "success": False,
                "error": {
                    "code": "OCR_EXECUTION_FAILED",
                    "message": f"OCR failed: {str(e)}",
                    "details": traceback.format_exc()
                }
            }
        finally:
            if temp_path and os.path.exists(temp_path):
                try:
                    os.remove(temp_path)
                except Exception as clean_err:
                    log(f"Failed to remove temp file {temp_path}: {clean_err}")

    elif tool == "parse_receipt_text":
        log("Simulating receipt parse on raw text.")
        return {
            "success": True,
            "data": {
                "success": True,
                "merchant": {
                    "name": "Mock Supermarket",
                    "address": "123 Mock Street",
                    "tax_id": ""
                },
                "date": "2026-06-15",
                "time": "14:30",
                "currency": "EUR",
                "subtotal": 4300,
                "tax": 250,
                "total": 4550,
                "payment_method": "Card",
                "items": [
                    {"name": "Simulated Milk", "quantity": 1, "unit_price": 125, "total_price": 125, "category": "Groceries"},
                    {"name": "Simulated Bread", "quantity": 2, "unit_price": 125, "total_price": 250, "category": "Groceries"},
                    {"name": "Test Keyboard", "quantity": 1, "unit_price": 3925, "total_price": 3925, "category": "Electronics"}
                ],
                "expense_category": "Groceries",
                "confidence": 95,
                "warnings": []
            }
        }

    elif tool == "save_receipt":
        receipt_data = args.get("receipt")
        if not receipt_data:
            return {
                "success": False,
                "error": {
                    "code": "MISSING_PARAMETER",
                    "message": "Missing receipt parameter.",
                    "details": ""
                }
            }

        try:
            if isinstance(receipt_data, str):
                receipt_data = json.loads(receipt_data)

            receipt_id = receipt_parser_core.insert_receipt(receipt_data)
            log(f"Receipt saved to SQLite with ID: {receipt_id}")
            return {
                "success": True,
                "data": {
                    "success": True,
                    "receipt_id": receipt_id
                }
            }
        except Exception as e:
            log(f"Failed to save receipt to SQLite: {traceback.format_exc()}")
            return {
                "success": False,
                "error": {
                    "code": "DB_SAVE_FAILED",
                    "message": f"Failed to save receipt: {str(e)}",
                    "details": traceback.format_exc()
                }
            }

    elif tool == "list_receipts":
        try:
            filters = {
                "date_from": args.get("date_from"),
                "date_to": args.get("date_to"),
                "category": args.get("category"),
                "merchant": args.get("merchant")
            }
            filters = {k: v for k, v in filters.items() if v is not None and v != ""}
            receipts = receipt_parser_core.fetch_all_receipts(filters if filters else None)
            log(f"Loaded {len(receipts)} receipts from SQLite (filters: {filters}).")
            return {
                "success": True,
                "data": {
                    "success": True,
                    "receipts": receipts
                }
            }
        except Exception as e:
            log(f"Failed to load receipts list: {traceback.format_exc()}")
            return {
                "success": False,
                "error": {
                    "code": "DB_LIST_FAILED",
                    "message": f"Failed to list receipts: {str(e)}",
                    "details": traceback.format_exc()
                }
            }

    elif tool == "get_receipt_details":
        receipt_id = args.get("receipt_id")
        if receipt_id is None:
            return {
                "success": False,
                "error": {
                    "code": "MISSING_PARAMETER",
                    "message": "Missing receipt_id parameter.",
                    "details": ""
                }
            }

        try:
            details = receipt_parser_core.fetch_receipt_details(int(receipt_id))
            if not details:
                return {
                    "success": False,
                    "error": {
                        "code": "RECEIPT_NOT_FOUND",
                        "message": f"Receipt with ID {receipt_id} not found.",
                        "details": ""
                    }
                }
            log(f"Details fetched for receipt ID: {receipt_id}")
            return {
                "success": True,
                "data": {
                    "success": True,
                    "receipt": details
                }
            }
        except Exception as e:
            log(f"Failed to fetch details: {traceback.format_exc()}")
            return {
                "success": False,
                "error": {
                    "code": "DB_GET_FAILED",
                    "message": f"Failed to get receipt details: {str(e)}",
                    "details": traceback.format_exc()
                }
            }

    elif tool == "delete_receipt":
        receipt_id = args.get("receipt_id")
        if receipt_id is None:
            return {
                "success": False,
                "error": {
                    "code": "MISSING_PARAMETER",
                    "message": "Missing receipt_id parameter.",
                    "details": ""
                }
            }

        try:
            success = receipt_parser_core.delete_receipt(int(receipt_id))
            log(f"Receipt {receipt_id} deletion status: {success}")
            return {
                "success": True,
                "data": {
                    "success": success
                }
            }
        except Exception as e:
            log(f"Failed to delete receipt: {traceback.format_exc()}")
            return {
                "success": False,
                "error": {
                    "code": "DB_DELETE_FAILED",
                    "message": f"Failed to delete receipt: {str(e)}",
                    "details": traceback.format_exc()
                }
            }

    elif tool == "export_receipts_csv":
        receipt_id = args.get("receipt_id")
        try:
            csv_lines = ["Receipt_ID,Store,Product,Quantity,Price_Cents,Category"]
            
            if receipt_id is not None:
                details = receipt_parser_core.fetch_receipt_details(int(receipt_id))
                if details:
                    for item in details.get("items", []):
                        csv_lines.append(f"{details['id']},{details['store']},{item['name']},{item['quantity']},{item['unit_price']},{item['category']}")
            else:
                receipts = receipt_parser_core.fetch_all_receipts()
                for r in receipts:
                    details = receipt_parser_core.fetch_receipt_details(r["id"])
                    if details:
                        for item in details.get("items", []):
                            csv_lines.append(f"{r['id']},{r['store']},{item['name']},{item['quantity']},{item['unit_price']},{item['category']}")

            import base64
            import datetime
            csv_content = "\n".join(csv_lines)
            content_bytes = csv_content.encode("utf-8")
            content_b64 = base64.b64encode(content_bytes).decode("utf-8")
            
            filename = f"receipts_export_{datetime.datetime.now().strftime('%Y%m%d%H%M%S')}.csv"
            if receipt_id is not None:
                filename = f"receipt_{receipt_id}_export.csv"

            log("CSV content generated and encoded to Base64.")
            return {
                "success": True,
                "data": {
                    "success": True,
                    "content_b64": content_b64,
                    "filename": filename,
                    "mime_type": "text/csv"
                }
            }
        except Exception as e:
            log(f"Failed to generate CSV: {traceback.format_exc()}")
            return {
                "success": False,
                "error": {
                    "code": "CSV_EXPORT_FAILED",
                    "message": f"Failed to export CSV: {str(e)}",
                    "details": traceback.format_exc()
                }
            }

    elif tool == "validate_receipt":
        receipt_data = args.get("receipt")
        if not receipt_data:
            return {
                "success": False,
                "error": {
                    "code": "MISSING_PARAMETER",
                    "message": "Missing receipt parameter.",
                    "details": ""
                }
            }
        try:
            if isinstance(receipt_data, str):
                receipt_data = json.loads(receipt_data)
            res = receipt_parser_core.validate_receipt(receipt_data)
            return {
                "success": True,
                "data": res
            }
        except Exception as e:
            log(f"Validation failed: {traceback.format_exc()}")
            return {
                "success": False,
                "error": {
                    "code": "VALIDATION_FAILED",
                    "message": f"Validation failed: {str(e)}",
                    "details": traceback.format_exc()
                }
            }

    elif tool == "get_monthly_summary":
        year = args.get("year")
        month = args.get("month")
        try:
            res = receipt_parser_core.get_monthly_summary(year, month)
            return {
                "success": True,
                "data": res
            }
        except Exception as e:
            log(f"Failed to get monthly summary: {traceback.format_exc()}")
            return {
                "success": False,
                "error": {
                    "code": "SUMMARY_FAILED",
                    "message": f"Failed to get monthly summary: {str(e)}",
                    "details": traceback.format_exc()
                }
            }

    elif tool == "export_receipts_excel":
        try:
            filters = {
                "date_from": args.get("date_from"),
                "date_to": args.get("date_to"),
                "category": args.get("category"),
                "merchant": args.get("merchant"),
                "receipt_ids": args.get("receipt_ids")
            }
            filters = {k: v for k, v in filters.items() if v is not None and v != ""}
            res = receipt_parser_core.export_receipts_excel(filters if filters else None)
            return {
                "success": True,
                "data": res
            }
        except Exception as e:
            log(f"Failed to export Excel: {traceback.format_exc()}")
            return {
                "success": False,
                "error": {
                    "code": "EXCEL_EXPORT_FAILED",
                    "message": f"Failed to export Excel: {str(e)}",
                    "details": traceback.format_exc()
                }
            }

    elif tool == "export_receipts_pdf":
        try:
            filters = {
                "date_from": args.get("date_from"),
                "date_to": args.get("date_to"),
                "category": args.get("category"),
                "merchant": args.get("merchant"),
                "receipt_ids": args.get("receipt_ids"),
                "mode": args.get("mode")
            }
            filters = {k: v for k, v in filters.items() if v is not None and v != ""}
            res = receipt_parser_core.export_receipts_pdf(filters if filters else None)
            return {
                "success": True,
                "data": res
            }
        except Exception as e:
            log(f"Failed to export PDF: {traceback.format_exc()}")
            return {
                "success": False,
                "error": {
                    "code": "PDF_EXPORT_FAILED",
                    "message": f"Failed to export PDF: {str(e)}",
                    "details": traceback.format_exc()
                }
            }

    elif tool == "seed_demo_data":
        try:
            reset_flag = args.get("reset", False)
            res = receipt_parser_core.seed_demo_data(reset=reset_flag)
            return {
                "success": True,
                "data": res
            }
        except Exception as e:
            log(f"Failed to seed demo data: {traceback.format_exc()}")
            return {
                "success": False,
                "error": {
                    "code": "SEED_FAILED",
                    "message": f"Failed to seed: {str(e)}",
                    "details": traceback.format_exc()
                }
            }

    raise ValueError(f"Unknown tool: {tool}")


def handle(req):
    method = req.get("method")
    if method == "describe":
        return {"result": MANIFEST}
    
    elif method == "invoke":
        params = req.get("params") or {}
        tool = params.get("tool", "")
        arguments = params.get("arguments") or {}
        try:
            res = invoke(tool, arguments)
            return {"result": res}
        except Exception as exc:
            log(f"Unhandled exception during invoke: {traceback.format_exc()}")
            return {
                "result": {
                    "success": False,
                    "error": {
                        "code": "UNHANDLED_EXCEPTION",
                        "message": str(exc),
                        "details": traceback.format_exc()
                    }
                }
            }
            
    elif method == "health":
        return {"result": {"status": "ready"}}
        
    return {"error": {"code": -32601, "message": f"Unknown method: {method}"}}


def main():
    log("Plugin process started. Waiting for stdio JSON-RPC requests.")
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError as exc:
            payload = {"error": {"code": -32700, "message": str(exc)}}
            req_id = None
        else:
            payload = handle(req)
            req_id = req.get("id")
            
        sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": req_id, **payload}) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    # Ensure current directory is on path to find core engine imports
    sys.path.append(os.path.dirname(os.path.abspath(__file__)))
    main()
