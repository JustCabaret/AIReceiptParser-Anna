import os
import sys
import tempfile
import urllib.request
import shutil

# Dynamic imports to prevent startup failures if dependencies are missing
try:
    import cv2
except ImportError:
    cv2 = None

try:
    import pytesseract
except ImportError:
    pytesseract = None

# Windows Tesseract Robust Auto-detection
tesseract_cmd_path = None
tesseract_available = False
tesseract_paths_checked = []

if pytesseract is not None:
    # 1. Check system PATH
    which_tess = shutil.which("tesseract")
    tesseract_paths_checked.append("system PATH (which tesseract)")
    if which_tess:
        tesseract_cmd_path = which_tess
        pytesseract.pytesseract.tesseract_cmd = which_tess
        tesseract_available = True
    else:
        # 2. Check standard Windows installations
        standard_windows_paths = [
            r"C:\Program Files\Tesseract-OCR\tesseract.exe",
            r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe"
        ]
        
        # Check if tesseract_cmd was pre-set to a valid file
        current_cmd = getattr(pytesseract.pytesseract, 'tesseract_cmd', None)
        if current_cmd and current_cmd != 'tesseract':
            standard_windows_paths.insert(0, current_cmd)
            
        for path in standard_windows_paths:
            tesseract_paths_checked.append(path)
            if os.path.exists(path):
                tesseract_cmd_path = path
                pytesseract.pytesseract.tesseract_cmd = path
                tesseract_available = True
                break
else:
    tesseract_available = False

def preprocess_image(image_path):
    """Loads and preprocesses the image using OpenCV (convert to grayscale + bilateral filter + adaptive thresholding + optional upscale)."""
    if cv2 is None:
        raise ImportError("OpenCV (cv2) is not installed on this system.")

    # Load image
    image = cv2.imread(image_path)
    if image is None:
        raise ValueError(f"Failed to read image from path: {image_path}")

    # Convert to grayscale
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    # Upscale the image if it is relatively low resolution (width < 1600)
    h, w = gray.shape[:2]
    if w < 1600:
        scale_factor = 2.0
        gray = cv2.resize(gray, (int(w * scale_factor), int(h * scale_factor)), interpolation=cv2.INTER_CUBIC)

    # Apply bilateral filter to remove noise while keeping edges sharp
    denoised = cv2.bilateralFilter(gray, 9, 75, 75)

    # Apply adaptive thresholding to handle shadows and uneven lighting
    thresholded = cv2.adaptiveThreshold(
        denoised, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 21, 15
    )
    return thresholded

def run_ocr(image_path):
    """Runs high-precision EasyOCR with layout reconstruction, falling back to Tesseract OCR if needed."""
    try:
        # Force stdout/stderr to replace invalid characters
        try:
            sys.stdout.reconfigure(errors='replace')
            sys.stderr.reconfigure(errors='replace')
        except Exception:
            pass

        print("Attempting high-precision EasyOCR...", file=sys.stderr)
        import easyocr
        
        # Initialize reader with verbose=False
        reader = easyocr.Reader(['en', 'pt'], verbose=False)
        
        # Read text with detailed layout bounding boxes
        results = reader.readtext(image_path)
        
        if not results:
            print("EasyOCR returned empty results. Trying Tesseract fallback.", file=sys.stderr)
            raise ValueError("No text detected by EasyOCR")

        # Group bounding boxes into rows based on Y coordinates
        rows = []
        for bbox, text, conf in results:
            y_center = (bbox[0][1] + bbox[2][1]) / 2.0
            x_left = bbox[0][0]
            height = abs(bbox[2][1] - bbox[0][1])
            rows.append({'x': x_left, 'y': y_center, 'h': height, 'text': text})
            
        rows.sort(key=lambda r: r['y'])
        
        # Group boxes into lines using a dynamic vertical distance threshold
        grouped_lines = []
        if rows:
            current_line = [rows[0]]
            for item in rows[1:]:
                avg_height = sum(r['h'] for r in current_line) / len(current_line)
                threshold = avg_height * 0.7
                
                if abs(item['y'] - current_line[0]['y']) < threshold:
                    current_line.append(item)
                else:
                    grouped_lines.append(current_line)
                    current_line = [item]
            grouped_lines.append(current_line)
            
        # Sort each line from left to right and join words
        final_text = []
        for line in grouped_lines:
            line.sort(key=lambda item: item['x'])
            line_str = " ".join([item['text'] for item in line])
            final_text.append(line_str)
            
        ocr_text = "\n".join(final_text)
        print("EasyOCR layout parsing completed successfully.", file=sys.stderr)
        return ocr_text

    except Exception as easyocr_err:
        print(f"EasyOCR failed: {easyocr_err}. Falling back to Tesseract OCR.", file=sys.stderr)
        
        if pytesseract is None:
            raise ImportError("Pytesseract is not installed on this system.")

        try:
            preprocessed = preprocess_image(image_path)
            
            with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
                temp_path = f.name
            
            try:
                cv2.imwrite(temp_path, preprocessed)
                text = pytesseract.image_to_string(temp_path)
                return text
            finally:
                if os.path.exists(temp_path):
                    os.remove(temp_path)
        except Exception as e:
            print(f"OpenCV + Tesseract failed: {e}. Attempting direct Tesseract OCR.", file=sys.stderr)
            try:
                text = pytesseract.image_to_string(image_path)
                return text
            except Exception as ocr_err:
                raise RuntimeError(f"Tesseract OCR failed: {ocr_err}")

def download_file(url):
    """Downloads a file from a URL to a local temporary file."""
    fd, temp_path = tempfile.mkstemp()
    os.close(fd)
    try:
        urllib.request.urlretrieve(url, temp_path)
        return temp_path
    except Exception as e:
        if os.path.exists(temp_path):
            os.remove(temp_path)
        raise RuntimeError(f"Failed to download image from {url}: {e}")
