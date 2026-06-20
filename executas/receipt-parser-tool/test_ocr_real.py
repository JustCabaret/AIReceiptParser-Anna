import os
import sys
import json
import subprocess
from PIL import Image, ImageDraw, ImageFont

def test_real_ocr():
    # 1. Create a dummy receipt image using Pillow
    img = Image.new('RGB', (400, 150), color=(255, 255, 255))
    d = ImageDraw.Draw(img)
    
    # We will write plain text to ensure OCR succeeds
    d.text((20, 20), "TESSERACT OCR TEST", fill=(0, 0, 0))
    d.text((20, 50), "Store: Real Store", fill=(0, 0, 0))
    d.text((20, 80), "Total: 100.00 EUR", fill=(0, 0, 0))
    
    workspace_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    image_path = os.path.join(workspace_dir, "test_ocr_fixture.png")
    img.save(image_path)
    print(f"Generated OCR test fixture at: {image_path}")
    
    # 2. Run the plugin process to invoke parse_receipt_image
    plugin_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "receipt_parser_plugin.py")
    process = subprocess.Popen(
        [sys.executable, plugin_path],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1
    )
    
    # Format the file path as a file:/// URL
    # Replace backslashes with forward slashes for urllib compatibility
    formatted_path = image_path.replace("\\", "/")
    if not formatted_path.startswith("/"):
        formatted_path = "/" + formatted_path
    file_url = f"file://{formatted_path}"
    print(f"Formulated local image URL: {file_url}")
    
    req = {
        "jsonrpc": "2.0",
        "method": "invoke",
        "id": 100,
        "params": {
            "tool": "parse_receipt_image",
            "arguments": {
                "image_url": file_url,
                "mock_mode": False
            }
        }
    }
    
    try:
        process.stdin.write(json.dumps(req) + "\n")
        process.stdin.flush()
        
        res_line = process.stdout.readline().strip()
        res = json.loads(res_line)
        print(f"Response: {json.dumps(res, indent=2)}")
        
        # 3. Clean up the fixture image
        if os.path.exists(image_path):
            os.remove(image_path)
            print("Cleaned up OCR test fixture.")
            
        # 4. Assert correctness
        assert "result" in res, "Missing 'result' key"
        assert res["result"].get("success") is True, "Invoke parse_receipt_image failed"
        ocr_text = res["result"]["data"]["ocr_text"]
        print(f"\nExtracted OCR Text:\n{ocr_text}")
        
        assert "TESSERACT" in ocr_text or "REAL" in ocr_text or "STORE" in ocr_text or "TOTAL" in ocr_text, "OCR text did not extract expected keywords"
        print("\n[OK] Real OCR validation test passed successfully!")
        
    finally:
        process.terminate()
        logs = process.stderr.read()
        if logs:
            print("\n--- PLUGIN LOGS ---")
            print(logs)

if __name__ == "__main__":
    test_real_ocr()
