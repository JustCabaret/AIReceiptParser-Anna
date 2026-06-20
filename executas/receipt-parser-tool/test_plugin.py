import json
import subprocess
import sys
import os

def run_tests():
    plugin_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "receipt_parser_plugin.py")
    print(f"Starting plugin subprocess: {plugin_path}")
    
    # Run the plugin process
    process = subprocess.Popen(
        [sys.executable, plugin_path],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1
    )

    def send_request(req):
        req_line = json.dumps(req)
        print(f"\n[TEST -> PLUGIN] {req_line}")
        process.stdin.write(req_line + "\n")
        process.stdin.flush()
        
        # Read response line
        res_line = process.stdout.readline().strip()
        print(f"[TEST <- PLUGIN] {res_line}")
        
        return json.loads(res_line)

    try:
        # 1. Test describe
        res = send_request({
            "jsonrpc": "2.0",
            "method": "describe",
            "id": 1
        })
        assert "result" in res, "Missing 'result' key in describe response"
        assert "tools" in res["result"], "Missing 'tools' in describe result"
        print("[OK] Describe test passed.")

        # 2. Test health (using invoke)
        res = send_request({
            "jsonrpc": "2.0",
            "method": "invoke",
            "id": 2,
            "params": {
                "tool": "health",
                "arguments": {}
            }
        })
        assert "result" in res, "Missing 'result' key in invoke response"
        assert res["result"].get("success") is True, "Invoke health was not successful"
        assert "data" in res["result"], "Missing 'data' in invoke result"
        print("[OK] Health test passed.")

        # 3. Test list_receipts
        res = send_request({
            "jsonrpc": "2.0",
            "method": "invoke",
            "id": 3,
            "params": {
                "tool": "list_receipts",
                "arguments": {}
            }
        })
        assert "result" in res, "Missing 'result' key in list_receipts response"
        assert res["result"].get("success") is True, "Invoke list_receipts failed"
        receipts = res["result"]["data"]["receipts"]
        print(f"[OK] List receipts test passed. Found {len(receipts)} receipts.")

        # 4. Test save_receipt
        mock_receipt = {
            "merchant": {"name": "Mock Supermarket"},
            "date": "2026-06-15",
            "time": "14:30",
            "currency": "EUR",
            "subtotal": 4300,
            "tax": 250,
            "total": 4550,
            "expense_category": "Groceries",
            "items": [
                {"name": "Simulated Milk", "quantity": 1, "unit_price": 125, "total_price": 125, "category": "Groceries"},
                {"name": "Simulated Bread", "quantity": 2, "unit_price": 125, "total_price": 250, "category": "Groceries"},
                {"name": "Test Keyboard", "quantity": 1, "unit_price": 3925, "total_price": 3925, "category": "Groceries"}
            ]
        }
        res = send_request({
            "jsonrpc": "2.0",
            "method": "invoke",
            "id": 4,
            "params": {
                "tool": "save_receipt",
                "arguments": {
                    "receipt": mock_receipt
                }
            }
        })
        assert "result" in res, "Missing 'result' key in save_receipt response"
        assert res["result"].get("success") is True, "Save receipt failed"
        receipt_id = res["result"]["data"]["receipt_id"]
        print(f"[OK] Save receipt test passed. Saved ID: {receipt_id}")

        # 5. Test list_receipts again to confirm persistence
        res = send_request({
            "jsonrpc": "2.0",
            "method": "invoke",
            "id": 5,
            "params": {
                "tool": "list_receipts",
                "arguments": {}
            }
        })
        new_receipts = res["result"]["data"]["receipts"]
        assert len(new_receipts) > 0, "List receipts after save is empty"
        print(f"[OK] List receipts confirm test passed. Found {len(new_receipts)} receipts.")

        # 6. Test get_receipt_details
        res = send_request({
            "jsonrpc": "2.0",
            "method": "invoke",
            "id": 6,
            "params": {
                "tool": "get_receipt_details",
                "arguments": {
                    "receipt_id": receipt_id
                }
            }
        })
        assert "result" in res, "Missing 'result' key in get_receipt_details response"
        assert res["result"].get("success") is True, "Get details failed"
        receipt_details = res["result"]["data"]["receipt"]
        assert receipt_details["id"] == receipt_id, "Fetched ID doesn't match"
        assert len(receipt_details["items"]) == 3, f"Expected 3 items, got {len(receipt_details['items'])}"
        print("[OK] Get receipt details test passed.")

        # 7. Test export_receipts_csv
        res = send_request({
            "jsonrpc": "2.0",
            "method": "invoke",
            "id": 7,
            "params": {
                "tool": "export_receipts_csv",
                "arguments": {
                    "receipt_id": receipt_id
                }
            }
        })
        assert "result" in res, "Missing 'result' key in export_receipts_csv response"
        assert res["result"].get("success") is True, "Export CSV failed"
        import base64
        csv_b64 = res["result"]["data"]["content_b64"]
        csv_text = base64.b64decode(csv_b64).decode("utf-8")
        assert "Mock Supermarket" in csv_text, "CSV missing supermarket name"
        print("[OK] Export CSV test passed.")

        # 8. Test delete_receipt
        res = send_request({
            "jsonrpc": "2.0",
            "method": "invoke",
            "id": 8,
            "params": {
                "tool": "delete_receipt",
                "arguments": {
                    "receipt_id": receipt_id
                }
            }
        })
        assert "result" in res, "Missing 'result' key in delete_receipt response"
        assert res["result"].get("success") is True, "Delete receipt failed"
        print("[OK] Delete receipt test passed.")

        # V2 Tests
        # Let's save a receipt with tip, discount and verify validations
        v2_receipt = {
            "merchant": {"name": "V2 Shop"},
            "date": "2026-06-15",
            "time": "15:00",
            "currency": "EUR",
            "subtotal": 5000,
            "tax": 0,
            "tip": 500,
            "discount": 1000,
            "total": 4500,
            "items": [
                {"name": "Item A", "quantity": 1, "unit_price": 5000, "total_price": 5000, "category": "Office"}
            ]
        }

        # 9. Test validate_receipt (valid)
        res = send_request({
            "jsonrpc": "2.0",
            "method": "invoke",
            "id": 9,
            "params": {
                "tool": "validate_receipt",
                "arguments": {
                    "receipt": v2_receipt
                }
            }
        })
        assert "result" in res, "Missing 'result' key in validate_receipt response"
        assert res["result"].get("success") is True, "validate_receipt was not successful"
        assert res["result"]["data"].get("valid") is True, f"Expected valid receipt, got warnings: {res['result']['data'].get('warnings')}"
        print("[OK] Validate receipt (valid) test passed.")

        # 10. Test validate_receipt (invalid - total mismatch)
        invalid_receipt = v2_receipt.copy()
        invalid_receipt["total"] = 9999
        res = send_request({
            "jsonrpc": "2.0",
            "method": "invoke",
            "id": 10,
            "params": {
                "tool": "validate_receipt",
                "arguments": {
                    "receipt": invalid_receipt
                }
            }
        })
        assert res["result"]["data"].get("valid") is False, "Expected receipt to be invalid due to mismatch"
        warnings = res["result"]["data"].get("warnings")
        has_total_mismatch = any(w.get("code") == "TOTAL_MISMATCH" for w in warnings)
        assert has_total_mismatch, f"Expected TOTAL_MISMATCH warning, got {warnings}"
        print("[OK] Validate receipt (mismatch) test passed.")

        # 11. Save V2 receipt to test list filtering, monthly summary and exports
        res = send_request({
            "jsonrpc": "2.0",
            "method": "invoke",
            "id": 11,
            "params": {
                "tool": "save_receipt",
                "arguments": {
                    "receipt": v2_receipt
                }
            }
        })
        v2_receipt_id = res["result"]["data"]["receipt_id"]
        print(f"[OK] Save V2 receipt passed. ID: {v2_receipt_id}")

        # 12. Test list_receipts with filters (match)
        res = send_request({
            "jsonrpc": "2.0",
            "method": "invoke",
            "id": 12,
            "params": {
                "tool": "list_receipts",
                "arguments": {
                    "merchant": "V2 Shop"
                }
            }
        })
        receipts = res["result"]["data"]["receipts"]
        assert len(receipts) == 1, f"Expected 1 receipt for merchant 'V2 Shop', got {len(receipts)}"
        assert receipts[0]["id"] == v2_receipt_id, "Fetched ID doesn't match"
        print("[OK] List receipts filtering test passed.")

        # 13. Test get_monthly_summary
        res = send_request({
            "jsonrpc": "2.0",
            "method": "invoke",
            "id": 13,
            "params": {
                "tool": "get_monthly_summary",
                "arguments": {
                    "year": 2026,
                    "month": 6
                }
            }
        })
        assert res["result"].get("success") is True
        summary = res["result"]["data"]
        assert summary["total_spent"] >= 4500, f"Expected total spent to include v2 receipt, got {summary['total_spent']}"
        assert summary["receipt_count"] >= 1, "Expected at least 1 receipt"
        print("[OK] Get monthly summary test passed.")

        # 14. Test export_receipts_excel
        res = send_request({
            "jsonrpc": "2.0",
            "method": "invoke",
            "id": 14,
            "params": {
                "tool": "export_receipts_excel",
                "arguments": {
                    "merchant": "V2 Shop"
                }
            }
        })
        assert res["result"].get("success") is True
        excel_data = res["result"]["data"]
        assert "content_b64" in excel_data, "Missing base64 content"
        assert excel_data["mime_type"] == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Wrong Mime-Type"
        print("[OK] Export receipts Excel test passed.")

        # 15. Test export_receipts_pdf
        res = send_request({
            "jsonrpc": "2.0",
            "method": "invoke",
            "id": 15,
            "params": {
                "tool": "export_receipts_pdf",
                "arguments": {
                    "receipt_ids": [v2_receipt_id],
                    "mode": "receipt"
                }
            }
        })
        assert res["result"].get("success") is True
        pdf_data = res["result"]["data"]
        assert "content_b64" in pdf_data, "Missing base64 content"
        assert pdf_data["mime_type"] == "application/pdf", "Wrong Mime-Type"
        print("[OK] Export receipts PDF test passed.")

        # 16. Delete V2 receipt to leave database clean
        res = send_request({
            "jsonrpc": "2.0",
            "method": "invoke",
            "id": 16,
            "params": {
                "tool": "delete_receipt",
                "arguments": {
                    "receipt_id": v2_receipt_id
                }
            }
        })
        assert res["result"].get("success") is True
        print("[OK] Cleanup deleted V2 receipt test passed.")

    finally:
        process.terminate()
        stderr_logs = process.stderr.read()
        if stderr_logs:
            print("\n--- PLUGIN STDERR LOGS ---")
            print(stderr_logs)
            print("--------------------------")

if __name__ == "__main__":
    run_tests()
