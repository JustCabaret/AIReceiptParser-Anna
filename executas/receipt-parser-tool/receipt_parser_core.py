import os
import sys
import datetime
import json

# Re-exports from db module
from db import (
    get_db_path,
    get_db_connection,
    init_db,
    insert_receipt,
    fetch_all_receipts,
    get_receipt_details as fetch_receipt_details,
    delete_receipt,
    get_monthly_summary
)

# Re-exports from ocr module
from ocr import (
    cv2,
    pytesseract,
    tesseract_available,
    tesseract_cmd_path,
    tesseract_paths_checked,
    preprocess_image,
    run_ocr,
    download_file
)

# Re-exports from exporters module
from exporters import (
    openpyxl,
    reportlab,
    export_receipts_excel,
    export_receipts_pdf
)

def log_print(msg):
    """Logs a message to stderr."""
    print(f"[receipt-parser-core] {msg}", file=sys.stderr)
    sys.stderr.flush()

def validate_receipt(data):
    """Validates receipt fields and price consistency using integer cents."""
    warnings = []
    
    # Check top-level fields
    merchant = data.get("merchant", {})
    if isinstance(merchant, dict):
        merchant_name = merchant.get("name")
    else:
        merchant_name = data.get("store")
        
    if not merchant_name or str(merchant_name).strip() == "":
        warnings.append({
            "code": "MISSING_FIELD",
            "severity": "warning",
            "message": "Merchant name is missing.",
            "expected": "",
            "actual": "",
            "difference": 0
        })
        
    date_val = data.get("date")
    if not date_val or str(date_val).strip() == "":
        warnings.append({
            "code": "MISSING_FIELD",
            "severity": "warning",
            "message": "Receipt date is missing.",
            "expected": "",
            "actual": "",
            "difference": 0
        })
        
    currency = data.get("currency")
    if not currency or str(currency).strip() == "":
        warnings.append({
            "code": "MISSING_FIELD",
            "severity": "warning",
            "message": "Currency is missing.",
            "expected": "",
            "actual": "",
            "difference": 0
        })
        
    total = data.get("total")
    if total is None:
        warnings.append({
            "code": "MISSING_FIELD",
            "severity": "warning",
            "message": "Receipt total is missing.",
            "expected": 0,
            "actual": 0,
            "difference": 0
        })
        total = 0
    else:
        total = int(total)
        
    subtotal = int(data.get("subtotal") or 0)
    tax = int(data.get("tax") or 0)
    tip = int(data.get("tip") or 0)
    discount = int(data.get("discount") or 0)
    
    # Check items
    items = data.get("items") or []
    items_sum = 0
    for idx, item in enumerate(items):
        name = item.get("name") or item.get("product")
        if not name or str(name).strip() == "":
            warnings.append({
                "code": "ITEM_INVALID",
                "severity": "warning",
                "message": f"Item #{idx+1} is missing a description.",
                "expected": "",
                "actual": "",
                "difference": 0
            })
            
        qty = item.get("quantity") or item.get("qty")
        if qty is None:
            warnings.append({
                "code": "ITEM_INVALID",
                "severity": "warning",
                "message": f"Item '{name or idx+1}' is missing quantity.",
                "expected": 1,
                "actual": 0,
                "difference": 0
            })
            qty = 1
        else:
            qty = int(qty)
            if qty <= 0:
                warnings.append({
                    "code": "ITEM_INVALID",
                    "severity": "warning",
                    "message": f"Item '{name or idx+1}' has zero or negative quantity.",
                    "expected": 1,
                    "actual": qty,
                    "difference": 0
                })
                
        price = item.get("unit_price") or item.get("price")
        if price is None:
            price = 0
        else:
            price = int(price)
            if price < 0:
                warnings.append({
                    "code": "ITEM_INVALID",
                    "severity": "warning",
                    "message": f"Item '{name or idx+1}' has negative unit price.",
                    "expected": 0,
                    "actual": price,
                    "difference": 0
                })
        
        items_sum += (price * qty)
        
    # Check items sum against subtotal (or total if subtotal is 0)
    target_subtotal = subtotal if subtotal > 0 else total
    if items_sum != target_subtotal:
        warnings.append({
            "code": "ITEMS_SUM_MISMATCH",
            "severity": "warning",
            "message": f"Sum of items ({items_sum/100:.2f}) does not match subtotal/total ({target_subtotal/100:.2f}).",
            "expected": target_subtotal,
            "actual": items_sum,
            "difference": items_sum - target_subtotal
        })
        
    # Check subtotal + tax + tip - discount == total
    expected_total = subtotal + tax + tip - discount
    if subtotal > 0 and expected_total != total:
        warnings.append({
            "code": "TOTAL_MISMATCH",
            "severity": "warning",
            "message": f"Calculated total ({expected_total/100:.2f}) does not match receipt total ({total/100:.2f}).",
            "expected": total,
            "actual": expected_total,
            "difference": expected_total - total
        })
        
    return {
        "success": True,
        "valid": len(warnings) == 0,
        "warnings": warnings
    }

def seed_demo_data(reset=False):
    """Seeds the database with a rich set of 12 realistic demo receipts spanning three months."""
    init_db()
    connection = get_db_connection()
    try:
        cursor = connection.cursor()
        
        # If reset is True, delete only demo receipts
        if reset:
            log_print("Resetting demo dataset...")
            cursor.execute("""
                DELETE FROM receipt_items 
                WHERE receipt_id IN (SELECT id FROM receipts WHERE is_demo = 1)
            """)
            cursor.execute("DELETE FROM receipts WHERE is_demo = 1")
            connection.commit()
            
        # Check if demo receipts already exist
        cursor.execute("SELECT COUNT(*) FROM receipts WHERE is_demo = 1")
        count = cursor.fetchone()[0]
        
        if count > 0 and not reset:
            log_print("Demo receipts already exist, skipping seed.")
            return {
                "success": True,
                "inserted": 0,
                "skipped": True,
                "message": "Demo dataset already loaded. Use Reset to reload."
            }
            
        now = datetime.datetime.now()
        
        def get_date_str(days_ago):
            d = now - datetime.timedelta(days=days_ago)
            return d.strftime("%Y-%m-%d")

        demo_receipts = [
            # --- 2 MONTHS AGO ---
            {
                "merchant": {"name": "Fresh Market", "address": "123 Green Ave, Lisbon"},
                "date": get_date_str(74),
                "time": "12:15",
                "currency": "EUR",
                "subtotal": 2450,
                "tax": 150,
                "tip": 0,
                "discount": 200,
                "total": 2400,
                "payment_method": "Card",
                "expense_category": "Groceries",
                "confidence": 98,
                "warnings": [],
                "items": [
                    {"name": "UHT Whole Milk 1L", "quantity": 6, "unit_price": 85, "total_price": 510, "category": "Groceries"},
                    {"name": "Whole Wheat Sliced Bread 500g", "quantity": 2, "unit_price": 210, "total_price": 420, "category": "Groceries"},
                    {"name": "Lemon Dishwasher Liquid 1L", "quantity": 1, "unit_price": 250, "total_price": 250, "category": "Groceries"},
                    {"name": "Organic Apples kg", "quantity": 2, "unit_price": 199, "total_price": 398, "category": "Groceries"},
                    {"name": "Chicken Breast kg", "quantity": 1, "unit_price": 872, "total_price": 872, "category": "Groceries"}
                ]
            },
            {
                "merchant": {"name": "Uber Europe", "address": "Lisbon, Portugal"},
                "date": get_date_str(65),
                "time": "08:45",
                "currency": "EUR",
                "subtotal": 1250,
                "tax": 75,
                "tip": 150,
                "discount": 0,
                "total": 1475,
                "payment_method": "Card",
                "expense_category": "Transport",
                "confidence": 99,
                "warnings": [],
                "items": [
                    {"name": "Uber Ride - Business Trip", "quantity": 1, "unit_price": 1250, "total_price": 1250, "category": "Transport"}
                ]
            },
            # --- 1 MONTH AGO ---
            {
                "merchant": {"name": "Metro Grocery", "address": "Centro Colombo, Lisbon"},
                "date": get_date_str(35),
                "time": "18:30",
                "currency": "EUR",
                "subtotal": 4520,
                "tax": 270,
                "tip": 0,
                "discount": 0,
                "total": 4520,
                "payment_method": "Card",
                "expense_category": "Groceries",
                "confidence": 96,
                "warnings": [],
                "items": [
                    {"name": "Extra Virgin Olive Oil 750ml", "quantity": 1, "unit_price": 699, "total_price": 699, "category": "Groceries"},
                    {"name": "White Rice 1kg", "quantity": 3, "unit_price": 125, "total_price": 375, "category": "Groceries"},
                    {"name": "Spaghetti Pasta 500g", "quantity": 4, "unit_price": 95, "total_price": 380, "category": "Groceries"},
                    {"name": "Frozen Cod Fillets kg", "quantity": 1, "unit_price": 1850, "total_price": 1850, "category": "Groceries"},
                    {"name": "Natural Yogurt Multipack", "quantity": 2, "unit_price": 199, "total_price": 398, "category": "Groceries"}
                ]
            },
            {
                "merchant": {"name": "Uber Europe", "address": "Lisbon, Portugal"},
                "date": get_date_str(40),
                "time": "19:15",
                "currency": "EUR",
                "subtotal": 1850,
                "tax": 110,
                "tip": 0,
                "discount": 0,
                "total": 1850,
                "payment_method": "Card",
                "expense_category": "Transport",
                "confidence": 98,
                "warnings": [],
                "items": [
                    {"name": "Uber Ride - Airport Return", "quantity": 1, "unit_price": 1850, "total_price": 1850, "category": "Transport"}
                ]
            },
            {
                "merchant": {"name": "Versailles Cafe", "address": "Av. da Republica 15, Lisbon"},
                "date": get_date_str(42),
                "time": "16:30",
                "currency": "EUR",
                "subtotal": 850,
                "tax": 110,
                "tip": 50,
                "discount": 0,
                "total": 1010,
                "payment_method": "Cash",
                "expense_category": "Meals",
                "confidence": 95,
                "warnings": [],
                "items": [
                    {"name": "Espresso Coffee", "quantity": 2, "unit_price": 150, "total_price": 300, "category": "Meals"},
                    {"name": "Custard Tart (Pastel de Nata)", "quantity": 2, "unit_price": 175, "total_price": 350, "category": "Meals"},
                    {"name": "Butter Toast on Brioche", "quantity": 1, "unit_price": 200, "total_price": 200, "category": "Meals"}
                ]
            },
            {
                "merchant": {"name": "Staples Office", "address": "Amadora Shopping, Lisbon"},
                "date": get_date_str(36),
                "time": "11:20",
                "currency": "EUR",
                "subtotal": 4500,
                "tax": 1035,
                "tip": 0,
                "discount": 500,
                "total": 5035,
                "payment_method": "Card",
                "expense_category": "Office Supplies",
                "confidence": 92,
                "warnings": [],
                "items": [
                    {"name": "A4 Spiral Notebook Ruled", "quantity": 5, "unit_price": 300, "total_price": 1500, "category": "Office Supplies"},
                    {"name": "Gel Pens Pack 10", "quantity": 2, "unit_price": 750, "total_price": 1500, "category": "Office Supplies"},
                    {"name": "Lever Arch Binder", "quantity": 3, "unit_price": 500, "total_price": 1500, "category": "Office Supplies"}
                ]
            },
            # --- CURRENT MONTH ---
            {
                "merchant": {"name": "Fresh Market", "address": "123 Green Ave, Lisbon"},
                "date": get_date_str(12),
                "time": "14:10",
                "currency": "EUR",
                "subtotal": 3210,
                "tax": 190,
                "tip": 0,
                "discount": 0,
                "total": 3210,
                "payment_method": "Card",
                "expense_category": "Groceries",
                "confidence": 97,
                "warnings": [],
                "items": [
                    {"name": "Algarve Oranges kg", "quantity": 3, "unit_price": 149, "total_price": 447, "category": "Groceries"},
                    {"name": "Fresh Salmon Fillet", "quantity": 1, "unit_price": 1450, "total_price": 1450, "category": "Groceries"},
                    {"name": "Mineral Water 1.5L", "quantity": 6, "unit_price": 65, "total_price": 390, "category": "Groceries"},
                    {"name": "Greek Yogurt Pack", "quantity": 4, "unit_price": 145, "total_price": 580, "category": "Groceries"}
                ]
            },
            {
                "merchant": {"name": "BP Fuel Station", "address": "Highway A1 km 3, Lisbon"},
                "date": get_date_str(2),
                "time": "22:10",
                "currency": "EUR",
                "subtotal": 6000,
                "tax": 1380,
                "tip": 0,
                "discount": 0,
                "total": 7380,
                "payment_method": "Card",
                "expense_category": "Transport",
                "confidence": 96,
                "warnings": [],
                "items": [
                    {"name": "Unleaded Petrol 95", "quantity": 35, "unit_price": 171, "total_price": 6000, "category": "Transport"}
                ]
            },
            {
                "merchant": {"name": "McDonalds Saldanha", "address": "Praca de Saldanha, Lisbon"},
                "date": get_date_str(0),
                "time": "13:05",
                "currency": "EUR",
                "subtotal": 1350,
                "tax": 176,
                "tip": 0,
                "discount": 150,
                "total": 1276,
                "payment_method": "Card",
                "expense_category": "Meals",
                "confidence": 99,
                "warnings": ["TOTAL_MISMATCH"],
                "items": [
                    {"name": "McChicken Meal Large", "quantity": 1, "unit_price": 950, "total_price": 950, "category": "Meals"},
                    {"name": "Caramel Sundae", "quantity": 1, "unit_price": 400, "total_price": 400, "category": "Meals"}
                ]
            },
            {
                "merchant": {"name": "Worten Electronics", "address": "Centro Colombo, Lisbon"},
                "date": get_date_str(4),
                "time": "19:15",
                "currency": "EUR",
                "subtotal": 4057,
                "tax": 933,
                "tip": 0,
                "discount": 0,
                "total": 4990,
                "payment_method": "Card",
                "expense_category": "Electronics",
                "confidence": 97,
                "warnings": [],
                "items": [
                    {"name": "Wireless Bluetooth Mouse", "quantity": 1, "unit_price": 2990, "total_price": 2990, "category": "Electronics"},
                    {"name": "Ergonomic Mousepad", "quantity": 1, "unit_price": 2000, "total_price": 2000, "category": "Electronics"}
                ]
            },
            {
                "merchant": {"name": "Vip Executive Hotel", "address": "Av. 5 de Outubro, Lisbon"},
                "date": get_date_str(5),
                "time": "10:00",
                "currency": "EUR",
                "subtotal": 11000,
                "tax": 660,
                "tip": 0,
                "discount": 1000,
                "total": 10660,
                "payment_method": "Card",
                "expense_category": "Travel",
                "confidence": 94,
                "warnings": [],
                "items": [
                    {"name": "Hotel Stay - Single Suite 1 Night", "quantity": 1, "unit_price": 11000, "total_price": 11000, "category": "Travel"}
                ]
            },
            {
                "merchant": {"name": "Central Pharmacy", "address": "Rua Garrett 4, Lisbon"},
                "date": get_date_str(8),
                "time": "09:30",
                "currency": "EUR",
                "subtotal": 1840,
                "tax": 110,
                "tip": 0,
                "discount": 0,
                "total": 1840,
                "payment_method": "Card",
                "expense_category": "Personal Care",
                "confidence": 95,
                "warnings": [],
                "items": [
                    {"name": "Paracetamol 500mg 20 Tabs", "quantity": 2, "unit_price": 220, "total_price": 440, "category": "Personal Care"},
                    {"name": "Cough Syrup Honey & Lemon", "quantity": 1, "unit_price": 1400, "total_price": 1400, "category": "Personal Care"}
                ]
            }
        ]

        inserted_count = 0
        for receipt_data in demo_receipts:
            store = receipt_data.get("merchant", {}).get("name") or "Unknown"
            total = int(receipt_data.get("total", 0))
            tip = int(receipt_data.get("tip") or 0)
            discount = int(receipt_data.get("discount") or 0)
            parsed_at = f"{receipt_data.get('date')} {receipt_data.get('time')}:00"
            
            warnings_str = json.dumps(receipt_data.get("warnings") or [])

            cursor.execute(
                "INSERT INTO receipts (total, source, warnings, tip, discount, is_demo, parsed_at) VALUES (?, ?, ?, ?, ?, 1, ?)",
                (total, store, warnings_str, tip, discount, parsed_at)
            )
            receipt_id = cursor.lastrowid

            for item in receipt_data.get("items") or []:
                product = item.get("name")
                qty = int(item.get("quantity") or 1)
                price = int(item.get("unit_price") or 0)
                category = item.get("category") or "Others"

                cursor.execute(
                    """
                    INSERT INTO receipt_items (receipt_id, product, quantity, price, category)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (receipt_id, product, qty, price, category)
                )
            inserted_count += 1
            
        connection.commit()
        log_print(f"Successfully seeded {inserted_count} demo receipts.")
        return {
            "success": True,
            "inserted": inserted_count,
            "skipped": False,
            "message": f"Demo dataset loaded ({inserted_count} receipts)."
        }
    except Exception as e:
        log_print(f"Error seeding demo data: {e}")
        raise e
    finally:
        connection.close()
