import os
import sqlite3
import json
from datetime import datetime

def get_db_path():
    """Returns the centralized path to the SQLite database, supporting containerized paths or fallback."""
    # 1. Check if EXECUTA_DATA is provided in the environment
    data_dir = os.environ.get("EXECUTA_DATA")
    if data_dir and os.path.isdir(data_dir):
        return os.path.join(data_dir, "receipts.db")
        
    # 2. Check if EXECUTA_HOME is provided in the environment
    home_dir = os.environ.get("EXECUTA_HOME")
    if home_dir:
        target_dir = os.path.join(home_dir, "data")
        os.makedirs(target_dir, exist_ok=True)
        return os.path.join(target_dir, "receipts.db")
        
    # 3. Fallback to workspace root for local development
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    return os.path.join(base_dir, "receipts.db")

def get_db_connection():
    """Returns a connection to the SQLite database."""
    db_path = get_db_path()
    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    return connection

def init_db():
    """Initializes the database tables if they do not exist and applies migrations."""
    connection = get_db_connection()
    try:
        cursor = connection.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS receipts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                total INTEGER NOT NULL,
                source TEXT NOT NULL,
                parsed_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ''')

        cursor.execute('''
            CREATE TABLE IF NOT EXISTS receipt_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                receipt_id INTEGER NOT NULL,
                product TEXT NOT NULL,
                quantity INTEGER NOT NULL,
                price INTEGER NOT NULL,
                category TEXT DEFAULT NULL,
                FOREIGN KEY (receipt_id) REFERENCES receipts(id)
            )
        ''')
        connection.commit()

        # Database migrations check
        cursor.execute("PRAGMA table_info(receipts)")
        columns = [row[1] for row in cursor.fetchall()]
        
        migrated = False
        if "warnings" not in columns:
            cursor.execute("ALTER TABLE receipts ADD COLUMN warnings TEXT DEFAULT NULL")
            migrated = True
        if "tip" not in columns:
            cursor.execute("ALTER TABLE receipts ADD COLUMN tip INTEGER DEFAULT 0")
            migrated = True
        if "discount" not in columns:
            cursor.execute("ALTER TABLE receipts ADD COLUMN discount INTEGER DEFAULT 0")
            migrated = True
        if "is_demo" not in columns:
            cursor.execute("ALTER TABLE receipts ADD COLUMN is_demo INTEGER DEFAULT 0")
            migrated = True
        if "image_url" not in columns:
            cursor.execute("ALTER TABLE receipts ADD COLUMN image_url TEXT DEFAULT NULL")
            migrated = True
            
        if migrated:
            connection.commit()
    finally:
        connection.close()

def insert_receipt(data):
    """Inserts or updates a structured receipt and its items in SQLite."""
    init_db()  # Ensure tables exist
    connection = get_db_connection()
    try:
        cursor = connection.cursor()
        
        # Check if ID is provided to run an UPDATE
        receipt_id = data.get("id") or data.get("receipt_id")
        
        # Get store name, total, tip, discount, warnings, image_url
        store = data.get("store") or data.get("merchant", {}).get("name") or "Unknown"
        total = int(data.get("total", 0))
        tip = int(data.get("tip") or 0)
        discount = int(data.get("discount") or 0)
        image_url = data.get("image_url") or None
        
        # Format warnings array to JSON string
        warnings_list = data.get("warnings") or []
        warnings_str = json.dumps(warnings_list)

        is_update = False
        if receipt_id:
            cursor.execute("SELECT id FROM receipts WHERE id = ?", (receipt_id,))
            exists = cursor.fetchone()
            if exists:
                is_update = True

        if is_update:
            # Update receipt
            cursor.execute(
                """
                UPDATE receipts 
                SET total = ?, source = ?, warnings = ?, tip = ?, discount = ?, image_url = COALESCE(?, image_url)
                WHERE id = ?
                """,
                (total, store, warnings_str, tip, discount, image_url, receipt_id)
            )
            # Clear old items for re-insertion
            cursor.execute("DELETE FROM receipt_items WHERE receipt_id = ?", (receipt_id,))
        else:
            # Insert receipt
            cursor.execute(
                "INSERT INTO receipts (total, source, warnings, tip, discount, image_url) VALUES (?, ?, ?, ?, ?, ?)",
                (total, store, warnings_str, tip, discount, image_url)
            )
            receipt_id = cursor.lastrowid

        # Insert items
        items = data.get("items") or []
        for item in items:
            product = item.get("product") or item.get("name") or "Unknown Item"
            qty = int(item.get("quantity") or item.get("qty") or 1)
            price = int(item.get("price") or item.get("unit_price") or 0)
            category = item.get("type") or item.get("category") or "Others"

            cursor.execute(
                """
                INSERT INTO receipt_items (receipt_id, product, quantity, price, category)
                VALUES (?, ?, ?, ?, ?)
                """,
                (receipt_id, product, qty, price, category)
            )
        connection.commit()
        return receipt_id
    finally:
        connection.close()

def fetch_all_receipts(filters=None):
    """Fetches all receipts summarized from SQLite with optional filtering."""
    init_db()
    connection = get_db_connection()
    try:
        cursor = connection.cursor()
        query = "SELECT id, total, source AS store, parsed_at, warnings, tip, discount FROM receipts"
        params = []
        conditions = []
        
        if filters:
            if filters.get("merchant"):
                conditions.append("source LIKE ?")
                params.append(f"%{filters.get('merchant')}%")
            if filters.get("date_from"):
                conditions.append("date(parsed_at) >= date(?)")
                params.append(filters.get("date_from"))
            if filters.get("date_to"):
                conditions.append("date(parsed_at) <= date(?)")
                params.append(filters.get("date_to"))
                
        if conditions:
            query += " WHERE " + " AND ".join(conditions)
            
        query += " ORDER BY parsed_at DESC"
        
        cursor.execute(query, params)
        rows = cursor.fetchall()
        
        receipts = []
        for row in rows:
            # Parse warnings JSON
            warnings_list = []
            if row["warnings"]:
                try:
                    warnings_list = json.loads(row["warnings"])
                except Exception:
                    warnings_list = []
            
            receipts.append({
                "id": row["id"],
                "total": row["total"],
                "store": row["store"],
                "parsed_at": row["parsed_at"],
                "warnings": warnings_list,
                "tip": row["tip"] or 0,
                "discount": row["discount"] or 0
            })
        return receipts
    finally:
        connection.close()

def get_receipt_details(receipt_id):
    """Fetches details of a specific receipt from SQLite, including items."""
    init_db()
    connection = get_db_connection()
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT id, total, source AS store, parsed_at, warnings, tip, discount, image_url FROM receipts WHERE id = ?", (receipt_id,))
        receipt_row = cursor.fetchone()
        
        if not receipt_row:
            return None
            
        cursor.execute("SELECT id, product AS name, quantity, price AS unit_price, category FROM receipt_items WHERE receipt_id = ?", (receipt_id,))
        item_rows = cursor.fetchall()
        
        items = []
        for i in item_rows:
            items.append({
                "id": i["id"],
                "name": i["name"],
                "quantity": i["quantity"],
                "unit_price": i["unit_price"],
                "category": i["category"] or "Others"
            })
            
        warnings_list = []
        if receipt_row["warnings"]:
            try:
                warnings_list = json.loads(receipt_row["warnings"])
            except Exception:
                warnings_list = []
                
        return {
            "id": receipt_row["id"],
            "total": receipt_row["total"],
            "store": receipt_row["store"],
            "parsed_at": receipt_row["parsed_at"],
            "warnings": warnings_list,
            "tip": receipt_row["tip"] or 0,
            "discount": receipt_row["discount"] or 0,
            "image_url": receipt_row["image_url"],
            "items": items
        }
    finally:
        connection.close()

def delete_receipt(receipt_id):
    """Deletes a receipt and all its associated items from SQLite."""
    init_db()
    connection = get_db_connection()
    try:
        cursor = connection.cursor()
        cursor.execute("DELETE FROM receipt_items WHERE receipt_id = ?", (receipt_id,))
        cursor.execute("DELETE FROM receipts WHERE id = ?", (receipt_id,))
        connection.commit()
        return cursor.rowcount > 0
    finally:
        connection.close()

def get_monthly_summary(year=None, month=None):
    """Calculates monthly financial summaries from the database."""
    init_db()
    
    # Default to current month if not specified
    if not year or not month:
        now = datetime.now()
        year = year or now.year
        month = month or now.month
        
    connection = get_db_connection()
    try:
        cursor = connection.cursor()
        
        # 1. Fetch total spend, scan counts, and average ticket for target month
        cursor.execute(
            """
            SELECT 
                COALESCE(SUM(total), 0) AS total_spent,
                COUNT(id) AS receipt_count,
                COALESCE(AVG(total), 0) AS average_receipt
            FROM receipts
            WHERE strftime('%Y', parsed_at) = ? AND strftime('%m', parsed_at) = ?
            """,
            (f"{year:04d}", f"{month:02d}")
        )
        basic_row = cursor.fetchone()
        
        # 2. Fetch breakdown by category
        cursor.execute(
            """
            SELECT 
                COALESCE(i.category, 'Others') AS category,
                SUM(i.quantity * i.price) AS total,
                COUNT(DISTINCT r.id) AS count
            FROM receipts r
            JOIN receipt_items i ON r.id = i.receipt_id
            WHERE strftime('%Y', r.parsed_at) = ? AND strftime('%m', r.parsed_at) = ?
            GROUP BY category
            ORDER BY total DESC
            """,
            (f"{year:04d}", f"{month:02d}")
        )
        category_rows = cursor.fetchall()
        by_category = []
        for c in category_rows:
            by_category.append({
                "category": c["category"],
                "total": c["total"],
                "count": c["count"]
            })
            
        # 3. Determine top category and top merchant
        top_category = by_category[0]["category"] if by_category else "Others"
        
        cursor.execute(
            """
            SELECT source AS merchant, SUM(total) AS total
            FROM receipts
            WHERE strftime('%Y', parsed_at) = ? AND strftime('%m', parsed_at) = ?
            GROUP BY source
            ORDER BY total DESC
            LIMIT 1
            """,
            (f"{year:04d}", f"{month:02d}")
        )
        merchant_row = cursor.fetchone()
        top_merchant = merchant_row["merchant"] if merchant_row else "None"
        
        # 4. Fetch comparison metrics from the previous month
        prev_year = year
        prev_month = month - 1
        if prev_month == 0:
            prev_month = 12
            prev_year -= 1
            
        cursor.execute(
            "SELECT COALESCE(SUM(total), 0) AS total_spent FROM receipts WHERE strftime('%Y', parsed_at) = ? AND strftime('%m', parsed_at) = ?",
            (f"{prev_year:04d}", f"{prev_month:02d}")
        )
        prev_spent = cursor.fetchone()["total_spent"]
        
        total_spent = basic_row["total_spent"]
        difference = total_spent - prev_spent
        percent_change = 0
        if prev_spent > 0:
            percent_change = round((difference / prev_spent) * 100, 1)
        elif total_spent > 0:
            percent_change = 100
            
        previous_month = {
            "total_spent": prev_spent,
            "difference": difference,
            "percent_change": percent_change
        }
        
        return {
            "year": year,
            "month": month,
            "total_spent": total_spent,
            "receipt_count": basic_row["receipt_count"],
            "average_receipt": int(basic_row["average_receipt"]),
            "top_category": top_category,
            "top_merchant": top_merchant,
            "by_category": by_category,
            "previous_month": previous_month
        }
    finally:
        connection.close()
