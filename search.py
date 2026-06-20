# search.py
import re

with open('reference.md', 'r', encoding='utf-8') as f:
    content = f.read()

# Let's search for sqlite, database, or "persist"
matches = [m.start() for m in re.finditer(r'sqlite|database|persist|data dir', content, re.IGNORECASE)]
print(f"Total matches: {len(matches)}")

with open('persist_details.txt', 'w', encoding='utf-8') as out:
    for idx in matches:
        start = max(0, idx - 300)
        end = min(len(content), idx + 300)
        out.write(f"=== MATCH AT {idx} ===\n")
        out.write(content[start:end] + "\n\n")

print("Done writing to persist_details.txt")
